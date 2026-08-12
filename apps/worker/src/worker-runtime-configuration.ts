import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  PreflightReportV1Schema,
  isCanonicalUint256Decimal,
} from "@proofline/contracts";
import {
  SafeConsumerRegistryV1Schema,
  canonicalSerializeSafeConsumerRegistry as serializeSafeConsumerRegistry,
} from "@proofline/contracts/production-promotion";
import {
  canonicalSerializePreflightReport,
  canonicalizeManifestUrl,
  projectRun,
  replayProofBundle,
} from "@proofline/domain";
import { parseExactApplicationDatabaseUrl } from "@proofline/api/src/deployment-database-url";
import { parseDeploymentIdentity } from "@proofline/api/src/deployment-lifecycle";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Environment = Record<string, string | undefined>;

const CHAIN_ID = 114 as const;
const REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as Address;
const DEFAULT_VERIFIER_ENDPOINT =
  "https://fdc-verifiers-testnet.flare.network";
const DEFAULT_RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";
const DEFAULT_DA_ENDPOINT =
  "https://ctn2-data-availability.flare.network";
const BUNDLE_MAX_BYTES = 2_200_000;
const REPORT_MAX_BYTES = 65_536;
const SAFE_CONSUMER_REGISTRY_MAX_BYTES = 16_384;
const FORBIDDEN_SAFE_CONSUMER_ADDRESS = [
  "PROOFLINE",
  "SAFE",
  "CONSUMER",
  "ADDRESS",
].join("_");
const ERROR_CODE = "WORKER_RUNTIME_CONFIGURATION_INVALID";
const ERROR_MESSAGE = "Worker runtime configuration is invalid";

class WorkerRuntimeConfigurationError extends Error {
  readonly code = ERROR_CODE;

  constructor() {
    super(ERROR_MESSAGE);
    this.name = "WorkerRuntimeConfigurationError";
  }
}

function invalidConfiguration(): never {
  throw new WorkerRuntimeConfigurationError();
}

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) invalidConfiguration();
  return value;
}

function canonicalUint256(environment: Environment, name: string): bigint {
  const value = required(environment, name);
  if (!isCanonicalUint256Decimal(value)) invalidConfiguration();
  return BigInt(value);
}

function boundedPositiveInteger(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) invalidConfiguration();
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidConfiguration();
  }
  return value;
}

function boundedRequiredPositiveInteger(
  environment: Environment,
  name: string,
  minimum: number,
  maximum: number,
): number {
  required(environment, name);
  return boundedPositiveInteger(environment, name, minimum, minimum, maximum);
}

function strictHttpsEndpoint(value: string, rootOnly: boolean): string {
  if (value !== value.trim()) invalidConfiguration();
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.hostname === "" ||
    (rootOnly && parsed.pathname !== "/")
  ) {
    invalidConfiguration();
  }
  return value;
}

export type WorkerRelayerPolicy = Readonly<{
  globalFeeCapWei: bigint;
  balanceFloorWei: bigint;
  dailyProjectQuota: number;
}>;

export type WorkerRuntimeConfiguration = Readonly<{
  chainId: 114;
  registryAddress: Address;
  verifierEndpoint: string;
  verifierApiKey: string;
  rpcUrl: string;
  daEndpoint: string;
  receiptPollTimeoutMs: number;
  daTimeoutMs: number;
  databaseUrl: string;
  databasePoolSize: number;
  maxAttempts: number;
  leaseHeartbeatMs: number;
  deploymentId: string;
  releaseTreeSha: string;
  relayerAccount: ReturnType<typeof privateKeyToAccount>;
  relayerPolicy: WorkerRelayerPolicy;
  safeConsumerRegistryPath: string;
  replayBundlePath: string;
  replayPreflightReportPath: string;
}>;

export type LiveCoston2RuntimeConfig = Readonly<{
  chainId: 114;
  registryAddress: Address;
  rpcUrl: string;
  daEndpoint: string;
  receiptPollTimeoutMs: number;
  daTimeoutMs: number;
  relayerAccount: ReturnType<typeof privateKeyToAccount>;
  relayerPolicy: WorkerRelayerPolicy;
  safeConsumerRegistry: Readonly<{
    version: "1";
    kind: "safe-consumer-registry";
    chainId: 114;
    entries: readonly Readonly<{
      templateId: string;
      revision: 1;
      manifestSha256: string;
      consumerAddress: Address;
    }>[];
  }>;
}>;

export type WorkerReplayEvidence = Readonly<{
  bundleCanonicalJson: string;
  bundleSha256: string;
  preflightReportCanonicalJson: string;
  preflightReportSha256: string;
  safeConsumerRegistry: LiveCoston2RuntimeConfig["safeConsumerRegistry"];
  safeConsumerRegistryCanonicalJson: string;
  safeConsumerRegistrySha256: string;
}>;

export function parseWorkerRuntimeConfig(
  environment: Environment,
): WorkerRuntimeConfiguration {
  try {
    const databaseUrl = parseExactApplicationDatabaseUrl(
      required(environment, "DATABASE_URL"),
      "proofline_worker_login",
    );
    const identity = parseDeploymentIdentity(environment);
    const relayerAccount = privateKeyToAccount(
      required(environment, "PROOFLINE_COSTON2_PRIVATE_KEY") as Hex,
    );
    const safeConsumerRegistryPath = required(
      environment,
      "PROOFLINE_SAFE_CONSUMER_REGISTRY_FILE",
    );
    if (
      !isAbsolute(safeConsumerRegistryPath) ||
      Object.hasOwn(environment, FORBIDDEN_SAFE_CONSUMER_ADDRESS)
    ) {
      invalidConfiguration();
    }
    const replayBundlePath = required(
      environment,
      "PROOFLINE_REPLAY_BUNDLE_PATH",
    );
    const replayPreflightReportPath = required(
      environment,
      "PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH",
    );
    if (
      !isAbsolute(replayBundlePath) ||
      !isAbsolute(replayPreflightReportPath)
    ) {
      invalidConfiguration();
    }
    const relayerPolicy = Object.freeze({
      globalFeeCapWei: canonicalUint256(
        environment,
        "PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI",
      ),
      balanceFloorWei: canonicalUint256(
        environment,
        "PROOFLINE_RELAYER_BALANCE_FLOOR_WEI",
      ),
      dailyProjectQuota: boundedRequiredPositiveInteger(
        environment,
        "PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    });
    return Object.freeze({
      chainId: CHAIN_ID,
      registryAddress: REGISTRY_ADDRESS,
      verifierEndpoint: strictHttpsEndpoint(
        environment.PROOFLINE_VERIFIER_URL ?? DEFAULT_VERIFIER_ENDPOINT,
        true,
      ),
      verifierApiKey: required(environment, "PROOFLINE_VERIFIER_API_KEY"),
      rpcUrl: strictHttpsEndpoint(
        environment.PROOFLINE_COSTON2_RPC_URL ?? DEFAULT_RPC_URL,
        false,
      ),
      daEndpoint: strictHttpsEndpoint(
        environment.PROOFLINE_COSTON2_DA_URL ?? DEFAULT_DA_ENDPOINT,
        true,
      ),
      receiptPollTimeoutMs: boundedPositiveInteger(
        environment,
        "PROOFLINE_RECEIPT_POLL_TIMEOUT_MS",
        25_000,
        1,
        30_000,
      ),
      daTimeoutMs: boundedPositiveInteger(
        environment,
        "PROOFLINE_DA_TIMEOUT_MS",
        15_000,
        1,
        30_000,
      ),
      databaseUrl,
      databasePoolSize: boundedPositiveInteger(
        environment,
        "PROOFLINE_WORKER_DB_POOL_SIZE",
        4,
        1,
        32,
      ),
      maxAttempts: boundedPositiveInteger(
        environment,
        "PROOFLINE_WORKER_MAX_ATTEMPTS",
        8,
        1,
        100,
      ),
      leaseHeartbeatMs: boundedPositiveInteger(
        environment,
        "PROOFLINE_WORKER_LEASE_HEARTBEAT_MS",
        10_000,
        1_000,
        29_000,
      ),
      deploymentId: identity.deploymentId,
      releaseTreeSha: identity.releaseTreeSha,
      relayerAccount: Object.freeze(relayerAccount),
      relayerPolicy,
      safeConsumerRegistryPath,
      replayBundlePath,
      replayPreflightReportPath,
    });
  } catch (cause) {
    if (cause instanceof WorkerRuntimeConfigurationError) throw cause;
    invalidConfiguration();
  }
}

export async function loadWorkerSafeConsumerRegistry(config: WorkerRuntimeConfiguration) {
  try {
    const canonical = await readBoundedRegularFile(
      config.safeConsumerRegistryPath,
      SAFE_CONSUMER_REGISTRY_MAX_BYTES,
      0o400,
    );
    const registry = SafeConsumerRegistryV1Schema.parse(JSON.parse(canonical));
    if (serializeSafeConsumerRegistry(registry) !== canonical) invalidConfiguration();
    const safeConsumerRegistry = Object.freeze({
      version: registry.version,
      kind: registry.kind,
      chainId: registry.chainId,
      entries: Object.freeze(registry.entries.map((entry) => Object.freeze({
        ...entry,
        consumerAddress: getAddress(entry.consumerAddress),
      }))),
    });
    return Object.freeze({
      safeConsumerRegistry,
      safeConsumerRegistryCanonicalJson: canonical,
      safeConsumerRegistrySha256: sha256(canonical),
    });
  } catch (cause) {
    if (cause instanceof WorkerRuntimeConfigurationError) throw cause;
    invalidConfiguration();
  }
}

async function readBoundedRegularFile(
  path: string,
  maximum: number,
  requiredMode?: number,
) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (requiredMode !== undefined && (stat.mode & 0o777) !== requiredMode) ||
      stat.size < 1 ||
      stat.size > maximum
    ) {
      invalidConfiguration();
    }
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const result = await handle.read(
        bytes,
        length,
        bytes.byteLength - length,
        null,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length < 1 || length > maximum) invalidConfiguration();
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    if (value.includes("\0")) invalidConfiguration();
    return value;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requestIdentity(requestBytes: string): string {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(requestBytes.slice(2), "hex"))
    .digest("hex")}`;
}

export async function loadWorkerReplayEvidence(
  config: WorkerRuntimeConfiguration,
): Promise<WorkerReplayEvidence> {
  try {
    const registryEvidence = await loadWorkerSafeConsumerRegistry(config);
    const bundleCanonicalJson = await readBoundedRegularFile(
      config.replayBundlePath,
      BUNDLE_MAX_BYTES,
    );
    const preflightReportCanonicalJson = await readBoundedRegularFile(
      config.replayPreflightReportPath,
      REPORT_MAX_BYTES,
    );
    const bundle = replayProofBundle(bundleCanonicalJson);
    if (
      projectRun(bundle.events).terminal !== true ||
      bundle.verification.proofVerified !== true ||
      bundle.verification.consumerVerified !== true ||
      bundle.verification.diagnostics.length !== 0
    ) {
      invalidConfiguration();
    }
    const decodedReport: unknown = JSON.parse(preflightReportCanonicalJson);
    const report = PreflightReportV1Schema.parse(decodedReport);
    if (
      canonicalSerializePreflightReport(report) !==
        preflightReportCanonicalJson
    ) {
      invalidConfiguration();
    }
    const accepted = bundle.events.find(
      (event) => event.type === "PREFLIGHT_ACCEPTED",
    );
    const reportNetwork = report.registrySnapshot;
    const bundleNetwork = bundle.network;
    const canonicalUrl = canonicalizeManifestUrl(bundle.manifest);
    if (
      accepted?.type !== "PREFLIGHT_ACCEPTED" ||
      report.runId !== bundle.runId ||
      report.verdict !== "ready" ||
      report.blockers.length !== 0 ||
      report.diagnostics.length !== 0 ||
      report.canonicalUrl !== canonicalUrl ||
      accepted.payload.canonicalUrl !== canonicalUrl ||
      report.requestIdentitySha256 !== requestIdentity(bundle.requestBytes) ||
      report.fee.quotedWei !== accepted.payload.quotedFeeWei ||
      report.fee.capWei !== bundle.manifest.submission.feeCapWei ||
      reportNetwork.chainId !== bundleNetwork.chainId ||
      reportNetwork.blockNumber !== bundleNetwork.blockNumber ||
      !sameAddress(reportNetwork.registryAddress, bundleNetwork.registryAddress) ||
      !sameAddress(
        reportNetwork.resolvedContracts.FdcHub,
        bundleNetwork.resolvedContracts.FdcHub,
      ) ||
      !sameAddress(
        reportNetwork.resolvedContracts.FdcRequestFeeConfigurations,
        bundleNetwork.resolvedContracts.FdcRequestFeeConfigurations,
      ) ||
      !sameAddress(
        reportNetwork.resolvedContracts.FdcVerification,
        bundleNetwork.resolvedContracts.FdcVerification,
      ) ||
      !sameAddress(
        reportNetwork.resolvedContracts.Relay,
        bundleNetwork.resolvedContracts.Relay,
      )
    ) {
      invalidConfiguration();
    }
    return Object.freeze({
      bundleCanonicalJson,
      bundleSha256: sha256(bundleCanonicalJson),
      preflightReportCanonicalJson,
      preflightReportSha256: sha256(preflightReportCanonicalJson),
      ...registryEvidence,
    });
  } catch (cause) {
    if (cause instanceof WorkerRuntimeConfigurationError) throw cause;
    invalidConfiguration();
  }
}
