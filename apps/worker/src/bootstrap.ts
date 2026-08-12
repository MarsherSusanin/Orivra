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
  type LiveCoston2RuntimeConfig,
  type WorkerRelayerPolicy,
  type WorkerReplayEvidence,
  type WorkerRuntimeConfiguration,
} from "./worker-runtime-configuration";
import {
  createProductionCommandHandlers,
  createRunWorker,
  type WorkerCommand,
} from "./worker";

type Environment = Record<string, string | undefined>;

type RepositoryPolicy = Readonly<{
  relayerPolicy: WorkerRelayerPolicy;
}>;

type WorkerLoopConfig = Readonly<{
  maxAttempts: number;
  leaseHeartbeatMs: number;
}>;

function copyRelayerPolicy(
  policy: WorkerRelayerPolicy,
): WorkerRelayerPolicy {
  return Object.freeze({
    globalFeeCapWei: policy.globalFeeCapWei,
    balanceFloorWei: policy.balanceFloorWei,
    dailyProjectQuota: policy.dailyProjectQuota,
  });
}

function createRepositoryPolicy(
  configuration: WorkerRuntimeConfiguration,
): RepositoryPolicy {
  return Object.freeze({
    relayerPolicy: copyRelayerPolicy(configuration.relayerPolicy),
  });
}

function createWorkerLoopConfig(
  configuration: WorkerRuntimeConfiguration,
): WorkerLoopConfig {
  return Object.freeze({
    maxAttempts: configuration.maxAttempts,
    leaseHeartbeatMs: configuration.leaseHeartbeatMs,
  });
}

function createLiveRuntimeConfig(
  configuration: WorkerRuntimeConfiguration,
  safeConsumerRegistry: LiveCoston2RuntimeConfig["safeConsumerRegistry"],
): LiveCoston2RuntimeConfig {
  return Object.freeze({
    chainId: configuration.chainId,
    registryAddress: configuration.registryAddress,
    rpcUrl: configuration.rpcUrl,
    daEndpoint: configuration.daEndpoint,
    receiptPollTimeoutMs: configuration.receiptPollTimeoutMs,
    daTimeoutMs: configuration.daTimeoutMs,
    relayerAccount: Object.freeze({ ...configuration.relayerAccount }),
    relayerPolicy: copyRelayerPolicy(configuration.relayerPolicy),
    safeConsumerRegistry,
  });
}

function copyReplayEvidence(
  evidence: WorkerReplayEvidence,
): WorkerReplayEvidence {
  return Object.freeze({
    bundleCanonicalJson: evidence.bundleCanonicalJson,
    bundleSha256: evidence.bundleSha256,
    preflightReportCanonicalJson: evidence.preflightReportCanonicalJson,
    preflightReportSha256: evidence.preflightReportSha256,
    safeConsumerRegistry: evidence.safeConsumerRegistry,
    safeConsumerRegistryCanonicalJson: evidence.safeConsumerRegistryCanonicalJson,
    safeConsumerRegistrySha256: evidence.safeConsumerRegistrySha256,
  });
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
  repositoryPolicy: RepositoryPolicy;
  workerLoopConfig: WorkerLoopConfig;
  liveRuntimeConfig: LiveCoston2RuntimeConfig;
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
      relayerPolicy: input.repositoryPolicy.relayerPolicy,
    } as never,
  );
  const livePipelinePorts = (
    input.createPipelinePorts ?? createLiveCoston2PipelinePorts
  )({
    runtimeConfig: input.liveRuntimeConfig,
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
    maxAttempts: input.workerLoopConfig.maxAttempts,
    leaseHeartbeatMs: input.workerLoopConfig.leaseHeartbeatMs,
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
  const loadedReplayEvidence = await loadWorkerReplayEvidence(
    runtimeConfiguration,
  );
  const repositoryPolicy = createRepositoryPolicy(runtimeConfiguration);
  const workerLoopConfig = createWorkerLoopConfig(runtimeConfiguration);
  const liveRuntimeConfig = createLiveRuntimeConfig(
    runtimeConfiguration,
    loadedReplayEvidence.safeConsumerRegistry,
  );
  const replayEvidence = copyReplayEvidence(loadedReplayEvidence);
  const pool = new Pool({
    connectionString: runtimeConfiguration.databaseUrl,
    max: runtimeConfiguration.databasePoolSize,
    idleTimeoutMillis: 30_000,
  });
  const verifier = createWeb2JsonVerifierClient({
    endpoint: runtimeConfiguration.verifierEndpoint,
    apiKey: runtimeConfiguration.verifierApiKey,
  });
  let stopping = false;
  try {
    await verifyDeploymentSchema({ pool });
    const worker = createProductionWorker({
      repositoryPolicy,
      workerLoopConfig,
      liveRuntimeConfig,
      replayEvidence,
      pool,
      verifier,
    });
    const heartbeatStore = createPostgresDeploymentHeartbeatStore({ pool });
    const heartbeatIdentity = createDeploymentWorkerIdentity({
      deploymentId: runtimeConfiguration.deploymentId,
      releaseTreeSha: runtimeConfiguration.releaseTreeSha,
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
