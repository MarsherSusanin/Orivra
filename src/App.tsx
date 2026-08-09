import { ArrowClockwise, ArrowRight, CheckCircle, DownloadSimple, FileMagnifyingGlass } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createLocalProductAnalytics,
  createProductEventEmitter,
  type ProductAnalyticsPort,
} from "./services/product-analytics";
import {
  startComposerJourneyFromRuns,
  startDirectComposerJourney,
} from "./services/composer-journey";
import { stageReplacementComposerDraft } from "./services/composer-draft-store";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EvidenceStrip } from "./components/EvidenceStrip";
import { ManifestComposer } from "./components/ManifestComposer";
import { IntegrationPackageDialog } from "./components/IntegrationPackageDialog";
import { PreflightDiagnosticsRail } from "./components/PreflightDiagnosticsRail";
import {
  PreflightWorkbench,
  type PreflightReportSurfaceState,
} from "./components/PreflightWorkbench";
import { RunTimeline } from "./components/RunTimeline";
import { RunsIndex } from "./components/RunsIndex";
import { Sidebar } from "./components/Sidebar";
import { SubmissionDecision } from "./components/SubmissionDecision";
import { Topbar } from "./components/Topbar";
import { VerificationDialog } from "./components/VerificationDialog";
import { WalletSignInDialog } from "./components/WalletSignInDialog";
import {
  WalletSessionProvider,
  useWalletSession,
} from "./wallet-session-context";
import {
  createWalletAccessClient,
  type WalletAccessServices,
} from "./services/wallet-access-client";
import type {
  BrowserPort,
} from "./services/wallet-provider-adapter";
import type { StorageLike } from "./services/wallet-session-controller";
import type { PreflightReportV1, RunRecoveryV1 } from "../packages/contracts/src";
import {
  timelineFromProjection,
  type EvidenceItem,
} from "./data/run";
import {
  createLiveSurfaceServices,
  createTestSurfaceServices,
  submissionIdempotencyKey,
  type HydratedRunView,
  type ConsumerVerificationResult,
  type RunSurfaceServices,
} from "./services/run-surface";

const SHARE_TOKEN_PATTERN = /^share_[a-f0-9]{64}$/;
const UNAVAILABLE_STORAGE = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export type AppProps = {
  runId?: string;
  projectToken?: string;
  services?: RunSurfaceServices;
  analytics?: ProductAnalyticsPort;
  walletAccess?: {
    services: WalletAccessServices;
    storage: StorageLike;
    dialog?: {
      loadProviderAdapter?: () => Promise<
        typeof import("./services/wallet-provider-adapter")
      >;
      browser?: BrowserPort;
      clock?: { wait(milliseconds: number): Promise<void> };
    };
  };
};

function browserLocalStorage() {
  try {
    return globalThis.localStorage ?? UNAVAILABLE_STORAGE;
  } catch {
    return UNAVAILABLE_STORAGE;
  }
}

function browserSessionStorage() {
  try {
    const storage = globalThis.sessionStorage;
    const prototype = globalThis.Storage?.prototype;
    if (!storage) return UNAVAILABLE_STORAGE;
    if (!prototype) return storage;
    return {
      getItem: (key: string) => prototype.getItem.call(storage, key),
      setItem: (key: string, value: string) => prototype.setItem.call(storage, key, value),
      removeItem: (key: string) => prototype.removeItem.call(storage, key),
    };
  } catch {
    return UNAVAILABLE_STORAGE;
  }
}

function browserCrypto() {
  try {
    return globalThis.crypto;
  } catch {
    return undefined;
  }
}

function persistedConsumerFailure(
  run: HydratedRunView,
): ConsumerVerificationResult | undefined {
  if (run.stages.consumer !== "failed") return undefined;
  const diagnostics = run.diagnostics ?? [];
  return {
    summary: diagnostics.length === 1
      ? "Consumer needs 1 fix"
      : `Consumer needs ${diagnostics.length} fixes`,
    code: diagnostics[0]?.code ?? "CONSUMER_INVARIANT_FAILED",
    checks: diagnostics.length > 0
      ? diagnostics.map((diagnostic) => ({
          label: diagnostic.summary,
          status: "failed" as const,
        }))
      : [{ label: "Persisted consumer invariant", status: "failed" as const }],
  };
}

function useProductEventEmitter(analytics: ProductAnalyticsPort | undefined) {
  const analyticsPort = useMemo(() => {
    if (analytics) return analytics;
    return createLocalProductAnalytics({ storage: browserLocalStorage() });
  }, [analytics]);

  return useMemo(
    () => createProductEventEmitter({
      analytics: analyticsPort,
      storage: browserSessionStorage(),
      crypto: browserCrypto(),
    }),
    [analyticsPort],
  );
}

function shareSessionKey(runId: string): string {
  return `proofline:share-token:${runId}`;
}

function scrubShareLocation(url: URL): void {
  globalThis.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

type ShareBootstrap = {
  attempted: boolean;
  handoffRevision?: number;
  token: string;
};

let shareBootstrapHandoff: {
  href: string;
  revision: number;
  result: ShareBootstrap;
  runId: string;
} | null = null;
let shareBootstrapRevision = 0;

function stageShareBootstrapHandoff(
  runId: string,
  href: string,
  result: Omit<ShareBootstrap, "handoffRevision">,
): ShareBootstrap {
  const revision = ++shareBootstrapRevision;
  const staged = { ...result, handoffRevision: revision };
  shareBootstrapHandoff = { href, revision, result: staged, runId };
  globalThis.queueMicrotask(() => {
    clearShareBootstrapHandoff(revision);
  });
  return staged;
}

function takeShareBootstrapHandoff(runId: string, href: string): ShareBootstrap | null {
  const pending = shareBootstrapHandoff;
  if (!pending) return null;
  shareBootstrapHandoff = null;
  if (pending.runId !== runId || pending.href !== href) return null;
  return pending.result;
}

function clearShareBootstrapHandoff(revision: number | undefined): void {
  if (revision !== undefined && shareBootstrapHandoff?.revision === revision) {
    shareBootstrapHandoff = null;
  }
}

function storedShareToken(runId: string): string {
  try {
    const shared = browserSessionStorage().getItem(shareSessionKey(runId));
    return shared && SHARE_TOKEN_PATTERN.test(shared) ? shared : "";
  } catch {
    return "";
  }
}

function sessionShareAuthority(): ShareBootstrap {
  const runId = deepRouteRunId();
  if (runId && globalThis.location) {
    const url = new URL(globalThis.location.href);
    const queryShare = url.searchParams.has("share");
    if (queryShare) url.searchParams.delete("share");
    const fragmentAttempt = url.hash.startsWith("#share=");
    const fragmentValue = fragmentAttempt ? url.hash.slice("#share=".length) : "";
    if (!queryShare && !fragmentAttempt) {
      const handoff = takeShareBootstrapHandoff(runId, url.href);
      if (handoff) return handoff;
    }
    if (queryShare || fragmentAttempt) {
      url.hash = "";
      scrubShareLocation(url);
      if (queryShare || !SHARE_TOKEN_PATTERN.test(fragmentValue)) {
        return stageShareBootstrapHandoff(runId, url.href, {
          attempted: true,
          token: storedShareToken(runId),
        });
      }
      try {
        browserSessionStorage().setItem(shareSessionKey(runId), fragmentValue);
      } catch {
        // Current valid authority remains usable in memory when persistence is denied.
      }
      return stageShareBootstrapHandoff(runId, url.href, {
        attempted: true,
        token: fragmentValue,
      });
    }
    return { attempted: false, token: storedShareToken(runId) };
  }
  return { attempted: false, token: "" };
}

function walletApiBaseUrl(): string {
  const configured = import.meta.env.VITE_PROOFLINE_API_BASE_URL ?? "/api";
  return new URL(configured, globalThis.location?.origin ?? "http://localhost").toString();
}

function deepRouteRunId(): string | null {
  const match = /^\/runs\/([^/]+)\/?$/.exec(globalThis.location?.pathname ?? "");
  if (!match || match[1] === "new") return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function displayNetwork(value: string | undefined): string {
  if (!value) return "Coston2";
  return value.toLowerCase() === "coston2" ? "Coston2" : value;
}

function displayStartedAt(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()} ${date
    .toISOString()
    .slice(11, 19)} UTC`;
}

function shortHash(value: string): string {
  return value.length > 22 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}

function evidenceFromRun(run: HydratedRunView): EvidenceItem[] {
  const evidence = run.evidence;
  return [
    {
      label: "Transaction hash",
      value: evidence.transactionHash ? shortHash(evidence.transactionHash) : "—",
      rawValue: evidence.transactionHash,
      kind: evidence.transactionHash ? "copy" : undefined,
    },
    { label: "Voting round", value: evidence.votingRound ?? "—" },
    { label: "Fee", value: evidence.fee ?? "—" },
    { label: "Elapsed time", value: evidence.elapsed ?? "—" },
    {
      label: "Explorer",
      value: evidence.explorerUrl ? "View on Blockscout" : "—",
      kind: evidence.explorerUrl ? "external" : undefined,
      href: evidence.explorerUrl,
    },
  ];
}

function safeHydrationError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Run hydration failed";
  const redacted = message
    .replace(/(?:project|share)_[a-f0-9]{64}/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  return /failed to fetch|network|connection|offline/i.test(redacted)
    ? "Connection lost. Persisted evidence is still available."
    : redacted;
}

const RUN_STAGE_ORDER = [
  "preflight",
  "request",
  "round",
  "proof",
  "verify",
  "consumer",
] as const;

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function currentStage(stages: HydratedRunView["stages"]) {
  const failed = RUN_STAGE_ORDER.find((stage) => stages[stage] === "failed");
  const active = RUN_STAGE_ORDER.find((stage) => stages[stage] === "active");
  const incomplete = RUN_STAGE_ORDER.find((stage) => stages[stage] !== "completed");
  const stage = failed ?? active ?? incomplete ?? "consumer";
  return { stage, state: stages[stage] };
}

function pendingActionCopy(stage: string, state: string) {
  const label = sentenceCase(stage);
  if (state === "failed") {
    return {
      title: `${label} failed.`,
      description: `Review the persisted ${stage} evidence before continuing this run.`,
    };
  }
  if (state === "active") {
    return {
      title: `${label} is in progress.`,
      description: `Proofline is waiting for the persisted ${stage} transition to complete.`,
    };
  }
  return {
    title: `Waiting for ${stage}.`,
    description: `The ${stage} stage has not started yet. Existing evidence remains available below.`,
  };
}

function recoveryTitle(recovery: RunRecoveryV1): string {
  if (recovery.state === "waiting") return "Waiting safely";
  if (recovery.state === "retryable") return "Retry scheduled";
  return "Recovery stopped";
}

function recoveryDetail(recovery: RunRecoveryV1): string {
  const checkpoint = recovery.resumeFrom.replaceAll("-", " ");
  if (recovery.state === "waiting") {
    return `Proofline is observing the persisted ${checkpoint}; no manual retry is required.`;
  }
  if (recovery.state === "retryable") {
    return `Proofline will retry the same command from ${checkpoint} without creating another effect.`;
  }
  return recovery.retrySafety === "new-run-required"
    ? `The preserved evidence cannot safely continue. Create a new run from the original manifest.`
    : `The effect state is ambiguous. Review persisted evidence before any operator action.`;
}

function RecoveryPanel({
  recovery,
  projectAccess,
  onRefresh,
  onCreateRun,
  onReview,
}: {
  recovery: RunRecoveryV1;
  projectAccess: boolean;
  onRefresh(): void;
  onCreateRun(): void;
  onReview(): void;
}) {
  const updated = new Date(recovery.updatedAt).toLocaleString("en", {
    timeZone: "UTC",
    timeZoneName: "short",
  });
  const evidence = recovery.preservedEvidence.length > 0
    ? recovery.preservedEvidence.join(", ")
    : "No effect evidence yet";
  return (
    <section className={`run-recovery is-${recovery.state}`} role="region" aria-label="Run recovery">
      <div className="run-recovery-heading">
        <span className="section-label">Recovery</span>
        <h2>{recoveryTitle(recovery)}</h2>
        <p>{recoveryDetail(recovery)}</p>
      </div>
      <dl className="run-recovery-facts">
        <div><dt>Stage</dt><dd>{sentenceCase(recovery.stage)}</dd></div>
        <div><dt>Attempt</dt><dd>Attempt {recovery.attempt}</dd></div>
        <div><dt>Resume from</dt><dd>{recovery.resumeFrom.replaceAll("-", " ")}</dd></div>
        <div><dt>Last update</dt><dd>{updated}</dd></div>
        <div><dt>Saved evidence</dt><dd>{evidence}</dd></div>
        <div><dt>Retry safety</dt><dd>{recovery.retrySafety.replaceAll("-", " ")}</dd></div>
      </dl>
      {"retryAfter" in recovery && recovery.retryAfter ? (
        <p className="run-recovery-next">Expected wait until {new Date(recovery.retryAfter).toLocaleTimeString("en", { timeZone: "UTC", timeZoneName: "short" })}</p>
      ) : null}
      {recovery.state === "retryable" ? (
        <button className="recovery-action" type="button" onClick={onRefresh}>
          <ArrowClockwise size={19} aria-hidden="true" />Refresh status
        </button>
      ) : null}
      {recovery.state === "terminal" && recovery.retrySafety === "new-run-required" && projectAccess ? (
        <button className="recovery-action" type="button" onClick={onCreateRun}>Create new run</button>
      ) : null}
      {recovery.state === "terminal" && recovery.retrySafety === "operator-review" ? (
        <button className="recovery-action" type="button" onClick={onReview}>Review evidence</button>
      ) : null}
    </section>
  );
}

function diagnosticsPanelFromLocation(): boolean {
  return new URLSearchParams(globalThis.location?.search ?? "").get("panel") === "diagnostics";
}

type SecondaryPanel = "diagnostics" | "consumer" | "integration";

function secondaryPanelFromLocation(): SecondaryPanel | null {
  const panel = new URLSearchParams(globalThis.location?.search ?? "").get("panel");
  return panel === "diagnostics" || panel === "consumer" || panel === "integration"
    ? panel
    : null;
}

function writeSecondaryPanel(panel: SecondaryPanel | null): void {
  const url = new URL(globalThis.location.href);
  if (panel) url.searchParams.set("panel", panel);
  else url.searchParams.delete("panel");
  globalThis.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function writeDiagnosticsPanel(open: boolean): void {
  writeSecondaryPanel(open ? "diagnostics" : null);
}

type RunJourneyStep = "preflight" | "submission";

function runStepFromLocation(): RunJourneyStep | null {
  const step = new URLSearchParams(globalThis.location?.search ?? "").get("step");
  return step === "preflight" || step === "submission" ? step : null;
}

function writeRunStep(step: RunJourneyStep): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("step", step);
  globalThis.history.pushState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

type ProofObservation = {
  sequence: number;
  state: HydratedRunView["stages"]["proof"];
};

type PreflightObservation = {
  sequence: number;
  state: HydratedRunView["stages"]["preflight"];
};

type PreflightReportAttempt =
  | { kind: "loading"; sequence: number; promise: Promise<PreflightReportV1> }
  | { kind: "pending"; sequence: number }
  | { kind: "terminal"; sequence: number }
  | { kind: "valid"; sequence: number };

function proofStateRank(state: ProofObservation["state"]): number {
  if (state === "pending") return 0;
  if (state === "active") return 1;
  return 2;
}

function preflightStateRank(state: PreflightObservation["state"]): number {
  if (state === "pending") return 0;
  if (state === "active") return 1;
  return 2;
}

function reportFailureKind(cause: unknown): Exclude<PreflightReportSurfaceState["kind"], "loading" | "valid"> {
  const code = cause && typeof cause === "object" && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  if (code === "PREFLIGHT_REPORT_PENDING") return "pending";
  if (code === "PREFLIGHT_REPORT_UNAVAILABLE") return "unavailable";
  if (code === "PREFLIGHT_REPORT_INVALID") return "invalid";
  return "transport";
}

type ProductRouteProps = Pick<AppProps, "runId" | "services" | "analytics"> & {
  authorityToken: string;
  onRequireWallet(): void;
};

function RunCockpit({
  runId,
  authorityToken,
  services,
  analytics,
  onRequireWallet,
}: ProductRouteProps) {
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(diagnosticsPanelFromLocation);
  const [runStep, setRunStep] = useState(runStepFromLocation);
  const [verificationOpen, setVerificationOpen] = useState(
    () => secondaryPanelFromLocation() === "consumer",
  );
  const [integrationOpen, setIntegrationOpen] = useState(
    () => secondaryPanelFromLocation() === "integration",
  );
  const [bundleState, setBundleState] = useState<"idle" | "running" | "verified" | "error">("idle");
  const [bundleSource, setBundleSource] = useState<string | null>(null);
  const [bundleError, setBundleError] = useState("");
  const [hydratedRun, setHydratedRun] = useState<HydratedRunView | null>(null);
  const [hydrationError, setHydrationError] = useState("");
  const [hydrationRevision, setHydrationRevision] = useState(0);
  const [preflightReportState, setPreflightReportState] = useState<PreflightReportSurfaceState>({ kind: "loading" });
  const verifyTrigger = useRef<HTMLButtonElement>(null);
  const integrationTrigger = useRef<HTMLButtonElement>(null);
  const observedProofState = useRef(new Map<string, ProofObservation>());
  const observedPreflightState = useRef(new Map<string, PreflightObservation>());
  const recordedProofRuns = useRef(new Set<string>());
  const recordedPreflightRuns = useRef(new Set<string>());
  const preflightReportAttempts = useRef(new Map<string, PreflightReportAttempt>());
  const [routeRunId] = useState(deepRouteRunId);
  const resolvedToken = authorityToken;
  const emitProductEvent = useProductEventEmitter(analytics);
  const servicePort = useMemo(() => {
    if (services) return services;
    if (import.meta.env.MODE === "test") return createTestSurfaceServices();
    return createLiveSurfaceServices({
      baseUrl: import.meta.env.VITE_PROOFLINE_API_BASE_URL ?? "/api",
      projectToken: resolvedToken,
      storage: browserLocalStorage(),
      recoveryStorage: browserSessionStorage(),
    });
  }, [resolvedToken, services]);
  const [resumedRun] = useState(() => servicePort.resume?.() ?? null);
  const [activeRunId] = useState(
    () => runId ?? routeRunId ?? resumedRun?.runId ?? "",
  );
  const shouldHydrate = Boolean(
    servicePort.hydrateRun &&
    resolvedToken &&
    (runId || routeRunId || resumedRun?.runId),
  );
  const isProjectAccess = resolvedToken.startsWith("project_");
  const effectiveRunStep = runStep ?? (
    hydratedRun?.stages.preflight === "active" || hydratedRun?.stages.preflight === "failed"
      ? "preflight"
      : null
  );
  const showsPreflightWorkbench = effectiveRunStep === "preflight";
  const showsSubmissionDecision = effectiveRunStep === "submission";
  const needsPreflightReport = showsPreflightWorkbench || showsSubmissionDecision;

  useEffect(() => {
    const restoreRouteState = () => {
      const panel = secondaryPanelFromLocation();
      setDiagnosticExpanded(panel === "diagnostics");
      setVerificationOpen(panel === "consumer");
      setIntegrationOpen(panel === "integration");
      setRunStep(runStepFromLocation());
    };
    globalThis.addEventListener("popstate", restoreRouteState);
    return () => globalThis.removeEventListener("popstate", restoreRouteState);
  }, []);

  useEffect(() => {
    if (!shouldHydrate || !servicePort.hydrateRun) return;
    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const load = async (after: number) => {
      try {
        const runPromise = servicePort.hydrateRun!({
          runId: activeRunId,
          projectToken: resolvedToken,
          after,
        });
        const existingReportAttempt = preflightReportAttempts.current.get(activeRunId);
        const initialReportPromise = (
          runStepFromLocation() === "preflight" ||
          runStepFromLocation() === "submission"
        ) && existingReportAttempt === undefined
          ? servicePort.getPreflightReport
            ? (() => {
                const promise = servicePort.getPreflightReport!({
                  runId: activeRunId,
                  projectToken: resolvedToken,
                });
                preflightReportAttempts.current.set(activeRunId, {
                  kind: "loading",
                  sequence: after,
                  promise,
                });
                return promise.then(
                  (report) => ({ kind: "valid" as const, report }),
                  (cause: unknown) => ({ kind: reportFailureKind(cause) }),
                );
              })()
            : Promise.resolve({ kind: "unavailable" as const })
          : Promise.resolve(null);
        const [run, initialReport] = await Promise.all([
          runPromise,
          initialReportPromise,
        ]);
        if (cancelled) return;
        if (initialReport?.kind === "valid") {
          preflightReportAttempts.current.set(activeRunId, {
            kind: "valid",
            sequence: run.sequence,
          });
          setPreflightReportState({ kind: "valid", report: initialReport.report });
        } else if (initialReport) {
          preflightReportAttempts.current.set(activeRunId, {
            kind: initialReport.kind === "pending" ? "pending" : "terminal",
            sequence: run.sequence,
          });
          setPreflightReportState({ kind: initialReport.kind });
        }
        const previousProof = observedProofState.current.get(run.runId);
        const previousPreflight = observedPreflightState.current.get(run.runId);
        const proofCompletedNow =
          previousProof !== undefined &&
          run.sequence > previousProof.sequence &&
          (previousProof.state === "pending" || previousProof.state === "active") &&
          run.stages.proof === "completed";
        const proofSource = run.submissionMode === "replay"
          ? "replay"
          : run.submissionMode === "wallet" || run.submissionMode === "relayer"
            ? "live"
            : undefined;
        if (
          proofCompletedNow &&
          proofSource !== undefined &&
          !recordedProofRuns.current.has(run.runId)
        ) {
          recordedProofRuns.current.add(run.runId);
          emitProductEvent({
            name: "PROOF_AVAILABLE",
            metadata: { source: proofSource },
          });
        }
        const preflightCompletedNow =
          previousPreflight !== undefined &&
          run.sequence > previousPreflight.sequence &&
          (previousPreflight.state === "pending" || previousPreflight.state === "active") &&
          (run.stages.preflight === "completed" || run.stages.preflight === "failed");
        if (
          preflightCompletedNow &&
          isProjectAccess &&
          !recordedPreflightRuns.current.has(run.runId)
        ) {
          recordedPreflightRuns.current.add(run.runId);
          emitProductEvent({
            name: "PREFLIGHT_COMPLETED",
            metadata: {
              outcome: run.stages.preflight === "completed" ? "accepted" : "rejected",
            },
          });
        }
        if (
          previousProof === undefined ||
          (
            run.sequence > previousProof.sequence &&
            previousProof.state !== "completed" &&
            previousProof.state !== "failed" &&
            proofStateRank(run.stages.proof) >= proofStateRank(previousProof.state)
          )
        ) {
          observedProofState.current.set(run.runId, {
            sequence: run.sequence,
            state: run.stages.proof,
          });
        }
        if (
          previousPreflight === undefined ||
          (
            run.sequence > previousPreflight.sequence &&
            previousPreflight.state !== "completed" &&
            previousPreflight.state !== "failed" &&
            preflightStateRank(run.stages.preflight) >= preflightStateRank(previousPreflight.state)
          )
        ) {
          observedPreflightState.current.set(run.runId, {
            sequence: run.sequence,
            state: run.stages.preflight,
          });
        }
        setHydratedRun(run);
        setHydrationError("");
        if (!run.terminal) {
          timer = globalThis.setTimeout(() => void load(run.sequence), 1_500);
        }
      } catch (cause) {
        if (cancelled) return;
        setHydrationError(safeHydrationError(cause));
      }
    };

    globalThis.queueMicrotask(() => {
      if (!cancelled) {
        void load(hydrationRevision === 0 ? 0 : (hydratedRun?.sequence ?? 0));
      }
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  // `hydratedRun` is intentionally read as the cursor without making each response restart the effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, emitProductEvent, hydrationRevision, isProjectAccess, resolvedToken, servicePort, shouldHydrate]);

  useEffect(() => {
    if (!needsPreflightReport || !hydratedRun) return;
    let cancelled = false;
    const runSequence = hydratedRun.sequence;
    const attempt = preflightReportAttempts.current.get(activeRunId);

    if (attempt?.kind === "valid") return;
    if (attempt?.kind === "terminal") return;
    if (attempt?.kind === "pending" && runSequence <= attempt.sequence) return;

    if (!servicePort.getPreflightReport) {
      preflightReportAttempts.current.set(activeRunId, {
        kind: "terminal",
        sequence: runSequence,
      });
      setPreflightReportState({ kind: "unavailable" });
      return;
    }

    const request = attempt?.kind === "loading"
      ? attempt.promise
      : servicePort.getPreflightReport({
          runId: activeRunId,
          projectToken: resolvedToken,
        });
    if (attempt?.kind !== "loading") {
      preflightReportAttempts.current.set(activeRunId, {
        kind: "loading",
        sequence: runSequence,
        promise: request,
      });
      setPreflightReportState({ kind: "loading" });
    }

    void request.then(
      (report) => {
        preflightReportAttempts.current.set(activeRunId, {
          kind: "valid",
          sequence: runSequence,
        });
        if (!cancelled) setPreflightReportState({ kind: "valid", report });
      },
      (cause: unknown) => {
        const kind = reportFailureKind(cause);
        preflightReportAttempts.current.set(activeRunId, {
          kind: kind === "pending" ? "pending" : "terminal",
          sequence: runSequence,
        });
        if (!cancelled) setPreflightReportState({ kind });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [activeRunId, hydratedRun?.sequence, needsPreflightReport, resolvedToken, servicePort]);

  const closeVerification = () => {
    setVerificationOpen(false);
    if (secondaryPanelFromLocation() === "consumer") writeSecondaryPanel(null);
    verifyTrigger.current?.focus();
  };

  const openVerification = () => {
    writeSecondaryPanel("consumer");
    setVerificationOpen(true);
    setIntegrationOpen(false);
  };

  const closeIntegration = () => {
    setIntegrationOpen(false);
    if (secondaryPanelFromLocation() === "integration") writeSecondaryPanel(null);
    (integrationTrigger.current ?? verifyTrigger.current)?.focus();
  };

  const openIntegration = () => {
    writeSecondaryPanel("integration");
    setVerificationOpen(false);
    setIntegrationOpen(true);
  };

  const toggleDiagnostics = () => {
    const nextExpanded = !diagnosticExpanded;
    writeDiagnosticsPanel(nextExpanded);
    setDiagnosticExpanded(nextExpanded);
    if (nextExpanded) {
      setVerificationOpen(false);
      setIntegrationOpen(false);
    }
  };

  const continueToSubmission = () => {
    writeRunStep("submission");
    setRunStep("submission");
  };

  const returnToPreflight = () => {
    writeRunStep("preflight");
    setRunStep("preflight");
  };

  const confirmSubmission = async ({
    mode,
    idempotencyKey,
  }: {
    mode: "wallet" | "relayer" | "replay";
    idempotencyKey: string;
  }) => {
    if (!servicePort.confirmSubmission) {
      throw Object.assign(new Error("Submission adapter is unavailable"), {
        code: "SUBMISSION_UNAVAILABLE",
      });
    }
    return servicePort.confirmSubmission({
      runId: activeRunId,
      projectToken: resolvedToken,
      mode,
      idempotencyKey,
    });
  };

  const exportBundle = async () => {
    setBundleState("running");
    setBundleError("");
    setBundleSource(null);
    let outcomeRecorded = false;
    try {
      const bundle = await servicePort.exportBundle({
        runId: activeRunId,
        projectToken: resolvedToken,
      });
      const replay = await servicePort.replayBundle(bundle);
      if (!replay.byteIdentical) {
        emitProductEvent({
          name: "BUNDLE_REPLAYED",
          metadata: { outcome: "mismatch" },
        });
        outcomeRecorded = true;
        throw new Error("Replay bytes differ from the exported bundle");
      }
      setBundleSource(bundle);
      setBundleState("verified");
      emitProductEvent({
        name: "BUNDLE_REPLAYED",
        metadata: { outcome: "byte-identical" },
      });
      outcomeRecorded = true;
    } catch (cause) {
      if (!outcomeRecorded) {
        emitProductEvent({
          name: "BUNDLE_REPLAYED",
          metadata: { outcome: "rejected" },
        });
      }
      const message = cause instanceof Error ? cause.message : "Bundle export failed";
      setBundleError(message.replace(/(?:project|share)_[a-f0-9]{64}/gi, "[REDACTED]"));
      setBundleState("error");
    }
  };

  const evidence = useMemo(
    () => hydratedRun ? evidenceFromRun(hydratedRun) : undefined,
    [hydratedRun],
  );

  if (activeRunId && !resolvedToken) {
    return (
      <div className="app-shell">
        <Sidebar />
        <div className="shell-main entry-shell-main">
          <Topbar title="Sign in required" attestationType="Web2Json" mode="new" />
          <main className="entry-layout">
            <section className="entry-state">
              <h1>Sign in to open run</h1>
              <p>Use your wallet to restore this browser session and load the persisted evidence.</p>
              <div className="entry-state-actions">
                <button className="entry-primary" type="button" onClick={onRequireWallet}>
                  Sign in with wallet
                </button>
                <a className="entry-secondary" href="/runs">Back to runs</a>
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }

  if (!activeRunId || !servicePort.hydrateRun || !hydratedRun) {
    const missingIdentity = !activeRunId;
    const missingLoader = Boolean(activeRunId && !servicePort.hydrateRun);
    const unavailable = missingLoader || hydrationError.length > 0;
    const heading = missingIdentity
      ? "No persisted run selected"
      : missingLoader
        ? "Run unavailable"
        : unavailable && /404|not found/i.test(hydrationError)
          ? "Run not found"
          : unavailable
            ? "Run unavailable"
            : "Loading run…";
    const description = missingIdentity
      ? "Choose a persisted run from the Runs page."
      : missingLoader
        ? "This surface has no persisted run loader."
        : unavailable
          ? hydrationError
          : "Reading the persisted lifecycle and evidence.";
    return (
      <div className="app-shell">
        <Sidebar />
        <div className="shell-main entry-shell-main">
          <Topbar
            title={heading}
            attestationType="Web2Json"
            mode="new"
          />
          <main className="entry-layout">
            <section className={`entry-state${unavailable ? " is-error" : ""}`} role={unavailable ? "alert" : undefined}>
              <h1>{heading}</h1>
              <p>{description}</p>
              <a className="entry-secondary" href="/runs">Back to runs</a>
            </section>
          </main>
        </div>
      </div>
    );
  }

  const title = hydratedRun.title;
  const attestationType = hydratedRun.attestationType ?? "Web2Json";
  const network = displayNetwork(hydratedRun.network);
  const startedAt = displayStartedAt(hydratedRun.startedAt);
  const timeline = timelineFromProjection(hydratedRun.stages, hydratedRun.stageDetails);
  const consumerFailed = hydratedRun.stages.consumer === "failed";
  const consumerTerminal = hydratedRun.stages.consumer === "completed";
  const readOnlyHandoff = !isProjectAccess && consumerFailed;
  const handoffReady = consumerTerminal || readOnlyHandoff;
  const proofAvailable = hydratedRun.stages.proof === "completed";
  const activeStage = currentStage(hydratedRun.stages);
  const activeStageLabel = sentenceCase(activeStage.stage);
  const waitingCopy = pendingActionCopy(activeStage.stage, activeStage.state);
  const refreshStatus = () => {
    setHydrationError("");
    setHydrationRevision((value) => value + 1);
  };
  const createReplacementRun = () => {
    if (!hydratedRun.manifest) return;
    const replacementId = browserCrypto()?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const staged = stageReplacementComposerDraft(browserSessionStorage(), {
      sourceRunId: activeRunId,
      manifest: hydratedRun.manifest,
      updatedAt: new Date().toISOString(),
      createIdempotencyKey: `composer_${replacementId}`,
    });
    if (staged.state !== "stored") {
      setHydrationError("The persisted manifest could not be copied safely. Refresh and try again.");
      return;
    }
    const destination = `/runs/new?from=${encodeURIComponent(activeRunId)}`;
    if (import.meta.env.MODE === "test") {
      globalThis.history.pushState({}, "", destination);
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    } else {
      globalThis.location.assign(destination);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="shell-main">
        <Topbar
          title={title}
          network={network}
          attestationType={attestationType}
          proofAvailable={proofAvailable}
          statusLabel={`${activeStageLabel} ${activeStage.state}`}
        />
        <main className="run-layout" id="run">
          <section className="run-primary" aria-labelledby="run-title">
            <header className="run-heading">
              <span className="section-label">Run detail</span>
              <h1 id="run-title">{title}</h1>
              <p>Attestation: <strong>{attestationType}</strong><span aria-hidden="true">•</span>Network: <strong>{network}</strong><span aria-hidden="true">•</span>Started: {startedAt}</p>
              {hydrationError ? <span className="hydration-error" role="alert">{hydrationError}</span> : null}
              {hydratedRun.sync?.state === "partial" ? (
                <span className="hydration-error" role="alert">
                  {hydratedRun.sync.eventSequence > hydratedRun.sync.projectionSequence
                    ? "Partial journal: event feed is ahead of the persisted projection snapshot."
                    : "Partial journal: persisted projection is ahead of locally loaded events."}
                </span>
              ) : null}
            </header>
            <RunTimeline stages={timeline} />
            {hydratedRun.recovery ? (
              <RecoveryPanel
                recovery={hydratedRun.recovery}
                projectAccess={isProjectAccess}
                onRefresh={refreshStatus}
                onCreateRun={createReplacementRun}
                onReview={() => {
                  if (!diagnosticExpanded) toggleDiagnostics();
                }}
              />
            ) : showsPreflightWorkbench ? (
              <PreflightWorkbench
                state={preflightReportState}
                readOnly={!isProjectAccess}
                onContinue={continueToSubmission}
              />
            ) : showsSubmissionDecision ? (
              preflightReportState.kind === "valid" && hydratedRun.submissionMode ? (
                <SubmissionDecision
                  mode={hydratedRun.submissionMode}
                  report={preflightReportState.report}
                  canConfirm={
                    isProjectAccess &&
                    !hydratedRun.terminal &&
                    hydratedRun.stages.preflight === "completed" &&
                    hydratedRun.stages.request === "pending" &&
                    preflightReportState.report.verdict !== "blocked" &&
                    Boolean(servicePort.confirmSubmission)
                  }
                  idempotencyKey={submissionIdempotencyKey(
                    activeRunId,
                    hydratedRun.submissionMode,
                  )}
                  onConfirm={confirmSubmission}
                  onRequested={(mode) => emitProductEvent({
                    name: "SUBMISSION_REQUESTED",
                    metadata: { mode },
                  })}
                  onBack={returnToPreflight}
                />
              ) : (
                <section
                  className="next-action preflight-workbench preflight-workbench-state is-loading"
                  aria-label="Submission decision"
                  aria-live="polite"
                >
                  <span className="preflight-state-icon" aria-hidden="true">
                    <FileMagnifyingGlass size={34} />
                  </span>
                  <div className="preflight-state-copy" role="status">
                    <span className="section-label">Submission decision</span>
                    <h2>Loading persisted authorization</h2>
                    <p>Reading the immutable mode and exact preflight evidence for this run.</p>
                  </div>
                </section>
              )
            ) : (
            <section className="next-action" aria-labelledby="next-action-title">
              <span className="next-action-icon" aria-hidden="true"><FileMagnifyingGlass size={51} /></span>
              <div className="next-action-content">
                {proofAvailable ? (
                  <>
                    <h2 id="next-action-title">{handoffReady ? "Evidence is ready." : "Proof is ready."}</h2>
                    <p>{handoffReady ? "Take the verified receipt and integration artifacts into your repository." : "Verify your consumer contract before consuming the attestation."}</p>
                    {handoffReady ? (
                      <button ref={integrationTrigger} className="verify-button" type="button" onClick={openIntegration}>Open integration package<ArrowRight size={28} weight="bold" aria-hidden="true" /></button>
                    ) : isProjectAccess ? (
                      <button ref={verifyTrigger} className="verify-button" type="button" onClick={openVerification}>{consumerFailed ? "Resume Consumer Lab" : "Verify consumer"}<ArrowRight size={28} weight="bold" aria-hidden="true" /></button>
                    ) : (
                      <span className="stage-waiting-state is-pending">Read-only shared run · consumer evidence pending</span>
                    )}
                    <div className="action-footer">
                      <span>{handoffReady ? "Next step: Add the persisted artifacts to your repository." : "Next step: Verify consumer invariants and enforcement."}</span>
                      {isProjectAccess && bundleState === "verified" && bundleSource ? (
                        <a
                          className="bundle-download"
                          href={`data:application/json;charset=utf-8,${encodeURIComponent(bundleSource)}`}
                          download={`${activeRunId}.proofline.json`}
                        >
                          <CheckCircle size={16} weight="fill" aria-hidden="true" />Bundle verified
                        </a>
                      ) : isProjectAccess ? (
                        <button className="bundle-action" type="button" disabled={bundleState === "running"} onClick={exportBundle}>
                          <DownloadSimple size={16} aria-hidden="true" />
                          {bundleState === "running" ? "Verifying bundle…" : "Export bundle"}
                        </button>
                      ) : null}
                    </div>
                    {bundleState === "error" ? <p className="bundle-error" role="alert">{bundleError}</p> : null}
                  </>
                ) : (
                  <>
                    <h2 id="next-action-title">{waitingCopy.title}</h2>
                    <p>{waitingCopy.description}</p>
                    <span className={`stage-waiting-state is-${activeStage.state}`}>
                      {activeStageLabel} · {sentenceCase(activeStage.state)}
                    </span>
                  </>
                )}
              </div>
            </section>
            )}
            {(hydrationError || hydratedRun.sync?.state === "partial") && hydratedRun.recovery?.state !== "retryable" ? (
              <button className="recovery-action recovery-refresh" type="button" onClick={refreshStatus}>
                <ArrowClockwise size={19} aria-hidden="true" />Refresh status
              </button>
            ) : null}
          </section>
          {needsPreflightReport ? (
            <PreflightDiagnosticsRail
              state={preflightReportState}
              expanded={diagnosticExpanded}
              onToggle={toggleDiagnostics}
            />
          ) : (
            <DiagnosticsPanel diagnostics={hydratedRun.diagnostics} expanded={diagnosticExpanded} onToggle={toggleDiagnostics} />
          )}
          <EvidenceStrip items={evidence} />
        </main>
      </div>
      {verificationOpen ? (
        <VerificationDialog
          context={{ runId: activeRunId, projectToken: resolvedToken }}
          services={servicePort}
          onClose={closeVerification}
          onVerified={() => setHydrationRevision((value) => value + 1)}
          onProductEvent={emitProductEvent}
          onOpenIntegration={openIntegration}
          resumePersisted={consumerFailed}
          persistedFailure={persistedConsumerFailure(hydratedRun)}
        />
      ) : null}
      {integrationOpen ? (
        <IntegrationPackageDialog
          context={{ runId: activeRunId, projectToken: resolvedToken }}
          services={servicePort}
          onClose={closeIntegration}
        />
      ) : null}
    </div>
  );
}

function ProductEntry({
  authorityToken,
  onRequireWallet,
  services,
  analytics,
  route,
}: ProductRouteProps & { route: "runs" | "new" }) {
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  const resolvedToken = authorityToken;
  const servicePort = useMemo(() => {
    if (services) return services;
    if (import.meta.env.MODE === "test") return createTestSurfaceServices();
    return createLiveSurfaceServices({
      baseUrl: import.meta.env.VITE_PROOFLINE_API_BASE_URL ?? "/api",
      projectToken: resolvedToken,
      storage: browserLocalStorage(),
    });
  }, [resolvedToken, services]);
  const emitProductEvent = useProductEventEmitter(analytics);

  const emitComposerStart = (entryPoint: "runs" | "direct") => {
    emitProductEvent({
      name: "COMPOSER_STARTED",
      metadata: { entryPoint },
    });
  };
  const recordRunsStart = () => {
    startComposerJourneyFromRuns(browserSessionStorage());
    emitComposerStart("runs");
  };
  const recordDirectStart = () => {
    if (startDirectComposerJourney(browserSessionStorage())) {
      emitComposerStart("direct");
    }
  };
  const recordManifestValidation = (outcome: "accepted" | "rejected") => {
    emitProductEvent({
      name: "MANIFEST_VALIDATED",
      metadata: { outcome },
    });
  };

  if (createdRunId) {
    return (
      <RunCockpit
        runId={createdRunId}
        authorityToken={resolvedToken}
        services={servicePort}
        analytics={analytics}
        onRequireWallet={onRequireWallet}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="shell-main entry-shell-main">
        <Topbar
          title={route === "runs" ? "Runs" : "New Web2Json run"}
          attestationType="Web2Json"
          mode={route === "runs" ? "index" : "new"}
        />
        {route === "runs" ? (
          <RunsIndex
            services={servicePort}
            projectToken={resolvedToken}
            onConnect={onRequireWallet}
            onStart={recordRunsStart}
            onResume={(run) => emitProductEvent({
              name: "RUN_RESUMED",
              metadata: { priorStatus: run.status },
            })}
          />
        ) : (
          <ManifestComposer
            onConnect={onRequireWallet}
            onStart={recordDirectStart}
            projectToken={resolvedToken}
            services={servicePort}
            onManifestValidated={recordManifestValidation}
            onRunCreated={setCreatedRunId}
          />
        )}
      </div>
    </div>
  );
}

function ProductApp({
  shareToken,
  ...props
}: AppProps & { shareToken: string }) {
  const wallet = useWalletSession();
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const walletToken = wallet.accessToken() ?? "";
  const authorityToken = shareToken || props.projectToken || walletToken;
  const walletAvailable = !shareToken && !props.projectToken;
  const openWalletDialog = useCallback(() => {
    if (walletAvailable) setWalletDialogOpen(true);
  }, [walletAvailable]);
  const closeWalletDialog = useCallback(() => setWalletDialogOpen(false), []);

  const pathname = globalThis.location?.pathname ?? "/";
  const routedRun = deepRouteRunId();
  const route = props.runId || routedRun ? (
    <RunCockpit
      runId={props.runId}
      authorityToken={authorityToken}
      services={props.services}
      analytics={props.analytics}
      onRequireWallet={openWalletDialog}
    />
  ) : (
    <ProductEntry
      authorityToken={authorityToken}
      services={props.services}
      analytics={props.analytics}
      onRequireWallet={openWalletDialog}
      route={pathname === "/runs/new" ? "new" : "runs"}
    />
  );

  return (
    <>
      {route}
      {walletDialogOpen && walletAvailable ? (
        <WalletSignInDialog
          {...props.walletAccess?.dialog}
          onClose={closeWalletDialog}
          onAuthenticated={closeWalletDialog}
        />
      ) : null}
    </>
  );
}

export function App(props: AppProps = {}) {
  const [share] = useState(sessionShareAuthority);
  const [walletAccess] = useState(() => props.walletAccess ?? {
    services: createWalletAccessClient({ baseUrl: walletApiBaseUrl() }),
    storage: browserSessionStorage(),
  });
  const suppressWalletRestore = Boolean(
    share.attempted || share.token || props.projectToken,
  );

  useLayoutEffect(() => {
    clearShareBootstrapHandoff(share.handoffRevision);
    return () => clearShareBootstrapHandoff(share.handoffRevision);
  }, [share.handoffRevision]);

  return (
    <WalletSessionProvider
      services={walletAccess.services}
      storage={suppressWalletRestore ? UNAVAILABLE_STORAGE : walletAccess.storage}
    >
      <ProductApp {...props} walletAccess={walletAccess} shareToken={share.token} />
    </WalletSessionProvider>
  );
}
