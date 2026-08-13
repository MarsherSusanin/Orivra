import { Pool } from "pg";
import { createPostgresCommandRepository } from "@proofline/api/src/postgres";
import { resolveDeploymentEnvironment } from "@proofline/api/src/deployment-secrets";
import { parseExactApplicationDatabaseUrl } from "@proofline/api/src/deployment-database-url";
import { verifyDeploymentSchema } from "@proofline/api/src/deployment-lifecycle";
import { createWeb2JsonVerifierClient } from "@proofline/fdc-coston2";
import { createLiveCoston2PipelinePorts } from "./live-runtime";
import { createRunScopedReplayBootstrapRepository } from "./production-replay-bootstrap-runtime.mjs";
import {
  loadWorkerSafeConsumerRegistry,
  parseWorkerReplayBootstrapRuntimeConfig,
  type LiveCoston2RuntimeConfig,
  type WorkerRelayerPolicy,
  type WorkerRuntimeConfiguration,
} from "./worker-runtime-configuration";
import {
  createProductionCommandHandlers,
  createRunWorker,
  type WorkerCommand,
} from "./worker";

type Environment = Record<string, string | undefined>;

function copyRelayerPolicy(policy: WorkerRelayerPolicy): WorkerRelayerPolicy {
  return Object.freeze({
    globalFeeCapWei: policy.globalFeeCapWei,
    balanceFloorWei: policy.balanceFloorWei,
    dailyProjectQuota: policy.dailyProjectQuota,
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

export async function createProductionReplayBootstrapWorker(
  environment: Environment = process.env,
) {
  const resolvedEnvironment = await resolveDeploymentEnvironment("worker", environment);
  const runtimeConfiguration = parseWorkerReplayBootstrapRuntimeConfig({
    ...resolvedEnvironment,
    DATABASE_URL: parseWorkerDatabaseAuthority(resolvedEnvironment),
    PROOFLINE_VERIFIER_API_KEY: resolvedEnvironment.PROOFLINE_VERIFIER_API_KEY,
  });
  const registryEvidence = await loadWorkerSafeConsumerRegistry(runtimeConfiguration);
  const liveRuntimeConfig = createLiveRuntimeConfig(
    runtimeConfiguration,
    registryEvidence.safeConsumerRegistry,
  );
  const pool = new Pool({
    connectionString: runtimeConfiguration.databaseUrl,
    max: runtimeConfiguration.databasePoolSize,
    idleTimeoutMillis: 30_000,
  });
  const verifier = createWeb2JsonVerifierClient({
    endpoint: runtimeConfiguration.verifierEndpoint,
    apiKey: runtimeConfiguration.verifierApiKey,
  });
  try {
    await verifyDeploymentSchema({ pool });
    const repository = createPostgresCommandRepository({
      pool,
      relayerPolicy: runtimeConfiguration.relayerPolicy,
    } as never);
    const scopedRepository = createRunScopedReplayBootstrapRepository({ repository });
    const ports = createLiveCoston2PipelinePorts({
      runtimeConfig: liveRuntimeConfig,
      verifier: verifier as never,
    });
    const rawHandlers = createProductionCommandHandlers({
      repository: scopedRepository as never,
      ports,
      clock: { now: () => new Date().toISOString() },
    });
    const handlers = Object.fromEntries(
      Object.entries(rawHandlers)
        .filter(([kind]) => kind !== "APPLY_REPLAY_EVIDENCE")
        .map(([kind, handler]) => [
          kind,
          (command: WorkerCommand) => {
            if (!command.runId) throw new Error(`Persisted ${kind} command has no run id`);
            return handler({ ...command, runId: command.runId });
          },
        ]),
    );
    const worker = createRunWorker({
      environment: "production",
      mode: "live",
      repository: scopedRepository as never,
      maxAttempts: runtimeConfiguration.maxAttempts,
      leaseHeartbeatMs: runtimeConfiguration.leaseHeartbeatMs,
      adapters: { coston2: { kind: "live" }, pipeline: { kind: "live" } },
      logger: {
        info: (value) => console.info(JSON.stringify(value)),
        error: (value) => console.error(JSON.stringify(value)),
      },
      handlers,
    });
    return Object.freeze({
      processOne: worker.processOne,
      activateRun: scopedRepository.activateRun,
      relayerAccount: runtimeConfiguration.relayerAccount,
      close: () => pool.end(),
    });
  } catch (cause) {
    await pool.end().catch(() => undefined);
    throw cause;
  }
}
