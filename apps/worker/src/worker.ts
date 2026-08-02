import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  DiagnosticV1Schema,
  isCanonicalUint256Decimal,
  NormalizedFdcErrorSchema,
  PreflightReportV1Schema,
  type NormalizedFdcError,
  type PreflightReportV1,
  type DiagnosticV1,
  type ProofBundleV1,
  type RunEventV1,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import {
  canonicalSerializeProofBundle,
  canonicalSerializePreflightReport,
  canonicalizeManifestUrl,
  createProofBundle,
  generateSafeWeb2JsonConsumer,
  projectRun,
  replayProofBundle,
} from "@proofline/domain";
import {
  calculateVotingRoundId,
  deriveWeb2JsonPreflightTrustBlockers,
} from "@proofline/fdc-coston2";
import { normalizeFdcError } from "@proofline/fdc-coston2";
import { encodeFunctionData, type Abi, type Hex } from "viem";
import fdcHubAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcHub.sol/IFdcHub.json";

export interface WorkerCommand {
  id: string;
  kind: string;
  runId?: string;
  attempts?: number;
  payload: Record<string, unknown>;
}

interface ClaimedCommand {
  claimToken: string;
  command: WorkerCommand;
}

interface WorkerRepository {
  claimNextCommand(): Promise<ClaimedCommand | null>;
  completeCommand(
    commandId: string,
    claimToken: string,
    result: unknown,
  ): Promise<unknown>;
  retryCommand(
    commandId: string,
    claimToken: string,
    failure: Record<string, unknown>,
  ): Promise<unknown>;
  renewLease?(
    commandId: string,
    claimToken: string,
    interval: string,
  ): Promise<unknown>;
}

interface WorkerComposition {
  environment: string;
  mode: "live" | "replay";
  adapters: Record<string, { kind: string }>;
}

export function validateWorkerComposition(input: WorkerComposition): void {
  if (input.environment !== "production") return;
  if (input.mode !== "live") {
    throw new Error("Replay or simulator composition is forbidden in production");
  }
  for (const [name, adapter] of Object.entries(input.adapters)) {
    if (adapter.kind !== "live") {
      throw new Error(
        `Replay or simulator adapter ${name} is forbidden in production`,
      );
    }
  }
}

const SAFE_FAILURE_CATEGORIES = new Set([
  "configuration",
  "transport",
  "timeout",
  "not-finalized",
  "consensus-miss",
  "schema-invalid",
  "proof-invalid",
  "consumer-invariant",
]);

function safeFailureEvidence(value: unknown): Record<string, unknown> {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const evidence: Record<string, unknown> = {};
  if (
    typeof source.stage === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/.test(source.stage)
  ) {
    evidence.stage = source.stage;
  }
  if (
    typeof source.attempt === "number" &&
    Number.isSafeInteger(source.attempt) &&
    source.attempt >= 0
  ) {
    evidence.attempt = source.attempt;
  }
  if (
    typeof source.retryAfterSeconds === "number" &&
    Number.isFinite(source.retryAfterSeconds) &&
    source.retryAfterSeconds >= 0
  ) {
    evidence.retryAfterSeconds = source.retryAfterSeconds;
  }
  return evidence;
}

function safeFailure(cause: unknown, commandId: string): Record<string, unknown> {
  if (cause && typeof cause === "object" && "category" in cause) {
    const source = cause as Record<string, unknown>;
    const category =
      typeof source.category === "string" &&
      SAFE_FAILURE_CATEGORIES.has(source.category)
        ? source.category
        : "transport";
    return {
      category,
      ...(typeof source.code === "string" &&
      /^[A-Z][A-Z0-9_]{0,127}$/.test(source.code)
        ? { code: source.code }
        : {}),
      retryable: source.retryable === true,
      message: "Worker command failed",
      evidence: safeFailureEvidence(source.evidence),
      commandId,
    };
  }
  const normalized = normalizeFdcError(cause, { commandId });
  return {
    ...normalized,
    message: "Worker command failed",
    evidence: { commandId },
  };
}

export function createRunWorker(input: {
  environment: string;
  mode: "live" | "replay";
  repository: WorkerRepository;
  handlers: Record<string, (command: ClaimedCommand["command"]) => Promise<unknown>>;
  logger: {
    info(value: unknown): void;
    error(value: unknown): void;
  };
  adapters?: Record<string, { kind: string }>;
  maxAttempts?: number;
  leaseHeartbeatMs?: number;
}) {
  validateWorkerComposition({
    environment: input.environment,
    mode: input.mode,
    adapters: input.adapters ?? {},
  });
  const maxAttempts = input.maxAttempts ?? 8;
  const leaseHeartbeatMs = input.leaseHeartbeatMs ?? 10_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("Worker maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(leaseHeartbeatMs) || leaseHeartbeatMs <= 0) {
    throw new Error("Worker leaseHeartbeatMs must be positive");
  }

  return {
    async processOne(): Promise<boolean> {
      const claimed = await input.repository.claimNextCommand();
      if (!claimed) return false;
      const handler = input.handlers[claimed.command.kind];
      if (!handler) {
        const failure = {
          category: "configuration",
          code: "WORKER_HANDLER_MISSING",
          retryable: false,
          terminal: true,
          message: "No handler registered for command",
          evidence: { commandId: claimed.command.id },
          commandId: claimed.command.id,
        };
        await input.repository.retryCommand(
          claimed.command.id,
          claimed.claimToken,
          failure,
        );
        input.logger.error(failure);
        return true;
      }

      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let heartbeatFailure: unknown;
      try {
        if (input.repository.renewLease) {
          await input.repository.renewLease(
            claimed.command.id,
            claimed.claimToken,
            "30 seconds",
          );
          heartbeat = setInterval(() => {
            void Promise.resolve(
              input.repository.renewLease?.(
                claimed.command.id,
                claimed.claimToken,
                "30 seconds",
              ),
            ).catch((cause) => {
                heartbeatFailure ??= cause;
            });
          }, leaseHeartbeatMs);
        }
        const result = await handler(claimed.command);
        if (heartbeatFailure) throw heartbeatFailure;
        await input.repository.completeCommand(
          claimed.command.id,
          claimed.claimToken,
          result,
        );
        input.logger.info({
          event: "WORKER_COMMAND_COMPLETED",
          commandId: claimed.command.id,
        });
      } catch (cause) {
        const normalized = safeFailure(cause, claimed.command.id);
        const attempts = claimed.command.attempts ?? 1;
        const exhausted =
          normalized.retryable === true && attempts >= maxAttempts;
        const failure = exhausted
          ? {
              ...normalized,
              code: "COMMAND_RETRY_EXHAUSTED",
              retryable: false,
              terminal: true,
              evidence: {
                ...(normalized.evidence &&
                typeof normalized.evidence === "object"
                  ? (normalized.evidence as Record<string, unknown>)
                  : {}),
                ...(typeof normalized.code === "string"
                  ? { originalCode: normalized.code }
                  : {}),
              },
            }
          : normalized.retryable === false
            ? { ...normalized, terminal: true }
            : normalized;
        await input.repository.retryCommand(
          claimed.command.id,
          claimed.claimToken,
          failure,
        );
        input.logger.error({
          event: "WORKER_COMMAND_FAILED",
          ...failure,
        });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
      return true;
    },
  };
}

type ProductionCommand = ClaimedCommand["command"] & { runId: string };

interface PersistedArtifact {
  id?: string;
  runId?: string;
  kind: string;
  canonicalBytes?: Uint8Array;
  canonical_bytes?: Uint8Array;
  sha256?: Uint8Array | string;
  metadata?: Record<string, unknown>;
}

interface RunExecutionContext {
  runId: string;
  projectId: string;
  manifest: Web2JsonManifestV1;
  events: RunEventV1[];
  projection: ReturnType<typeof projectRun>;
  artifacts: PersistedArtifact[];
}

interface PersistedRelayerTransaction {
  idempotencyKey: string;
  nonce: bigint;
  rawTransaction: string;
  transactionHash: string;
  commandFingerprint?: string;
  chainId: number;
  target: string;
  calldata?: string;
  calldataHash?: string;
  valueWei: bigint;
  fromAddress?: string;
  projectId?: string;
  runId?: string;
  broadcastAt?: string | null;
  broadcastAttemptedAt?: string | null;
  policy?: RelayerPolicy;
}

interface RelayerPolicy {
  projectFeeCapWei: bigint;
  globalFeeCapWei: bigint;
  quotaRemaining: number;
  balanceFloorWei: bigint;
}

function sha256HexBytes(value: string): string {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw new Error("Expected canonical hexadecimal calldata");
  }
  return createHash("sha256")
    .update(Buffer.from(value.slice(2), "hex"))
    .digest("hex");
}

function assertRelayerIdentity(
  persisted: PersistedRelayerTransaction,
  expected: {
    runId: string;
    idempotencyKey: string;
    target: string;
    calldata: string;
    valueWei: bigint;
  },
  requireFingerprint: boolean,
): void {
  const calldataMatches = persisted.calldata
    ? sameHex(persisted.calldata, expected.calldata)
    : persisted.calldataHash === sha256HexBytes(expected.calldata);
  const fingerprint = relayerFingerprint(expected);
  if (
    persisted.chainId !== 114 ||
    persisted.idempotencyKey !== expected.idempotencyKey ||
    (persisted.runId !== undefined && persisted.runId !== expected.runId) ||
    !sameHex(persisted.target, expected.target) ||
    !calldataMatches ||
    persisted.valueWei !== expected.valueWei ||
    (requireFingerprint && persisted.commandFingerprint !== fingerprint)
  ) {
    throw new Error("Persisted relayer command identity conflict");
  }
}

function relayerFingerprint(value: {
  runId: string;
  idempotencyKey: string;
  target: string;
  calldata: string;
  valueWei: bigint;
}): string {
  const canonical = JSON.stringify({
    runId: value.runId,
    idempotencyKey: value.idempotencyKey,
    chainId: 114,
    target: value.target.toLowerCase(),
    calldata: value.calldata.toLowerCase(),
    valueWei: value.valueWei.toString(),
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

interface ProductionPipelineRepository {
  loadRunExecutionContext(runId: string): Promise<RunExecutionContext>;
  renewLease?(commandId: string, claimToken: string, interval: string): Promise<unknown>;
  findRelayerTransaction(
    idempotencyKey: string,
  ): Promise<PersistedRelayerTransaction | null>;
  findRelayerTransactionByRun?(
    runId: string,
  ): Promise<PersistedRelayerTransaction | null>;
  persistRelayerTransaction(value: PersistedRelayerTransaction): Promise<unknown>;
  markRelayerBroadcast(
    idempotencyKey: string,
    transactionHash: string,
  ): Promise<unknown>;
  claimRelayerBroadcastAttempt?(
    idempotencyKey: string,
    transactionHash: string,
  ): Promise<boolean>;
  loadRelayerPolicy?(
    projectId: string,
    manifestFeeCapWei: bigint,
  ): Promise<RelayerPolicy>;
}

type SubmissionNetworkSnapshot = {
  chainId: 114;
  blockNumber: string;
  registryAddress: string;
  resolvedContracts: {
    FdcHub: string;
    FdcRequestFeeConfigurations: string;
    FdcVerification: string;
    Relay: string;
  };
};

export type ProductionPreflightOutcome =
  | {
      kind: "accepted";
      report: PreflightReportV1;
      submissionEvidence: {
        canonicalUrl: string;
        requestBytes: string;
        requestCalldata: string;
        quotedFeeWei: bigint;
        network: SubmissionNetworkSnapshot;
      };
    }
  | {
      kind: "blocked";
      report: PreflightReportV1;
      error: NormalizedFdcError;
    };

export interface ProductionPipelinePorts {
  loadReplayBundle?(input: {
    manifest: Web2JsonManifestV1;
    runId: string;
  }): Promise<string>;
  loadReplayPreflightReport?(input: {
    manifest: Web2JsonManifestV1;
    runId: string;
  }): Promise<string>;
  preflight(input: {
    manifest: Web2JsonManifestV1;
    runId: string;
  }): Promise<ProductionPreflightOutcome>;
  signRelayerTransaction(input: Record<string, unknown>): Promise<PersistedRelayerTransaction>;
  broadcastRawTransaction(rawTransaction: string): Promise<string>;
  deriveTransactionHash?(rawTransaction: string): string;
  resolveRecordedTransaction?(transactionHash: string): Promise<boolean>;
  observeWalletTransaction(input: Record<string, unknown>): Promise<{
    transactionHash: string;
    chainId: number;
    target: string;
    calldata: string;
    valueWei: bigint;
  }>;
  getTransactionReceipt(input: Record<string, unknown>): Promise<{
    transactionHash: string;
    blockHash: string;
    blockTimestamp: bigint;
  }>;
  getVotingConfiguration(input: Record<string, unknown>): Promise<{
    firstVotingRoundStartTs: bigint;
    votingEpochDurationSeconds: bigint;
    protocolId: number;
  }>;
  isRelayFinalized(input: Record<string, unknown>): Promise<boolean>;
  getRelayRoot(input: Record<string, unknown>): Promise<string>;
  fetchDaProof(input: Record<string, unknown>): Promise<{
    response_hex: string;
    attestation_type: string;
    proof: string[];
    proofHash?: string;
  }>;
  verifyProof(input: Record<string, unknown>): Promise<{
    verified: boolean;
    verificationContract: string;
  }>;
  verifyConsumer(input: Record<string, unknown>): Promise<{
    passed: boolean;
    diagnostics: DiagnosticV1[];
  }>;
}

interface CommandOutcome {
  events?: RunEventV1[];
  artifacts?: PersistedArtifact[];
  nextCommands?: Array<{
    id: string;
    projectId: string;
    runId: string;
    idempotencyKey: string;
    kind: string;
    payload: Record<string, unknown>;
  }>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function canonicalEvidence(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function sha256Bytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifact(
  runId: string,
  kind: string,
  value: unknown,
  metadata: Record<string, unknown> = {},
): PersistedArtifact {
  const canonicalBytes = canonicalEvidence(value);
  return {
    id: randomUUID(),
    runId,
    kind,
    canonicalBytes,
    sha256: sha256Bytes(canonicalBytes),
    metadata,
  };
}

function preflightReportArtifact(
  runId: string,
  reportValue: unknown,
): PersistedArtifact {
  const report = PreflightReportV1Schema.parse(reportValue);
  if (report.runId !== runId) {
    throw new Error("Preflight report run identity does not match its artifact");
  }
  const canonicalBytes = encoder.encode(
    canonicalSerializePreflightReport(report),
  );
  return {
    id: randomUUID(),
    runId,
    kind: "preflight-report-v1",
    canonicalBytes,
    sha256: sha256Bytes(canonicalBytes),
    metadata: { version: "1" },
  };
}

function artifactBytes(value: PersistedArtifact): Uint8Array {
  const bytes = value.canonicalBytes ?? value.canonical_bytes;
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`Persisted ${value.kind} artifact has no canonical bytes`);
  }
  return bytes;
}

function artifactValue<T>(context: RunExecutionContext, kind: string): T {
  const found = [...context.artifacts].reverse().find((item) => item.kind === kind);
  if (!found) throw new Error(`Persisted ${kind} evidence is required`);
  return JSON.parse(decoder.decode(artifactBytes(found))) as T;
}

function hasEvent(context: RunExecutionContext, type: RunEventV1["type"]): boolean {
  return context.events.some((event) => event.type === type);
}

function event(
  context: RunExecutionContext,
  command: ProductionCommand,
  type: RunEventV1["type"],
  payload: Record<string, unknown>,
  occurredAt: string,
): RunEventV1 {
  return {
    version: "1",
    runId: context.runId,
    sequence: context.events.length + 1,
    commandId: command.id,
    occurredAt,
    type,
    payload,
  } as RunEventV1;
}

function child(
  context: RunExecutionContext,
  kind: string,
  payload: Record<string, unknown> = {},
) {
  return {
    id: randomUUID(),
    projectId: context.projectId,
    runId: context.runId,
    idempotencyKey: `${context.runId}:${kind.toLowerCase()}`,
    kind,
    payload,
  };
}

function replayEffectCommandId(
  parentCommandId: string,
  type: RunEventV1["type"],
  ordinal: number,
): string {
  return `${parentCommandId}:replay:${ordinal}:${type.toLowerCase()}`;
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function preflightBoundaryError(
  code: string,
  message: string,
  category: "configuration" | "schema-invalid" = "schema-invalid",
): NormalizedFdcError {
  return NormalizedFdcErrorSchema.parse({
    version: "1",
    category,
    code,
    message,
    retryable: false,
    evidence: {},
  });
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function canonicalHex(value: unknown): value is string {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function canonicalUnsignedInteger(value: unknown): value is string {
  return typeof value === "string" && isCanonicalUint256Decimal(value);
}

function isUint256(value: bigint): boolean {
  return value >= 0n && isCanonicalUint256Decimal(value.toString());
}

function normalizedAddress(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function hasPrivateBlockedEvidence(value: unknown): boolean {
  const privateKey = /(?:authorization|credential|header|private|requestBytes|requestCalldata|response|secret|stack|token|transaction)/i;
  const privateValue = /Bearer\s+[^\s;,]+|(?:project|share)_[A-Za-z0-9_-]{32,}|\b0x[a-fA-F0-9]{64}\b/i;
  if (typeof value === "string") return privateValue.test(value);
  if (Array.isArray(value)) return value.some(hasPrivateBlockedEvidence);
  const record = recordValue(value);
  return record
    ? Object.entries(record).some(
        ([key, item]) => privateKey.test(key) || hasPrivateBlockedEvidence(item),
      )
    : false;
}

const BLOCKED_PREFLIGHT_CATEGORY = {
  PREFLIGHT_SOURCE_NONDETERMINISTIC: "schema-invalid",
  PREFLIGHT_ABI_INCOMPATIBLE: "schema-invalid",
  PREFLIGHT_FEE_CAP_EXCEEDED: "configuration",
  PREFLIGHT_TRUST_HOST_MISMATCH: "configuration",
  PREFLIGHT_TRUST_PATH_MISMATCH: "configuration",
  PREFLIGHT_TRUST_QUERY_MISMATCH: "configuration",
} as const;

const TRUST_PREFLIGHT_BLOCKERS = new Set([
  "PREFLIGHT_TRUST_HOST_MISMATCH",
  "PREFLIGHT_TRUST_PATH_MISMATCH",
  "PREFLIGHT_TRUST_QUERY_MISMATCH",
]);

function reportedTrustBlockers(report: PreflightReportV1): string[] {
  return report.blockers.filter((blocker) =>
    TRUST_PREFLIGHT_BLOCKERS.has(blocker),
  );
}

function requestAttestationCalldata(requestBytes: string): string | null {
  if (!canonicalHex(requestBytes)) return null;
  try {
    return encodeFunctionData({
      abi: fdcHubAbi as Abi,
      functionName: "requestAttestation",
      args: [requestBytes as Hex],
    });
  } catch {
    return null;
  }
}

/**
 * Treats every pipeline-port value as untrusted and binds the complete live
 * outcome before the command handler constructs any durable mutation.
 */
function validateProductionPreflightOutcome(input: {
  value: unknown;
  context: RunExecutionContext;
}): ProductionPreflightOutcome {
  const value = recordValue(input.value);
  if (!value || (value.kind !== "accepted" && value.kind !== "blocked")) {
    throw preflightBoundaryError(
      "PREFLIGHT_OUTCOME_INVALID",
      "Production preflight requires a strict accepted or blocked outcome",
      "configuration",
    );
  }

  const parsedReport = PreflightReportV1Schema.safeParse(value.report);
  if (!parsedReport.success) {
    throw preflightBoundaryError(
      "PREFLIGHT_OUTCOME_INVALID",
      "Production preflight report does not match the V1 contract",
    );
  }
  const report = parsedReport.data;
  const persistedCanonicalUrl = canonicalizeManifestUrl(input.context.manifest);
  const persistedTrustBlockers = deriveWeb2JsonPreflightTrustBlockers(
    input.context.manifest,
    persistedCanonicalUrl,
  );
  const trustBlockersMatch =
    JSON.stringify(reportedTrustBlockers(report)) ===
    JSON.stringify(persistedTrustBlockers);

  if (
    (value.kind === "accepted" && report.verdict === "blocked") ||
    (value.kind === "blocked" && report.verdict !== "blocked")
  ) {
    throw preflightBoundaryError(
      "PREFLIGHT_OUTCOME_DISCRIMINATOR_MISMATCH",
      "Preflight outcome discriminator does not match the report verdict",
    );
  }

  if (value.kind === "blocked") {
    if (
      Object.hasOwn(value, "submissionEvidence") ||
      Object.keys(value).some(
        (key) => !["kind", "report", "error"].includes(key),
      )
    ) {
      throw preflightBoundaryError(
        "PREFLIGHT_BLOCKED_PRIVATE_EVIDENCE",
        "Blocked preflight outcomes cannot contain private submission evidence",
      );
    }
    const parsedError = NormalizedFdcErrorSchema.safeParse(value.error);
    if (!parsedError.success || hasPrivateBlockedEvidence(value.error)) {
      throw preflightBoundaryError(
        "PREFLIGHT_BLOCKED_PRIVATE_EVIDENCE",
        "Blocked preflight outcomes must contain only safe public error evidence",
      );
    }
    const error = parsedError.data;
    const diagnostic = report.diagnostics.find(
      (item) => item.code === error.code && item.severity === "error",
    );
    const category =
      BLOCKED_PREFLIGHT_CATEGORY[
        error.code as keyof typeof BLOCKED_PREFLIGHT_CATEGORY
      ];
    if (
      report.runId !== input.context.runId ||
      report.canonicalUrl !== persistedCanonicalUrl ||
      !trustBlockersMatch ||
      report.fee.capWei !== input.context.manifest.submission.feeCapWei ||
      !report.blockers.includes(error.code as never) ||
      !diagnostic ||
      !category ||
      error.category !== category ||
      error.retryable ||
      error.message !== diagnostic.summary ||
      JSON.stringify(error.evidence) !== JSON.stringify(diagnostic.evidence)
    ) {
      throw preflightBoundaryError(
        "PREFLIGHT_BLOCKED_ERROR_MISMATCH",
        "Blocked preflight error does not match its report blocker and diagnostic",
      );
    }
    return { kind: "blocked", report, error };
  }

  if (
    Object.hasOwn(value, "error") ||
    Object.keys(value).some(
      (key) => !["kind", "report", "submissionEvidence"].includes(key),
    )
  ) {
    throw preflightBoundaryError(
      "PREFLIGHT_SUBMISSION_EVIDENCE_MISMATCH",
      "Accepted preflight outcome contains contradictory evidence",
    );
  }
  const evidence = recordValue(value.submissionEvidence);
  const network = recordValue(evidence?.network);
  const resolvedContracts = recordValue(network?.resolvedContracts);
  const quotedFeeWei = evidence?.quotedFeeWei;
  const requestBytes = evidence?.requestBytes;
  const requestCalldata = evidence?.requestCalldata;
  const expectedRequestCalldata =
    typeof requestBytes === "string"
      ? requestAttestationCalldata(requestBytes)
      : null;
  const reportSnapshot = report.registrySnapshot;
  const reportedContracts = reportSnapshot.resolvedContracts;
  const evidenceMismatch =
    report.runId !== input.context.runId ||
    report.canonicalUrl !== persistedCanonicalUrl ||
    !trustBlockersMatch ||
    persistedTrustBlockers.length !== 0 ||
    report.verdict === "blocked" ||
    report.blockers.length !== 0 ||
    report.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    report.fee.capWei !== input.context.manifest.submission.feeCapWei ||
    report.fee.withinCap !== true ||
    !evidence ||
    !hasOnlyKeys(evidence, [
      "version",
      "canonicalUrl",
      "requestBytes",
      "requestCalldata",
      "quotedFeeWei",
      "network",
    ]) ||
    (evidence.version !== undefined && evidence.version !== "1") ||
    evidence.canonicalUrl !== report.canonicalUrl ||
    !canonicalHex(requestBytes) ||
    `sha256:${canonicalHex(requestBytes) ? sha256HexBytes(requestBytes) : ""}` !==
      report.requestIdentitySha256 ||
    !canonicalHex(requestCalldata) ||
    !expectedRequestCalldata ||
    !sameHex(requestCalldata, expectedRequestCalldata) ||
    typeof quotedFeeWei !== "bigint" ||
    !isUint256(quotedFeeWei) ||
    quotedFeeWei.toString() !== report.fee.quotedWei ||
    !network ||
    !hasOnlyKeys(network, [
      "chainId",
      "blockNumber",
      "registryAddress",
      "resolvedContracts",
    ]) ||
    network.chainId !== 114 ||
    !canonicalUnsignedInteger(network.blockNumber) ||
    network.blockNumber !== reportSnapshot.blockNumber ||
    normalizedAddress(network.registryAddress) !==
      normalizedAddress(reportSnapshot.registryAddress) ||
    !resolvedContracts ||
    !hasOnlyKeys(resolvedContracts, [
      "FdcHub",
      "FdcRequestFeeConfigurations",
      "FdcVerification",
      "Relay",
    ]) ||
    normalizedAddress(resolvedContracts.FdcHub) !==
      normalizedAddress(reportedContracts.FdcHub) ||
    normalizedAddress(resolvedContracts.FdcVerification) !==
      normalizedAddress(reportedContracts.FdcVerification) ||
    normalizedAddress(resolvedContracts.Relay) !==
      normalizedAddress(reportedContracts.Relay) ||
    normalizedAddress(resolvedContracts.FdcRequestFeeConfigurations) !==
      normalizedAddress(reportedContracts.FdcRequestFeeConfigurations);
  if (evidenceMismatch) {
    throw preflightBoundaryError(
      "PREFLIGHT_SUBMISSION_EVIDENCE_MISMATCH",
      "Private submission evidence does not match the accepted public report",
    );
  }

  return {
    kind: "accepted",
    report,
    submissionEvidence: value.submissionEvidence as Extract<
      ProductionPreflightOutcome,
      { kind: "accepted" }
    >["submissionEvidence"],
  };
}

function preflightEvidence(context: RunExecutionContext) {
  return artifactValue<{
    canonicalUrl: string;
    requestBytes: string;
    requestCalldata: string;
    quotedFeeWei: string;
    network: {
      chainId: 114;
      blockNumber: string;
      registryAddress: string;
      resolvedContracts: {
        FdcHub: string;
        FdcRequestFeeConfigurations: string;
        FdcVerification: string;
        Relay: string;
      };
    };
  }>(context, "preflight-evidence");
}

function isCategorizedReplayError(value: unknown): value is {
  category: string;
  code: string;
  retryable: boolean;
} {
  const categorized = recordValue(value);
  return Boolean(
    categorized &&
    typeof categorized.category === "string" &&
    SAFE_FAILURE_CATEGORIES.has(categorized.category) &&
    typeof categorized.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,127}$/.test(categorized.code) &&
    typeof categorized.retryable === "boolean",
  );
}

function assertReplaySource(
  serialized: string,
  manifest: Web2JsonManifestV1,
): ProofBundleV1 {
  let source: ProofBundleV1;
  try {
    source = replayProofBundle(serialized);
  } catch (cause) {
    if (isCategorizedReplayError(cause)) throw cause;
    throw preflightBoundaryError(
      "REPLAY_EVIDENCE_INVALID",
      "Recorded replay evidence is invalid",
    );
  }
  const comparable = (value: Web2JsonManifestV1) => ({
    ...value,
    submission: { ...value.submission, mode: "replay" as const },
  });
  if (
    !isDeepStrictEqual(comparable(source.manifest), comparable(manifest)) ||
    projectRun(source.events).terminal !== true ||
    source.verification.proofVerified !== true ||
    source.verification.consumerVerified !== true
  ) {
    throw Object.assign(
      new Error("Persisted replay evidence does not match a terminal passing run"),
      {
        category: "schema-invalid",
        code: "REPLAY_EVIDENCE_INVALID",
        retryable: false,
      },
    );
  }
  return source;
}

function replayReportError(
  category: "configuration" | "schema-invalid",
  code: string,
  message: string,
): NormalizedFdcError {
  return NormalizedFdcErrorSchema.parse({
    version: "1",
    category,
    code,
    message,
    retryable: false,
    evidence: {},
  });
}

function replayPreflightReport(input: {
  serialized: string;
  source: ProofBundleV1;
  targetRunId: string;
  accepted: Extract<RunEventV1, { type: "PREFLIGHT_ACCEPTED" }>;
}): PreflightReportV1 {
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.serialized);
  } catch {
    throw replayReportError(
      "schema-invalid",
      "REPLAY_PREFLIGHT_REPORT_INVALID",
      "Recorded replay preflight report is not valid JSON",
    );
  }
  if (
    decoded &&
    typeof decoded === "object" &&
    !Array.isArray(decoded) &&
    (decoded as { fee?: { capWei?: unknown } }).fee?.capWei !==
      input.source.manifest.submission.feeCapWei
  ) {
    throw replayReportError(
      "schema-invalid",
      "REPLAY_PREFLIGHT_REPORT_MISMATCH",
      "Recorded replay preflight report fee cap does not match the proof bundle",
    );
  }
  const parsed = PreflightReportV1Schema.safeParse(decoded);
  if (!parsed.success) {
    throw replayReportError(
      "schema-invalid",
      "REPLAY_PREFLIGHT_REPORT_INVALID",
      "Recorded replay preflight report does not match the V1 contract",
    );
  }
  const report = parsed.data;
  const canonicalUrl = canonicalizeManifestUrl(input.source.manifest);
  const trustBlockers = deriveWeb2JsonPreflightTrustBlockers(
    input.source.manifest,
    canonicalUrl,
  );
  const requestIdentitySha256 = `sha256:${sha256HexBytes(
    input.source.requestBytes,
  )}`;
  const sourceNetwork = input.source.network;
  const reportNetwork = report.registrySnapshot;
  const mismatched =
    report.runId !== input.source.runId ||
    report.verdict === "blocked" ||
    trustBlockers.length !== 0 ||
    JSON.stringify(reportedTrustBlockers(report)) !==
      JSON.stringify(trustBlockers) ||
    report.canonicalUrl !== canonicalUrl ||
    input.accepted.payload.canonicalUrl !== canonicalUrl ||
    report.canonicalUrl !== input.accepted.payload.canonicalUrl ||
    report.requestIdentitySha256 !== requestIdentitySha256 ||
    report.fee.quotedWei !== input.accepted.payload.quotedFeeWei ||
    report.fee.capWei !== input.source.manifest.submission.feeCapWei ||
    reportNetwork.chainId !== sourceNetwork.chainId ||
    reportNetwork.blockNumber !== sourceNetwork.blockNumber ||
    reportNetwork.registryAddress.toLowerCase() !==
      sourceNetwork.registryAddress.toLowerCase() ||
    reportNetwork.resolvedContracts.FdcHub.toLowerCase() !==
      sourceNetwork.resolvedContracts.FdcHub.toLowerCase() ||
    reportNetwork.resolvedContracts.FdcRequestFeeConfigurations.toLowerCase() !==
      sourceNetwork.resolvedContracts.FdcRequestFeeConfigurations.toLowerCase() ||
    reportNetwork.resolvedContracts.FdcVerification.toLowerCase() !==
      sourceNetwork.resolvedContracts.FdcVerification.toLowerCase() ||
    reportNetwork.resolvedContracts.Relay.toLowerCase() !==
      sourceNetwork.resolvedContracts.Relay.toLowerCase();
  if (mismatched) {
    throw replayReportError(
      "schema-invalid",
      "REPLAY_PREFLIGHT_REPORT_MISMATCH",
      "Recorded replay preflight report is not bound to the proof bundle",
    );
  }
  return PreflightReportV1Schema.parse({
    ...report,
    runId: input.targetRunId,
  });
}

function replaySource(context: RunExecutionContext): {
  serialized: string;
  bundle: ProofBundleV1;
} {
  const persisted = [...context.artifacts]
    .reverse()
    .find((item) => item.kind === "replay-source");
  if (!persisted) throw new Error("Persisted replay-source evidence is required");
  const serialized = decoder.decode(artifactBytes(persisted));
  return {
    serialized,
    bundle: assertReplaySource(serialized, context.manifest),
  };
}

function persistedRelayerPolicy(context: RunExecutionContext): RelayerPolicy | null {
  const found = [...context.artifacts]
    .reverse()
    .find((item) => item.kind === "relayer-policy");
  if (!found) return null;
  const value = JSON.parse(decoder.decode(artifactBytes(found))) as Record<
    string,
    unknown
  >;
  const projectFeeCapWei = BigInt(String(value.projectFeeCapWei ?? "-1"));
  const globalFeeCapWei = BigInt(String(value.globalFeeCapWei ?? "-1"));
  const quotaRemaining = Number(value.quotaRemaining);
  const balanceFloorWei = BigInt(String(value.balanceFloorWei ?? "-1"));
  if (
    !isUint256(projectFeeCapWei) ||
    !isUint256(globalFeeCapWei) ||
    !Number.isInteger(quotaRemaining) ||
    quotaRemaining < 0 ||
    !isUint256(balanceFloorWei)
  ) {
    throw new Error("Persisted relayer policy evidence is invalid");
  }
  return {
    projectFeeCapWei,
    globalFeeCapWei,
    quotaRemaining,
    balanceFloorWei,
  };
}

/**
 * Assemble export bytes exclusively from the append-only journal and immutable
 * artifacts. Artifact metadata is deliberately ignored because it may contain
 * operational audit fields that are not part of the public proof bundle.
 */
export async function assemblePersistedProofBundle(input: {
  runId: string;
  manifest: Web2JsonManifestV1;
  events: RunEventV1[];
  artifacts: PersistedArtifact[];
}) {
  projectRun(input.events);
  const context = {
    runId: input.runId,
    projectId: "bundle-assembly",
    manifest: input.manifest,
    events: input.events,
    projection: projectRun(input.events),
    artifacts: input.artifacts,
  };
  const preflight = artifactValue<{
    requestBytes: string;
    network: {
      chainId: 114;
      blockNumber: string;
      registryAddress: string;
      resolvedContracts: {
        FdcHub: string;
        FdcRequestFeeConfigurations: string;
        FdcVerification: string;
        Relay: string;
      };
    };
  }>(context, "preflight-evidence");
  const proofEvidence = artifactValue<{
    proof: {
      votingRound: number;
      merkleProof: string[];
      response: string;
    };
    proofVerified?: boolean;
  }>(context, "proof-evidence");
  const safeConsumer = [...input.artifacts]
    .reverse()
    .find((item) => item.kind === "safe-consumer");
  if (!safeConsumer) throw new Error("Persisted safe-consumer evidence is required");
  const safeConsumerSha256 =
    typeof safeConsumer.sha256 === "string"
      ? safeConsumer.sha256.replace(/^sha256:/, "")
      : sha256Hex(artifactBytes(safeConsumer));
  const consumer = [...input.events]
    .reverse()
    .find((item) => item.type === "CONSUMER_VERIFIED");
  if (consumer?.type !== "CONSUMER_VERIFIED") {
    throw new Error("Persisted consumer verification event is required");
  }
  const proofVerified =
    proofEvidence.proofVerified ??
    input.events.some((item) => item.type === "PROOF_VERIFIED");
  const bundle = createProofBundle({
    version: "1",
    runId: input.runId,
    manifest: input.manifest,
    events: input.events,
    requestBytes: preflight.requestBytes,
    network: {
      chainId: preflight.network.chainId,
      blockNumber: preflight.network.blockNumber,
      registryAddress: preflight.network.registryAddress,
      resolvedContracts: {
        FdcHub: preflight.network.resolvedContracts.FdcHub,
        FdcRequestFeeConfigurations:
          preflight.network.resolvedContracts.FdcRequestFeeConfigurations,
        FdcVerification:
          preflight.network.resolvedContracts.FdcVerification,
        Relay: preflight.network.resolvedContracts.Relay,
      },
    },
    proof: proofEvidence.proof,
    verification: {
      proofVerified,
      consumerVerified: consumer.payload.passed,
      diagnostics: consumer.payload.diagnostics,
    },
    artifacts: { safeConsumerSha256 },
  });
  const canonicalBytes = encoder.encode(canonicalSerializeProofBundle(bundle));
  return {
    bundle,
    canonicalBytes,
    artifact: {
      id: randomUUID(),
      runId: input.runId,
      kind: "proof-bundle",
      canonicalBytes,
      sha256: sha256Bytes(canonicalBytes),
      metadata: { version: "1", checksum: bundle.checksum },
    },
  };
}

export function createProductionCommandHandlers(input: {
  repository: ProductionPipelineRepository;
  ports: ProductionPipelinePorts;
  clock: { now(): string };
}) {
  const load = (command: ProductionCommand) =>
    input.repository.loadRunExecutionContext(command.runId);

  function assertSubmissionMode(
    context: RunExecutionContext,
    expectedMode: "wallet" | "relayer",
  ): void {
    if (context.manifest.submission.mode !== expectedMode) {
      throw Object.assign(
        new Error(
          `Persisted submission mode ${context.manifest.submission.mode} does not authorize ${expectedMode}`,
        ),
        {
          category: "configuration",
          code: "SUBMISSION_MODE_MISMATCH",
          retryable: false,
        },
      );
    }
  }

  const handlers: Record<
    string,
    (command: ProductionCommand) => Promise<CommandOutcome>
  > = {
    async RUN_PREFLIGHT(command) {
      const context = await load(command);
      if (context.manifest.submission.mode === "replay") {
        const nextCommands = [child(context, "APPLY_REPLAY_EVIDENCE")];
        if (hasEvent(context, "PREFLIGHT_ACCEPTED")) return { nextCommands };
        if (!input.ports.loadReplayBundle) {
          throw Object.assign(
            new Error("A persisted replay bundle source is required"),
            {
              category: "configuration",
              code: "REPLAY_EVIDENCE_MISSING",
              retryable: false,
            },
          );
        }
        const serialized = await input.ports.loadReplayBundle({
          manifest: context.manifest,
          runId: context.runId,
        });
        const source = assertReplaySource(serialized, context.manifest);
        const accepted = source.events.find(
          (item) => item.type === "PREFLIGHT_ACCEPTED",
        );
        if (accepted?.type !== "PREFLIGHT_ACCEPTED") {
          throw new Error("Replay evidence has no accepted preflight event");
        }
        const persistedReplayOutcome = (report: PreflightReportV1) => ({
          events: [
            event(
              context,
              command,
              "PREFLIGHT_ACCEPTED",
              accepted.payload,
              input.clock.now(),
            ),
          ],
          artifacts: [
            {
              id: randomUUID(),
              runId: context.runId,
              kind: "replay-source",
              canonicalBytes: encoder.encode(serialized),
              sha256: sha256Bytes(encoder.encode(serialized)),
              metadata: {
                version: "1",
                sourceRunId: source.runId,
                sourceChecksum: source.checksum,
              },
            },
            artifact(context.runId, "preflight-evidence", {
              version: "1",
              canonicalUrl: accepted.payload.canonicalUrl,
              requestBytes: source.requestBytes,
              quotedFeeWei: accepted.payload.quotedFeeWei,
              network: report.registrySnapshot,
            }),
            preflightReportArtifact(context.runId, report),
          ],
          nextCommands,
        });
        if (!input.ports.loadReplayPreflightReport) {
          throw replayReportError(
            "configuration",
            "REPLAY_PREFLIGHT_REPORT_MISSING",
            "A recorded replay preflight report sidecar is required",
          );
        }
        const sourceReportBytes = await input.ports.loadReplayPreflightReport({
          manifest: context.manifest,
          runId: context.runId,
        });
        const report = replayPreflightReport({
          serialized: sourceReportBytes,
          source,
          targetRunId: context.runId,
          accepted,
        });
        return persistedReplayOutcome(report);
      }
      const nextCommands =
        context.manifest.submission.mode === "relayer"
          ? [
              child(context, "SUBMIT_RELAYER", {
                idempotencyKey: `${context.runId}:relayer`,
              }),
            ]
          : [];
      if (hasEvent(context, "PREFLIGHT_ACCEPTED")) return { nextCommands };
      const outcomeValue: unknown = await input.ports.preflight({
        manifest: context.manifest,
        runId: context.runId,
      });
      const outcome = validateProductionPreflightOutcome({
        value: outcomeValue,
        context,
      });
      if (outcome.kind === "blocked") {
        const error = NormalizedFdcErrorSchema.parse(outcome.error);
        return {
          events: [
            event(
              context,
              command,
              "RUN_FAILED",
              { stage: "preflight", error },
              input.clock.now(),
            ),
          ],
          artifacts: [
            preflightReportArtifact(context.runId, outcome.report),
          ],
          nextCommands: [],
        };
      }
      const prepared = outcome.submissionEvidence;
      const evidence = {
        version: "1",
        canonicalUrl: prepared.canonicalUrl,
        requestBytes: prepared.requestBytes,
        requestCalldata: prepared.requestCalldata,
        quotedFeeWei: prepared.quotedFeeWei.toString(),
        network: prepared.network,
      };
      const relayerPolicy = input.repository.loadRelayerPolicy
        ? await input.repository.loadRelayerPolicy(
            context.projectId,
            BigInt(context.manifest.submission.feeCapWei),
          )
        : null;
      return {
        events: [
          event(
            context,
            command,
            "PREFLIGHT_ACCEPTED",
            {
              canonicalUrl: prepared.canonicalUrl,
              requestBytes: prepared.requestBytes,
              quotedFeeWei: prepared.quotedFeeWei.toString(),
            },
            input.clock.now(),
          ),
        ],
        artifacts: [
          artifact(context.runId, "preflight-evidence", evidence),
          preflightReportArtifact(context.runId, outcome.report),
          ...(relayerPolicy
            ? [
                artifact(context.runId, "relayer-policy", {
                  version: "1",
                  projectFeeCapWei: relayerPolicy.projectFeeCapWei.toString(),
                  globalFeeCapWei: relayerPolicy.globalFeeCapWei.toString(),
                  quotaRemaining: relayerPolicy.quotaRemaining,
                  balanceFloorWei: relayerPolicy.balanceFloorWei.toString(),
                }),
              ]
            : []),
        ],
        nextCommands,
      };
    },

    async APPLY_REPLAY_EVIDENCE(command) {
      const context = await load(command);
      if (hasEvent(context, "CONSUMER_VERIFIED")) {
        return { nextCommands: [child(context, "BUILD_PROOF_BUNDLE")] };
      }
      const source = replaySource(context).bundle;
      const remaining = source.events.filter(
        (item) =>
          item.type !== "RUN_CREATED" && item.type !== "PREFLIGHT_ACCEPTED",
      );
      if (remaining.at(-1)?.type !== "CONSUMER_VERIFIED") {
        throw new Error("Replay evidence command graph is not terminal");
      }
      const events = remaining.map(
        (item, index) =>
          ({
            ...item,
            runId: context.runId,
            sequence: context.events.length + index + 1,
            commandId: replayEffectCommandId(
              command.id,
              item.type,
              index + 1,
            ),
            occurredAt: input.clock.now(),
          }) as RunEventV1,
      );
      const safeSource = generateSafeWeb2JsonConsumer(context.manifest, {
        contractName: "ProoflineSafeWeb2JsonConsumer",
      });
      const safeBytes = encoder.encode(safeSource);
      return {
        events,
        artifacts: [
          artifact(context.runId, "proof-evidence", {
            version: "1",
            proof: source.proof,
            proofVerified: source.verification.proofVerified,
            replaySourceChecksum: source.checksum,
          }),
          artifact(context.runId, "verification-evidence", {
            version: "1",
            proofVerified: source.verification.proofVerified,
            verificationContract:
              source.network.resolvedContracts.FdcVerification,
            replaySourceChecksum: source.checksum,
          }),
          artifact(context.runId, "consumer-evidence", {
            version: "1",
            passed: source.verification.consumerVerified,
            diagnostics: source.verification.diagnostics,
            replaySourceChecksum: source.checksum,
          }),
          {
            id: randomUUID(),
            runId: context.runId,
            kind: "safe-consumer",
            canonicalBytes: safeBytes,
            sha256: sha256Bytes(safeBytes),
            metadata: { compiler: "solc-0.8.36", replay: true },
          },
        ],
        nextCommands: [child(context, "BUILD_PROOF_BUNDLE")],
      };
    },

    async SUBMIT_RELAYER(command) {
      const context = await load(command);
      assertSubmissionMode(context, "relayer");
      if (projectRun(context.events).terminal) {
        throw new Error("Terminal runs are immutable and cannot be submitted again");
      }
      const idempotencyKey = String(
        command.payload.idempotencyKey ?? command.id,
      );
      const preflight = preflightEvidence(context);
      const expected = {
        runId: context.runId,
        idempotencyKey,
        target: preflight.network.resolvedContracts.FdcHub,
        calldata: preflight.requestCalldata,
        valueWei: BigInt(preflight.quotedFeeWei),
      };
      const policy = persistedRelayerPolicy(context);
      const forRun = input.repository.findRelayerTransactionByRun
        ? await input.repository.findRelayerTransactionByRun(context.runId)
        : null;
      if (forRun && forRun.idempotencyKey !== idempotencyKey) {
        throw new Error("Run already has one persisted relayer transaction");
      }
      let persisted =
        forRun ??
        (await input.repository.findRelayerTransaction(idempotencyKey));
      if (!persisted) {
        persisted = await input.ports.signRelayerTransaction({
          runId: context.runId,
          projectId: context.projectId,
          idempotencyKey,
          chainId: 114,
          target: expected.target,
          calldata: expected.calldata,
          valueWei: expected.valueWei,
          manifest: context.manifest,
          ...(policy ? { policy } : {}),
        });
        assertRelayerIdentity(persisted, expected, policy !== null);
        await input.repository.persistRelayerTransaction({
          ...persisted,
          projectId: context.projectId,
          runId: context.runId,
          idempotencyKey,
          ...(policy ? { policy } : {}),
        });
      }
      assertRelayerIdentity(persisted, expected, policy !== null);
      return {
        nextCommands: [
          child(context, "BROADCAST_RELAYER_TRANSACTION", {
            idempotencyKey,
          }),
        ],
      };
    },

    async BROADCAST_RELAYER_TRANSACTION(command) {
      const context = await load(command);
      assertSubmissionMode(context, "relayer");
      const idempotencyKey = String(command.payload.idempotencyKey ?? "");
      const persisted = await input.repository.findRelayerTransaction(
        idempotencyKey,
      );
      if (!persisted) throw new Error("Persisted signed relayer transaction is required");
      const preflight = preflightEvidence(context);
      const expected = {
        runId: context.runId,
        idempotencyKey,
        target: preflight.network.resolvedContracts.FdcHub,
        calldata: preflight.requestCalldata,
        valueWei: BigInt(preflight.quotedFeeWei),
      };
      const policy = persistedRelayerPolicy(context);
      assertRelayerIdentity(persisted, expected, policy !== null);
      if (policy && input.ports.deriveTransactionHash) {
        const derivedHash = input.ports.deriveTransactionHash(
          persisted.rawTransaction,
        );
        if (!sameHex(derivedHash, persisted.transactionHash)) {
          throw new Error(
            "Raw signed transaction hash does not match persisted identity",
          );
        }
      }
      if (!persisted.broadcastAt) {
        if (persisted.broadcastAttemptedAt) {
          const alreadyRecorded = input.ports.resolveRecordedTransaction
            ? await input.ports.resolveRecordedTransaction(
                persisted.transactionHash,
              )
            : false;
          if (!alreadyRecorded) {
            throw Object.assign(
              new Error(
                "Relayer broadcast attempt is ambiguous; manual recovery is required",
              ),
              {
                category: "transport",
                code: "RELAYER_BROADCAST_ATTEMPT_AMBIGUOUS",
                retryable: false,
              },
            );
          }
          await input.repository.markRelayerBroadcast(
            idempotencyKey,
            persisted.transactionHash,
          );
        } else {
          if (!input.repository.claimRelayerBroadcastAttempt) {
            throw new Error(
              "Durable relayer broadcast-attempt repository support is required",
            );
          }
          const claimed = await input.repository.claimRelayerBroadcastAttempt(
            idempotencyKey,
            persisted.transactionHash,
          );
          if (!claimed) {
            const refreshed = await input.repository.findRelayerTransaction(
              idempotencyKey,
            );
            if (refreshed?.broadcastAt) {
              persisted.broadcastAt = refreshed.broadcastAt;
            } else if (refreshed?.broadcastAttemptedAt) {
              const alreadyRecorded = input.ports.resolveRecordedTransaction
                ? await input.ports.resolveRecordedTransaction(
                    refreshed.transactionHash,
                  )
                : false;
              if (!alreadyRecorded) {
                throw Object.assign(
                  new Error(
                    "Relayer broadcast attempt is already claimed; manual recovery is required",
                  ),
                  {
                    category: "transport",
                    code: "RELAYER_BROADCAST_ATTEMPT_AMBIGUOUS",
                    retryable: false,
                  },
                );
              }
              await input.repository.markRelayerBroadcast(
                idempotencyKey,
                refreshed.transactionHash,
              );
            } else {
              throw new Error("Relayer broadcast-attempt claim identity conflict");
            }
          } else {
            const reportedHash = await input.ports.broadcastRawTransaction(
              persisted.rawTransaction,
            );
            if (!sameHex(reportedHash, persisted.transactionHash)) {
              throw new Error("Broadcast transaction hash mismatch");
            }
            await input.repository.markRelayerBroadcast(
              idempotencyKey,
              persisted.transactionHash,
            );
          }
        }
      }
      const events = hasEvent(context, "REQUEST_SUBMITTED")
        ? []
        : [
            event(
              context,
              command,
              "REQUEST_SUBMITTED",
              {
                mode: "relayer",
                transactionHash: persisted.transactionHash,
              },
              input.clock.now(),
            ),
          ];
      return {
        events,
        nextCommands: [
          child(context, "POLL_TRANSACTION_RECEIPT", {
            transactionHash: persisted.transactionHash,
          }),
        ],
      };
    },

    async ATTACH_WALLET_TRANSACTION(command) {
      const context = await load(command);
      assertSubmissionMode(context, "wallet");
      const preflight = preflightEvidence(context);
      const observed = await input.ports.observeWalletTransaction({
        transactionHash: command.payload.transactionHash,
        runId: context.runId,
      });
      if (
        observed.chainId !== 114 ||
        !sameHex(observed.target, preflight.network.resolvedContracts.FdcHub) ||
        !sameHex(observed.calldata, preflight.requestCalldata) ||
        observed.valueWei !== BigInt(preflight.quotedFeeWei)
      ) {
        throw new Error("Wallet transaction does not match persisted preflight intent");
      }
      return {
        events: hasEvent(context, "REQUEST_SUBMITTED")
          ? []
          : [
              event(
                context,
                command,
                "REQUEST_SUBMITTED",
                {
                  mode: "wallet",
                  transactionHash: observed.transactionHash,
                },
                input.clock.now(),
              ),
            ],
        nextCommands: [
          child(context, "POLL_TRANSACTION_RECEIPT", {
            transactionHash: observed.transactionHash,
          }),
        ],
      };
    },

    async POLL_TRANSACTION_RECEIPT(command) {
      const context = await load(command);
      const persistedReceipt = [...context.artifacts]
        .reverse()
        .find((item) => item.kind === "receipt-evidence");
      if (persistedReceipt) {
        const evidence = JSON.parse(
          decoder.decode(artifactBytes(persistedReceipt)),
        ) as { votingRound: number; protocolId: number };
        return {
          nextCommands: [
            child(context, "POLL_RELAY_FINALIZATION", {
              votingRound: evidence.votingRound,
              protocolId: evidence.protocolId,
            }),
          ],
        };
      }
      const receipt = await input.ports.getTransactionReceipt({
        transactionHash: command.payload.transactionHash,
        runId: context.runId,
      });
      const voting = await input.ports.getVotingConfiguration({
        runId: context.runId,
      });
      const votingRound = calculateVotingRoundId({
        blockTimestamp: receipt.blockTimestamp,
        firstVotingRoundStartTs: voting.firstVotingRoundStartTs,
        votingEpochDurationSeconds: voting.votingEpochDurationSeconds,
      });
      const evidence = {
        version: "1",
        ...receipt,
        blockTimestamp: receipt.blockTimestamp.toString(),
        votingRound: Number(votingRound),
        protocolId: voting.protocolId,
      };
      return {
        events: [],
        artifacts: [artifact(context.runId, "receipt-evidence", evidence)],
        nextCommands: [
          child(context, "POLL_RELAY_FINALIZATION", {
            votingRound: Number(votingRound),
            protocolId: voting.protocolId,
          }),
        ],
      };
    },

    async POLL_RELAY_FINALIZATION(command) {
      const context = await load(command);
      const receipt = artifactValue<{
        votingRound: number;
        protocolId: number;
      }>(
        context,
        "receipt-evidence",
      );
      const finalized = await input.ports.isRelayFinalized({
        votingRound: receipt.votingRound,
        protocolId: receipt.protocolId,
        runId: context.runId,
      });
      if (!finalized) {
        throw Object.assign(new Error("Relay voting round is not finalized"), {
          category: "not-finalized",
          code: "RELAY_FINALIZATION_PENDING",
          retryable: true,
          evidence: { votingRound: receipt.votingRound },
        });
      }
      return {
        events: hasEvent(context, "ROUND_FINALIZED")
          ? []
          : [
              event(
                context,
                command,
                "ROUND_FINALIZED",
                { votingRound: receipt.votingRound },
                input.clock.now(),
              ),
            ],
        artifacts: [
          artifact(context.runId, "relay-evidence", {
            version: "1",
            votingRound: receipt.votingRound,
            protocolId: receipt.protocolId,
            finalized: true,
          }),
        ],
        nextCommands: [child(context, "FETCH_DA_PROOF")],
      };
    },

    async FETCH_DA_PROOF(command) {
      const context = await load(command);
      if (hasEvent(context, "PROOF_AVAILABLE")) {
        return { nextCommands: [child(context, "VERIFY_PROOF")] };
      }
      const round = context.events.find((item) => item.type === "ROUND_FINALIZED");
      if (round?.type !== "ROUND_FINALIZED") throw new Error("Voting round is required");
      const preflight = preflightEvidence(context);
      const receipt = artifactValue<{ protocolId: number }>(
        context,
        "receipt-evidence",
      );
      const proof = await input.ports.fetchDaProof({
        runId: context.runId,
        votingRound: round.payload.votingRound,
        requestBytes: preflight.requestBytes,
      });
      const relayRoot = await input.ports.getRelayRoot({
        runId: context.runId,
        votingRound: round.payload.votingRound,
        protocolId: receipt.protocolId,
      });
      const proofHash =
        proof.proofHash ??
        `0x${createHash("sha256")
          .update(Buffer.from(proof.response_hex.slice(2), "hex"))
          .digest("hex")}`;
      return {
        events: [
          event(
            context,
            command,
            "PROOF_AVAILABLE",
            { proofHash },
            input.clock.now(),
          ),
        ],
        artifacts: [
          artifact(context.runId, "proof-evidence", {
            version: "1",
            proof: {
              votingRound: round.payload.votingRound,
              merkleProof: proof.proof,
              response: proof.response_hex,
            },
            attestationType: proof.attestation_type,
            relayRoot,
            proofHash,
          }),
        ],
        nextCommands: [child(context, "VERIFY_PROOF")],
      };
    },

    async VERIFY_PROOF(command) {
      const context = await load(command);
      if (hasEvent(context, "PROOF_VERIFIED")) {
        return { nextCommands: [] };
      }
      const preflight = preflightEvidence(context);
      const proof = artifactValue<Record<string, unknown>>(context, "proof-evidence");
      const verified = await input.ports.verifyProof({
        runId: context.runId,
        proof,
        fdcVerification: preflight.network.resolvedContracts.FdcVerification,
      });
      if (!verified.verified) {
        throw Object.assign(new Error("FdcVerification rejected the proof"), {
          category: "proof-invalid",
          retryable: false,
        });
      }
      return {
        events: [
          event(
            context,
            command,
            "PROOF_VERIFIED",
            { verificationContract: verified.verificationContract },
            input.clock.now(),
          ),
        ],
        artifacts: [
          artifact(context.runId, "verification-evidence", {
            version: "1",
            proofVerified: true,
            verificationContract: verified.verificationContract,
          }),
        ],
        nextCommands: [],
      };
    },

    async VERIFY_CONSUMER(command) {
      const context = await load(command);
      if (hasEvent(context, "CONSUMER_VERIFIED")) {
        return { nextCommands: [child(context, "BUILD_PROOF_BUNDLE")] };
      }
      const consumer = command.payload.consumer;
      if (
        consumer !== "canonical-vulnerable" &&
        consumer !== "canonical-safe"
      ) {
        throw Object.assign(
          new Error("Consumer verification requires an explicit canonical consumer"),
          {
            category: "configuration",
            code: "CONSUMER_INTENT_REQUIRED",
            retryable: false,
          },
        );
      }
      const proof = artifactValue<Record<string, unknown>>(context, "proof-evidence");
      const result = await input.ports.verifyConsumer({
        runId: context.runId,
        manifest: context.manifest,
        proof,
        consumer,
      });
      const diagnostics = DiagnosticV1Schema.array().safeParse(
        result.diagnostics,
      );
      if (!diagnostics.success || (!result.passed && diagnostics.data.length === 0)) {
        throw Object.assign(
          new Error(
            "A failed consumer verification requires versioned diagnostic evidence",
          ),
          {
            category: "consumer-invariant",
            code: "CONSUMER_DIAGNOSTICS_MISSING",
            retryable: false,
            evidence: { consumer },
          },
        );
      }
      const safeSource = generateSafeWeb2JsonConsumer(context.manifest, {
        contractName: "ProoflineSafeWeb2JsonConsumer",
      });
      const safeBytes = encoder.encode(safeSource);
      return {
        events: [
          event(
            context,
            command,
            "CONSUMER_VERIFIED",
            { passed: result.passed, diagnostics: diagnostics.data },
            input.clock.now(),
          ),
        ],
        artifacts: [
          artifact(context.runId, "consumer-evidence", {
            version: "1",
            passed: result.passed,
            diagnostics: diagnostics.data,
          }),
          {
            id: randomUUID(),
            runId: context.runId,
            kind: "safe-consumer",
            canonicalBytes: safeBytes,
            sha256: sha256Bytes(safeBytes),
            metadata: { compiler: "solc-0.8.36" },
          },
        ],
        nextCommands: [child(context, "BUILD_PROOF_BUNDLE")],
      };
    },

    async BUILD_PROOF_BUNDLE(command) {
      const context = await load(command);
      if (context.artifacts.some((item) => item.kind === "proof-bundle")) {
        return { artifacts: [], nextCommands: [] };
      }
      const assembled = await assemblePersistedProofBundle(context);
      return { artifacts: [assembled.artifact], nextCommands: [] };
    },
  };

  return handlers;
}
