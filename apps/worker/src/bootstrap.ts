import { Pool } from "pg";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import { createPostgresCommandRepository } from "@proofline/api/src/postgres";
import { createWeb2JsonVerifierClient } from "@proofline/fdc-coston2";
import {
  createLiveCoston2PipelinePorts,
  createLiveCoston2Runtime,
} from "./live-runtime";
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
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer`);
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
  createRuntime?: typeof createLiveCoston2Runtime;
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
  const pipelinePorts = (
    input.createPipelinePorts ?? createLiveCoston2PipelinePorts
  )({
    environment,
    verifier: input.verifier as never,
  });
  const runtime = (input.createRuntime ?? createLiveCoston2Runtime)({
    environment,
  });
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
  const projectToken = required(environment, "PROOFLINE_PROJECT_TOKEN");
  const privateKey = required(environment, "PROOFLINE_COSTON2_PRIVATE_KEY");

  return createRunWorker({
    environment: environment.NODE_ENV ?? "production",
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
    adapters: { coston2: runtime, pipeline: { kind: "live" } },
    logger: input.logger ?? {
      info: (value) => console.info(JSON.stringify(value)),
      error: (value) => console.error(JSON.stringify(value)),
    },
    handlers: {
      ...pipelineHandlers,
      RUN_LIVE_COSTON2: async (command) => {
        const manifest = Web2JsonManifestV1Schema.parse(command.payload.manifest);
        return runtime.execute({
          manifest,
          projectToken,
          privateKey,
          verifier: input.verifier as never,
          timeoutMs: 600_000,
        });
      },
    },
  });
}

export async function runWorkerLoop(input: {
  processOne(): Promise<boolean>;
  shouldStop(): boolean;
  sleep(ms: number): Promise<void>;
  idleDelayMs: number;
}): Promise<void> {
  while (!input.shouldStop()) {
    const processed = await input.processOne();
    if (!processed) await input.sleep(input.idleDelayMs);
  }
}

export async function startProductionWorker(
  environment: Environment = process.env,
): Promise<void> {
  const pool = new Pool({
    connectionString: required(environment, "DATABASE_URL"),
    max: Number(environment.PROOFLINE_WORKER_DB_POOL_SIZE ?? 4),
    idleTimeoutMillis: 30_000,
  });
  const verifier = createWeb2JsonVerifierClient({
    endpoint:
      environment.PROOFLINE_VERIFIER_URL ??
      "https://fdc-verifiers-testnet.flare.network",
    apiKey: required(environment, "PROOFLINE_VERIFIER_API_KEY"),
  });
  const worker = createProductionWorker({
    environment,
    pool,
    verifier,
  });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true;
    });
  }
  await runWorkerLoop({
    processOne: worker.processOne,
    shouldStop: () => stopping,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    idleDelayMs: 1_000,
  });
  await pool.end();
}
