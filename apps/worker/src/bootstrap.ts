import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createPostgresCommandRepository } from "@proofline/api/src/postgres";
import { resolveDeploymentEnvironment } from "@proofline/api/src/deployment-secrets";
import { createWeb2JsonVerifierClient } from "@proofline/fdc-coston2";
import {
  parseDeploymentIdentity,
  verifyDeploymentSchema,
} from "@proofline/api/src/deployment-lifecycle";
import {
  createDeploymentWorkerIdentity,
  createPostgresDeploymentHeartbeatStore,
} from "@proofline/api/src/deployment-heartbeat";
import { isCanonicalUint256Decimal } from "@proofline/contracts";
import { createLiveCoston2PipelinePorts } from "./live-runtime";
import {
  createProductionCommandHandlers,
  createRunWorker,
  type WorkerCommand,
} from "./worker";

type Environment = Record<string, string | undefined>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required by the live worker`);
  return value;
}

function unsignedBigInt(environment: Environment, name: string): bigint {
  const value = required(environment, name);
  if (!isCanonicalUint256Decimal(value)) {
    throw new Error(`${name} must be an unsigned canonical uint256 integer`);
  }
  return BigInt(value);
}

function positiveInteger(
  environment: Environment,
  name: string,
  fallback?: number,
): number {
  const value = environment[name]?.trim();
  if (!value && fallback !== undefined) return fallback;
  if (!value || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} exceeds the safe integer range`);
  }
  return parsed;
}

export function createProductionWorker(input: {
  environment: Environment;
  pool: any;
  verifier: { prepareRequest(input: unknown): Promise<unknown> };
  createPipelinePorts?: typeof createLiveCoston2PipelinePorts;
  createRepository?: typeof createPostgresCommandRepository;
  clock?: { now(): string };
  logger?: { info(value: unknown): void; error(value: unknown): void };
}) {
  const environment = input.environment;
  const repositoryInput: {
    pool: unknown;
    relayerPolicy?: {
      globalFeeCapWei: bigint;
      balanceFloorWei: bigint;
      dailyProjectQuota: number;
    };
  } = {
    pool: input.pool,
  };
  if (!input.createRepository) {
    repositoryInput.relayerPolicy = {
      globalFeeCapWei: unsignedBigInt(
        environment,
        "PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI",
      ),
      balanceFloorWei: unsignedBigInt(
        environment,
        "PROOFLINE_RELAYER_BALANCE_FLOOR_WEI",
      ),
      dailyProjectQuota: positiveInteger(
        environment,
        "PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA",
      ),
    };
  }
  const repository = (input.createRepository ?? createPostgresCommandRepository)(
    repositoryInput as never,
  );
  const livePipelinePorts = (
    input.createPipelinePorts ?? createLiveCoston2PipelinePorts
  )({
    environment,
    verifier: input.verifier as never,
  });
  const pipelinePorts = {
    ...livePipelinePorts,
    async loadReplayBundle() {
      return readFile(
        required(environment, "PROOFLINE_REPLAY_BUNDLE_PATH"),
        "utf8",
      );
    },
    async loadReplayPreflightReport() {
      return readFile(
        required(
          environment,
          "PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH",
        ),
        "utf8",
      );
    },
  };
  const rawPipelineHandlers = createProductionCommandHandlers({
    repository,
    ports: pipelinePorts,
    clock: input.clock ?? { now: () => new Date().toISOString() },
  });
  const pipelineHandlers: Record<
    string,
    (command: WorkerCommand) => Promise<unknown>
  > = Object.fromEntries(
    Object.entries(rawPipelineHandlers).map(([kind, handler]) => [
      kind,
      (command: WorkerCommand) => {
        if (!command.runId) {
          throw new Error(`Persisted ${kind} command has no run id`);
        }
        return handler({ ...command, runId: command.runId });
      },
    ]),
  );
  return createRunWorker({
    environment: "production",
    mode: "live",
    repository,
    maxAttempts: positiveInteger(
      environment,
      "PROOFLINE_WORKER_MAX_ATTEMPTS",
      8,
    ),
    leaseHeartbeatMs: positiveInteger(
      environment,
      "PROOFLINE_WORKER_LEASE_HEARTBEAT_MS",
      10_000,
    ),
    adapters: {
      coston2: { kind: "live" },
      pipeline: { kind: "live" },
    },
    logger: input.logger ?? {
      info: (value) => console.info(JSON.stringify(value)),
      error: (value) => console.error(JSON.stringify(value)),
    },
    handlers: pipelineHandlers,
  });
}

export async function runWorkerLoop(input: {
  processOne(): Promise<boolean>;
  shouldStop(): boolean;
  sleep(ms: number): Promise<void>;
  idleDelayMs: number;
  deploymentHeartbeat?: {
    refreshAndCleanup(): Promise<void>;
  };
  heartbeatIntervalMs?: number;
}): Promise<void> {
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatRefresh: Promise<void> | undefined;
  let heartbeatFailure: DeploymentHeartbeatFailure | undefined;
  let finishHeartbeatFailure!: (failure: DeploymentHeartbeatFailure) => void;
  const heartbeatFailed = new Promise<DeploymentHeartbeatFailure>((resolve) => {
    finishHeartbeatFailure = resolve;
  });
  let loopClosed = false;

  const scheduleHeartbeat = () => {
    if (!input.deploymentHeartbeat || loopClosed) return;
    heartbeatTimer = setTimeout(() => {
      heartbeatRefresh = input.deploymentHeartbeat!.refreshAndCleanup()
        .then(() => scheduleHeartbeat())
        .catch(() => {
          heartbeatFailure = new DeploymentHeartbeatFailure();
          finishHeartbeatFailure(heartbeatFailure);
        });
    }, input.heartbeatIntervalMs ?? 10_000);
  };
  scheduleHeartbeat();

  try {
    while (!input.shouldStop()) {
      if (heartbeatFailure) throw heartbeatFailure;
      const current = input.processOne();
      const outcome = input.deploymentHeartbeat
        ? await Promise.race([
            current.then((processed) => ({ kind: "processed" as const, processed })),
            heartbeatFailed.then((failure) => ({ kind: "heartbeat" as const, failure })),
          ])
        : { kind: "processed" as const, processed: await current };
      if (outcome.kind === "heartbeat") {
        await current.catch(() => undefined);
        throw outcome.failure;
      }
      if (heartbeatFailure) throw heartbeatFailure;
      if (!outcome.processed) await input.sleep(input.idleDelayMs);
    }
  } finally {
    loopClosed = true;
    if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    await heartbeatRefresh;
  }
  if (heartbeatFailure) throw heartbeatFailure;
}

export class DeploymentHeartbeatFailure extends Error {
  readonly code = "DEPLOYMENT_HEARTBEAT_FAILED";

  constructor() {
    super("Deployment heartbeat failed");
    this.name = "DeploymentHeartbeatFailure";
  }
}

export async function startProductionWorker(
  environment: Environment = process.env,
): Promise<void> {
  const resolvedEnvironment = await resolveDeploymentEnvironment(
    "worker",
    environment,
  );
  const deploymentIdentity = parseDeploymentIdentity(resolvedEnvironment);
  const pool = new Pool({
    connectionString: required(resolvedEnvironment, "DATABASE_URL"),
    max: Number(resolvedEnvironment.PROOFLINE_WORKER_DB_POOL_SIZE ?? 4),
    idleTimeoutMillis: 30_000,
  });
  const verifier = createWeb2JsonVerifierClient({
    endpoint:
      resolvedEnvironment.PROOFLINE_VERIFIER_URL ??
      "https://fdc-verifiers-testnet.flare.network",
    apiKey: required(resolvedEnvironment, "PROOFLINE_VERIFIER_API_KEY"),
  });
  let stopping = false;
  try {
    await verifyDeploymentSchema({ pool });
    const worker = createProductionWorker({
      environment: resolvedEnvironment,
      pool,
      verifier,
    });
    const heartbeatStore = createPostgresDeploymentHeartbeatStore({ pool });
    const heartbeatIdentity = createDeploymentWorkerIdentity(deploymentIdentity);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        stopping = true;
      });
    }
    await heartbeatStore.start(heartbeatIdentity);
    await runWorkerLoop({
      processOne: worker.processOne,
      shouldStop: () => stopping,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      idleDelayMs: 1_000,
      deploymentHeartbeat: {
        refreshAndCleanup: () => heartbeatStore.refreshAndCleanup(heartbeatIdentity),
      },
      heartbeatIntervalMs: 10_000,
    });
    if (stopping) await heartbeatStore.stop(heartbeatIdentity);
  } finally {
    await pool.end();
  }
}
