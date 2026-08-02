import {
  createRunClient,
  reconcileWalletSubmission,
  submitWithEip1193,
  type Eip1193Provider,
} from "./run-client";
import {
  CreateRunResultV1Schema,
  RunRecoveryV1Schema,
  Web2JsonManifestV1Schema,
  type CreateRunResultV1,
  type ConsumerLabReportV1,
  type EvidenceReceiptV1,
  type PreflightReportV1,
  type RunRecoveryV1,
  type RunListPageV1,
  type ShareLinkV1,
  type SubmissionResponseV1,
  type Web2JsonManifestV1,
} from "../../packages/contracts/src";
import type { ProjectionStages, RunStage } from "../data/run";

export type VerificationCheck = {
  label: string;
  status: "passed" | "failed";
};

export type ConsumerVerificationResult = {
  summary: string;
  code: string;
  checks: VerificationCheck[];
};

export type GeneratedConsumer = {
  source: string;
  sha256?: string;
};

export type RunServiceContext = {
  runId: string;
  projectToken: string;
};

export type HydrateRunContext = RunServiceContext & {
  after: number;
};

export type ListRunsContext = {
  projectToken: string;
  status?: "active" | "completed" | "failed";
  cursor?: string;
  limit?: number;
};

export type CreateRunContext = {
  projectToken: string;
  manifest: Web2JsonManifestV1;
  idempotencyKey: string;
};

export type ConfirmSubmissionContext = RunServiceContext & {
  mode: SubmissionModeView;
  idempotencyKey: string;
};

export type CreateShareContext = RunServiceContext & {
  idempotencyKey: string;
};

export type RunDiagnosticView = {
  version?: string;
  code: string;
  severity: "info" | "warning" | "error";
  confidence: "low" | "medium" | "high";
  summary: string;
  evidence?: Record<string, unknown>;
  remediation?: string;
};

export type RunEvidenceView = {
  transactionHash?: string;
  votingRound?: string;
  fee?: string;
  elapsed?: string;
  explorerUrl?: string;
};

export type SubmissionModeView = "replay" | "wallet" | "relayer";

export type HydratedRunView = {
  runId: string;
  title: string;
  attestationType?: string;
  network?: string;
  startedAt?: string;
  sequence: number;
  terminal: boolean;
  manifest?: Web2JsonManifestV1;
  recovery?: RunRecoveryV1;
  sync?: {
    state: "current" | "partial";
    projectionSequence: number;
    eventSequence: number;
  };
  stages: ProjectionStages;
  stageDetails?: Partial<
    Record<keyof ProjectionStages, Pick<RunStage, "time" | "duration">>
  >;
  submissionMode?: SubmissionModeView;
  diagnostics?: RunDiagnosticView[];
  evidence: RunEvidenceView;
};

export interface RunSurfaceServices {
  createRun?(context: CreateRunContext): Promise<CreateRunResultV1>;
  getPreflightReport?(context: RunServiceContext): Promise<PreflightReportV1>;
  getConsumerLabReport?(context: RunServiceContext): Promise<ConsumerLabReportV1>;
  getEvidenceReceipt?(context: RunServiceContext): Promise<EvidenceReceiptV1>;
  createShare?(context: CreateShareContext): Promise<ShareLinkV1>;
  confirmSubmission?(context: ConfirmSubmissionContext): Promise<
    SubmissionResponseV1 | { transactionHash: string }
  >;
  verifyConsumer(context: RunServiceContext): Promise<ConsumerVerificationResult>;
  generateConsumer(context: RunServiceContext): Promise<GeneratedConsumer>;
  exportBundle(context: RunServiceContext): Promise<string>;
  replayBundle(bundle: string): Promise<{ byteIdentical: boolean }>;
  hydrateRun?(context: HydrateRunContext): Promise<HydratedRunView>;
  listRuns?(context: ListRunsContext): Promise<RunListPageV1>;
  resume?(): { runId: string; after: number } | null;
}

export function submissionIdempotencyKey(
  runId: string,
  mode: SubmissionModeView,
): string {
  return `submission-${mode}-${runId}`;
}

function commandKey(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${id}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function isVerificationResult(value: unknown): value is ConsumerVerificationResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === "string" &&
    typeof record.code === "string" &&
    Array.isArray(record.checks)
  );
}

const urlInvariants = ["scheme", "host", "path", "query"] as const;

type UrlInvariant = (typeof urlInvariants)[number];

const knownUrlInvariants = new Set<string>(urlInvariants);
const codeInvariant = new Map<string, UrlInvariant>([
  ["CONSUMER_SCHEME_MISMATCH", "scheme"],
  ["CONSUMER_HOST_MISMATCH", "host"],
  ["EXPECTED_HOST_NOT_ENFORCED", "host"],
  ["MISSING_CONSUMER_HOST_INVARIANT", "host"],
  ["CONSUMER_PATH_MISMATCH", "path"],
  ["CONSUMER_QUERY_MISMATCH", "query"],
]);

function diagnosticFailures(value: unknown): {
  codes: string[];
  invariants: Set<UrlInvariant>;
} {
  const codes: string[] = [];
  const invariants = new Set<UrlInvariant>();
  if (!Array.isArray(value)) return { codes, invariants };

  for (const item of value) {
    const diagnostic = objectValue(item);
    const code = diagnostic?.code;
    if (typeof code !== "string") continue;

    codes.push(code);
    const invariant = codeInvariant.get(code);
    if (invariant) invariants.add(invariant);

    const evidence = objectValue(diagnostic?.evidence);
    if (!Array.isArray(evidence?.missingChecks)) continue;
    for (const missingCheck of evidence.missingChecks) {
      if (typeof missingCheck === "string" && knownUrlInvariants.has(missingCheck)) {
        invariants.add(missingCheck as UrlInvariant);
      }
    }
  }

  return { codes, invariants };
}

function consumerTerminal(run: Record<string, unknown>): boolean {
  const stages = run.stages;
  if (!stages || typeof stages !== "object") return false;
  const consumer = (stages as Record<string, unknown>).consumer;
  return consumer === "completed" || consumer === "failed";
}

function resultFromRun(run: Record<string, unknown>): ConsumerVerificationResult {
  const { codes, invariants } = diagnosticFailures(run.diagnostics);
  const stages = objectValue(run.stages);
  if (stages?.consumer === "failed" && codes.length === 0) {
    throw new Error(
      "Consumer verification failed closed because diagnostic evidence is missing",
    );
  }
  const isMissing = (part: UrlInvariant) => invariants.has(part);
  const checks: VerificationCheck[] = [
    { label: "Cryptographic proof", status: "passed" },
    { label: "Request identity", status: "passed" },
    { label: "Source scheme invariant", status: isMissing("scheme") ? "failed" : "passed" },
    { label: "Source host invariant", status: isMissing("host") ? "failed" : "passed" },
    { label: "Source path invariant", status: isMissing("path") ? "failed" : "passed" },
    { label: "Source query invariant", status: isMissing("query") ? "failed" : "passed" },
  ];
  const fixCount = invariants.size > 0 ? invariants.size : codes.length;
  return codes.length === 0
    ? { summary: "Consumer invariants verified", code: "CONSUMER_VERIFIED", checks }
    : {
        summary: `Consumer needs ${fixCount === 1 ? "one fix" : `${fixCount} fixes`}`,
        code: codes[0] ?? "CONSUMER_INVARIANT_FAILED",
        checks,
      };
}

const projectionStageNames = [
  "preflight",
  "request",
  "round",
  "proof",
  "verify",
  "consumer",
] as const;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectionStages(value: unknown): ProjectionStages {
  const record = objectValue(value);
  const allowed = new Set(["completed", "active", "pending", "failed"]);
  return Object.fromEntries(
    projectionStageNames.map((name) => {
      const state = record?.[name];
      return [name, typeof state === "string" && allowed.has(state) ? state : "pending"];
    }),
  ) as ProjectionStages;
}

function diagnosticsFrom(value: unknown): RunDiagnosticView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const diagnostics: RunDiagnosticView[] = [];
  for (const candidate of value) {
    const diagnostic = objectValue(candidate);
    const code = stringValue(diagnostic?.code);
    const summary = stringValue(diagnostic?.summary);
    if (!diagnostic || !code || !summary) return undefined;
    const severity = diagnostic.severity;
    const confidence = diagnostic.confidence;
    if (
      severity !== "info" &&
      severity !== "warning" &&
      severity !== "error"
    ) return undefined;
    if (
      confidence !== "low" &&
      confidence !== "medium" &&
      confidence !== "high"
    ) return undefined;
    if (diagnostic.evidence !== undefined && !objectValue(diagnostic.evidence)) {
      return undefined;
    }
    diagnostics.push({
      version: stringValue(diagnostic.version),
      code,
      summary,
      severity,
      confidence,
      evidence: objectValue(diagnostic.evidence) ?? undefined,
      remediation: stringValue(diagnostic.remediation),
    });
  }
  return diagnostics;
}

function submissionModeFrom(value: unknown): SubmissionModeView | undefined {
  return value === "replay" || value === "wallet" || value === "relayer"
    ? value
    : undefined;
}

function eventRecords(values: unknown): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  const records: Record<string, unknown>[] = [];
  for (const value of values) {
    const record = objectValue(value);
    if (record) records.push(record);
  }
  return records;
}

function eventPayload(event: Record<string, unknown> | undefined): Record<string, unknown> {
  return objectValue(event?.payload) ?? {};
}

function eventOfType(events: readonly Record<string, unknown>[], type: string) {
  return events.find((event) => event.type === type);
}

function formatWei(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const padded = value.padStart(19, "0");
  const whole = padded.slice(0, -18);
  const fraction = padded.slice(-18).replace(/0+$/, "").slice(0, 6);
  return `${whole}${fraction ? `.${fraction}` : ""} ETH`;
}

function formatClock(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  return instant.toISOString().slice(11, 19);
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

function stageDetailsFrom(events: readonly Record<string, unknown>[]) {
  const eventTypes = [
    "RUN_CREATED",
    "REQUEST_SUBMITTED",
    "ROUND_FINALIZED",
    "PROOF_AVAILABLE",
    "PROOF_VERIFIED",
    "CONSUMER_VERIFIED",
  ] as const;
  const result: HydratedRunView["stageDetails"] = {};
  let priorTime: number | undefined;
  for (let index = 0; index < projectionStageNames.length; index += 1) {
    const event = eventOfType(events, eventTypes[index]);
    const occurredAt = stringValue(event?.occurredAt);
    if (!occurredAt) continue;
    const timestamp = new Date(occurredAt).getTime();
    result[projectionStageNames[index]] = {
      time: formatClock(occurredAt) ?? "—",
      duration:
        priorTime === undefined || !Number.isFinite(timestamp)
          ? "—"
          : formatDuration(timestamp - priorTime),
    };
    if (Number.isFinite(timestamp)) priorTime = timestamp;
  }
  return result;
}

function titleFrom(run: Record<string, unknown>, events: readonly Record<string, unknown>[]) {
  const explicit = stringValue(run.title);
  if (explicit) return explicit;
  const manifest = objectValue(eventPayload(eventOfType(events, "RUN_CREATED")).manifest);
  const consumer = objectValue(manifest?.consumer);
  const host = stringValue(consumer?.expectedHost);
  return host ? `Web2Json · ${host}` : "Web2Json run";
}

function contiguousEventSequence(events: readonly Record<string, unknown>[]): number {
  let expected = 1;
  for (const event of [...events].sort(
    (left, right) => Number(left.sequence) - Number(right.sequence),
  )) {
    const sequence = Number(event.sequence);
    if (sequence < expected) continue;
    if (sequence !== expected) break;
    expected += 1;
  }
  return expected - 1;
}

function hydrateView(
  runId: string,
  run: Record<string, unknown>,
  events: readonly Record<string, unknown>[],
): HydratedRunView {
  const created = eventOfType(events, "RUN_CREATED");
  const manifest = objectValue(eventPayload(created).manifest);
  const submission = eventPayload(eventOfType(events, "REQUEST_SUBMITTED"));
  const manifestSubmission = objectValue(manifest?.submission);
  const round = eventPayload(eventOfType(events, "ROUND_FINALIZED"));
  const preflight = eventPayload(eventOfType(events, "PREFLIGHT_ACCEPTED"));
  const runEvidence = objectValue(run.evidence) ?? {};
  const transactionHash =
    stringValue(runEvidence.transactionHash) ?? stringValue(submission.transactionHash);
  const startedAt = stringValue(run.startedAt) ?? stringValue(created?.occurredAt);
  const lastOccurredAt = stringValue(events.at(-1)?.occurredAt);
  const elapsed = (() => {
    const explicit = stringValue(runEvidence.elapsed);
    if (explicit) return explicit;
    if (!startedAt || !lastOccurredAt) return undefined;
    const duration = new Date(lastOccurredAt).getTime() - new Date(startedAt).getTime();
    return Number.isFinite(duration) ? formatDuration(duration) : undefined;
  })();
  const diagnostics = diagnosticsFrom(run.diagnostics);
  const consumerEvent = eventOfType(events, "CONSUMER_VERIFIED");
  const consumerEventEvidence = eventPayload(consumerEvent);
  const consumerEventDiagnostics = diagnosticsFrom(consumerEventEvidence.diagnostics);
  const validConsumerEventDiagnostics =
    consumerEventDiagnostics &&
    (consumerEventDiagnostics.length > 0 || consumerEventEvidence.passed === true)
      ? consumerEventDiagnostics
      : undefined;
  const trustedDiagnostics = diagnostics && diagnostics.length > 0
    ? diagnostics
    : consumerEvent && validConsumerEventDiagnostics !== undefined
      ? validConsumerEventDiagnostics
      : undefined;
  const recovery = RunRecoveryV1Schema.safeParse(run.recovery);
  const parsedManifest = Web2JsonManifestV1Schema.safeParse(manifest);
  const projectionSequence =
    typeof run.sequence === "number" && Number.isSafeInteger(run.sequence)
      ? run.sequence
      : events.length;
  const eventSequence = contiguousEventSequence(events);
  return {
    runId,
    title: titleFrom(run, events),
    attestationType:
      stringValue(run.attestationType) ?? stringValue(manifest?.attestationType),
    network: stringValue(run.network) ?? stringValue(manifest?.network),
    startedAt,
    sequence: projectionSequence,
    terminal: run.terminal === true,
    ...(parsedManifest.success ? { manifest: parsedManifest.data } : {}),
    ...(recovery.success ? { recovery: recovery.data } : {}),
    sync: {
      state: eventSequence === projectionSequence ? "current" : "partial",
      projectionSequence,
      eventSequence,
    },
    stages: projectionStages(run.stages),
    stageDetails: stageDetailsFrom(events),
    submissionMode:
      submissionModeFrom(run.submissionMode) ??
      submissionModeFrom(manifestSubmission?.mode) ??
      submissionModeFrom(submission.mode),
    diagnostics: trustedDiagnostics,
    evidence: {
      transactionHash,
      votingRound:
        stringValue(runEvidence.votingRound) ??
        (typeof round.votingRound === "number" ? String(round.votingRound) : undefined),
      fee: stringValue(runEvidence.fee) ?? formatWei(preflight.quotedFeeWei),
      elapsed,
      explorerUrl:
        stringValue(runEvidence.explorerUrl) ??
        (transactionHash
          ? `https://coston2-explorer.flare.network/tx/${transactionHash}`
          : undefined),
    },
  };
}

export function createLiveSurfaceServices(input: {
  baseUrl: string;
  projectToken: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
  recoveryStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  walletProvider?: Eip1193Provider;
  fetch?: typeof globalThis.fetch;
  expectedWebOrigin?: string;
}): RunSurfaceServices {
  const client = createRunClient({
    baseUrl: input.baseUrl,
    projectToken: input.projectToken,
    storage: input.storage,
    fetch: input.fetch,
    expectedWebOrigin: input.expectedWebOrigin,
  });
  const eventsByRun = new Map<string, Record<string, unknown>[]>();
  const recoveryStorage = input.recoveryStorage ?? globalThis.sessionStorage;

  function assertContext(context: RunServiceContext): void {
    if (!input.projectToken || context.projectToken !== input.projectToken) {
      throw new Error("A project token is required to mutate this run");
    }
  }

  function assertReadContext(context: RunServiceContext): void {
    if (!input.projectToken || context.projectToken !== input.projectToken) {
      throw new Error("The configured access credential is required to read this run");
    }
  }

  return {
    async createRun(context) {
      assertContext({ runId: "new-run", projectToken: context.projectToken });
      const result = await client.createRun(
        context.manifest,
        context.idempotencyKey,
      );
      const parsed = CreateRunResultV1Schema.safeParse(result);
      if (!parsed.success) {
        throw new Error("Proofline returned an invalid create-run response contract");
      }
      return parsed.data;
    },

    async listRuns(context) {
      assertContext({ runId: "run-list", projectToken: context.projectToken });
      return client.listRuns({
        status: context.status,
        cursor: context.cursor,
        limit: context.limit,
      });
    },

    async getPreflightReport(context) {
      assertReadContext(context);
      return client.getPreflightReport(context.runId);
    },

    async getConsumerLabReport(context) {
      assertReadContext(context);
      return client.getConsumerLabReport(context.runId);
    },

    async getEvidenceReceipt(context) {
      assertReadContext(context);
      return client.getEvidenceReceipt(context.runId);
    },

    async createShare(context) {
      assertContext(context);
      if (!context.projectToken.startsWith("project_")) {
        throw new Error("A project credential is required; shared runs are read-only");
      }
      return client.createShare(context.runId, context.idempotencyKey);
    },

    async confirmSubmission(context) {
      assertContext(context);
      if (context.mode === "wallet") {
        const provider = input.walletProvider ?? (
          globalThis as typeof globalThis & { ethereum?: Eip1193Provider }
        ).ethereum;
        if (!provider) {
          throw Object.assign(new Error("An EIP-1193 wallet is required"), {
            code: "WALLET_PROVIDER_UNAVAILABLE",
          });
        }
        return submitWithEip1193({
          runId: context.runId,
          idempotencyKey: context.idempotencyKey,
          provider,
          client,
          recoveryStorage,
        });
      }
      return client.confirmSubmission(
        context.runId,
        context.mode,
        context.idempotencyKey,
      );
    },

    async verifyConsumer(context) {
      assertContext(context);
      const accepted = await client.verifyConsumer(
        context.runId,
        commandKey("verify-consumer"),
        "canonical-vulnerable",
      );
      if (isVerificationResult(accepted)) return accepted;

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const run = await client.getRun(context.runId);
        if (consumerTerminal(run)) return resultFromRun(run);
        await delay(500);
      }
      throw new Error("Consumer verification timed out; the run is still available for retry");
    },

    async generateConsumer(context) {
      assertContext(context);
      return client.generateConsumer(context.runId, commandKey("generate-consumer"));
    },

    async exportBundle(context) {
      assertContext(context);
      return client.bundle(context.runId);
    },

    async replayBundle(bundle) {
      const result = await client.replay(bundle, commandKey("replay-bundle"));
      return { byteIdentical: result.byteIdentical };
    },

    async hydrateRun(context) {
      assertContext(context);
      const run = await client.getRun(context.runId);
      const projectionSequence = typeof run.sequence === "number" &&
        Number.isSafeInteger(run.sequence) && run.sequence >= 0
        ? run.sequence
        : 0;
      const cached = eventsByRun.get(context.runId) ?? [];
      const cachedContiguous = contiguousEventSequence(cached);
      const cachedLast = Number(cached.at(-1)?.sequence ?? 0);
      const usableCache = cachedContiguous === cachedLast ? cached : [];
      const merged = new Map<number, Record<string, unknown>>(
        usableCache.map((event) => [Number(event.sequence), event]),
      );
      let cursor = usableCache.length > 0 ? cachedContiguous : 0;
      for (
        let page = 0;
        page < 64 && (page === 0 || cursor < projectionSequence);
        page += 1
      ) {
        const incremental = await client.events(context.runId, cursor);
        const pageEvents = eventRecords(incremental.events);
        for (const event of pageEvents) {
          const sequence = Number(event.sequence);
          if (Number.isSafeInteger(sequence) && sequence > 0) merged.set(sequence, event);
        }
        const nextAfter = Number(incremental.nextAfter);
        if (!Number.isSafeInteger(nextAfter) || nextAfter <= cursor) break;
        cursor = nextAfter;
        if (pageEvents.length < 1_000) break;
      }
      const events = [...merged.values()].sort(
        (left, right) => Number(left.sequence) - Number(right.sequence),
      );
      eventsByRun.set(context.runId, events);
      const view = hydrateView(context.runId, run, events);
      if (view.submissionMode === "wallet") {
        reconcileWalletSubmission({
          runId: context.runId,
          idempotencyKey: submissionIdempotencyKey(context.runId, "wallet"),
          recoveryStorage,
          events: events.map((event) => ({
            type: String(event.type ?? ""),
            payload: eventPayload(event),
          })),
        });
      }
      return view;
    },

    resume: () => client.resume(),
  };
}

export function createTestSurfaceServices(): RunSurfaceServices {
  if (import.meta.env.MODE !== "test") {
    throw new Error("The deterministic Web adapter is available only in test mode");
  }
  return {
    async createRun() {
      throw new Error("Run creation requires an explicit persisted test adapter");
    },
    async listRuns() {
      return { version: "1", runs: [] };
    },
    async verifyConsumer() {
      return {
        summary: "Consumer needs one fix",
        code: "EXPECTED_HOST_NOT_ENFORCED",
        checks: [
          { label: "Cryptographic proof", status: "passed" },
          { label: "Request identity", status: "passed" },
          { label: "Source host invariant", status: "failed" },
          { label: "Replay protection", status: "passed" },
        ],
      };
    },
    async generateConsumer() {
      return {
        source: "requireHost(requestUrl, EXPECTED_HOST);",
        sha256: "0".repeat(64),
      };
    },
    async exportBundle() {
      return JSON.stringify({ version: "1", checksum: `sha256:${"0".repeat(64)}` });
    },
    async replayBundle() {
      return { byteIdentical: true };
    },
    resume: () => null,
  };
}
