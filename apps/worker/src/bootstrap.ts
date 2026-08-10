import { Pool } from "pg";
import { createPostgresCommandRepository } from "@proofline/api/src/postgres";
import { resolveDeploymentEnvironment } from "@proofline/api/src/deployment-secrets";
import { parseExactApplicationDatabaseUrl } from "@proofline/api/src/deployment-database-url";
import { createWeb2JsonVerifierClient } from "@proofline/fdc-coston2";
import { verifyDeploymentSchema } from "@proofline/api/src/deployment-lifecycle";
import {
  createDeploymentWorkerIdentity,
  createPostgresDeploymentHeartbeatStore,
} from "@proofline/api/src/deployment-heartbeat";
import { createLiveCoston2PipelinePorts } from "./live-runtime";
import {
  loadWorkerReplayEvidence,
  parseWorkerRuntimeConfig,
  type WorkerReplayEvidence,
  type WorkerRuntimeConfig,
  type WorkerRuntimeConfiguration,
} from "./worker-runtime-configuration";
import {
  createProductionCommandHandlers,
  createRunWorker,
  type WorkerCommand,
} from "./worker";

type Environment = Record<string, string | undefined>;

function discardReplayPathAuthority(
  configuration: WorkerRuntimeConfiguration,
): WorkerRuntimeConfig {
  const {
    replayBundlePath: _replayBundlePath,
    replayPreflightReportPath: _replayPreflightReportPath,
    ...runtimeConfig
  } = configuration;
  return Object.freeze(runtimeConfig);
}

function parseWorkerDatabaseAuthority(environment: Environment): string {
  try {
    return parseExactApplicationDatabaseUrl(
      environment.DATABASE_URL ?? "",
      "proofline_worker_login",
    );
  } catch {
    return "";
  }
}

export function createProductionWorker(input: {
  runtimeConfig: WorkerRuntimeConfig;
  replayEvidence: WorkerReplayEvidence;
  pool: any;
  verifier: { prepareRequest(input: unknown): Promise<unknown> };
  createPipelinePorts?: typeof createLiveCoston2PipelinePorts;
  createRepository?: typeof createPostgresCommandRepository;
  clock?: { now(): string };
  logger?: { info(value: unknown): void; error(value: unknown): void };
}) {
  const repository = (input.createRepository ?? createPostgresCommandRepository)(
    {
      pool: input.pool,
      relayerPolicy: input.runtimeConfig.relayerPolicy,
    } as never,
  );
  const livePipelinePorts = (
    input.createPipelinePorts ?? createLiveCoston2PipelinePorts
  )({
    runtimeConfig: input.runtimeConfig,
    verifier: input.verifier as never,
  });
  const pipelinePorts = {
    ...livePipelinePorts,
    async loadReplayBundle() {
      return input.replayEvidence.bundleCanonicalJson;
    },
    async loadReplayPreflightReport() {
      return input.replayEvidence.preflightReportCanonicalJson;
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
    maxAttempts: input.runtimeConfig.maxAttempts,
    leaseHeartbeatMs: input.runtimeConfig.leaseHeartbeatMs,
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
  const runtimeConfiguration = parseWorkerRuntimeConfig({
    ...resolvedEnvironment,
    DATABASE_URL: parseWorkerDatabaseAuthority(resolvedEnvironment),
    PROOFLINE_VERIFIER_API_KEY:
      resolvedEnvironment.PROOFLINE_VERIFIER_API_KEY,
  });
  const replayEvidence = await loadWorkerReplayEvidence(runtimeConfiguration);
  const runtimeConfig = discardReplayPathAuthority(runtimeConfiguration);
  const pool = new Pool({
    connectionString: runtimeConfig.databaseUrl,
    max: runtimeConfig.databasePoolSize,
    idleTimeoutMillis: 30_000,
  });
  const verifier = createWeb2JsonVerifierClient({
    endpoint: runtimeConfig.verifierEndpoint,
    apiKey: runtimeConfig.verifierApiKey,
  });
  let stopping = false;
  try {
    await verifyDeploymentSchema({ pool });
    const worker = createProductionWorker({
      runtimeConfig,
      replayEvidence,
      pool,
      verifier,
    });
    const heartbeatStore = createPostgresDeploymentHeartbeatStore({ pool });
    const heartbeatIdentity = createDeploymentWorkerIdentity({
      deploymentId: runtimeConfig.deploymentId,
      releaseTreeSha: runtimeConfig.releaseTreeSha,
    });
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
        refreshAndCleanup: () =>
          heartbeatStore.refreshAndCleanup(heartbeatIdentity),
      },
      heartbeatIntervalMs: 10_000,
    });
    if (stopping) await heartbeatStore.stop(heartbeatIdentity);
  } finally {
    await pool.end();
  }
}
