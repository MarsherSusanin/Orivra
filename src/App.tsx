import { ArrowRight, CheckCircle, DownloadSimple, FileMagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createLocalProductAnalytics,
  createProductEventEmitter,
  type ProductAnalyticsPort,
} from "./services/product-analytics";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EvidenceStrip } from "./components/EvidenceStrip";
import { ProjectTokenDialog } from "./components/ProjectTokenDialog";
import { RunTimeline } from "./components/RunTimeline";
import { NewRunEntry, RunsIndex } from "./components/RunsIndex";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { VerificationDialog } from "./components/VerificationDialog";
import {
  timelineFromProjection,
  type EvidenceItem,
} from "./data/run";
import {
  createLiveSurfaceServices,
  createTestSurfaceServices,
  type HydratedRunView,
  type RunSurfaceServices,
} from "./services/run-surface";

const PROJECT_TOKEN_KEY = "proofline:project-token";
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
    return globalThis.sessionStorage ?? UNAVAILABLE_STORAGE;
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

function sessionProjectToken(): string {
  try {
    return browserSessionStorage().getItem(PROJECT_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
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
  return message
    .replace(/(?:project|share)_[a-f0-9]{64}/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

function RunCockpit({ runId, projectToken, services, analytics }: AppProps = {}) {
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [bundleState, setBundleState] = useState<"idle" | "running" | "verified" | "error">("idle");
  const [bundleSource, setBundleSource] = useState<string | null>(null);
  const [bundleError, setBundleError] = useState("");
  const [sessionToken, setSessionToken] = useState(
    () => projectToken ?? sessionProjectToken(),
  );
  const [hydratedRun, setHydratedRun] = useState<HydratedRunView | null>(null);
  const [hydrationError, setHydrationError] = useState("");
  const [hydrationRevision, setHydrationRevision] = useState(0);
  const verifyTrigger = useRef<HTMLButtonElement>(null);
  const recordedProofRuns = useRef(new Set<string>());
  const [routeRunId] = useState(deepRouteRunId);
  const resolvedToken = projectToken ?? sessionToken;
  const emitProductEvent = useProductEventEmitter(analytics);
  const servicePort = useMemo(() => {
    if (services) return services;
    if (import.meta.env.MODE === "test") return createTestSurfaceServices();
    return createLiveSurfaceServices({
      baseUrl: import.meta.env.VITE_PROOFLINE_API_BASE_URL ?? "/api",
      projectToken: resolvedToken,
      storage: browserLocalStorage(),
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

  useEffect(() => {
    if (!shouldHydrate || !servicePort.hydrateRun) return;
    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const load = async (after: number) => {
      try {
        const run = await servicePort.hydrateRun!({
          runId: activeRunId,
          projectToken: resolvedToken,
          after,
        });
        if (cancelled) return;
        if (
          run.stages.proof === "completed" &&
          !recordedProofRuns.current.has(run.runId)
        ) {
          recordedProofRuns.current.add(run.runId);
          emitProductEvent({
            name: "PROOF_AVAILABLE",
            metadata: { source: "live" },
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

    void load(hydrationRevision === 0 ? 0 : (hydratedRun?.sequence ?? 0));
    return () => {
      cancelled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  // `hydratedRun` is intentionally read as the cursor without making each response restart the effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, emitProductEvent, hydrationRevision, resolvedToken, servicePort, shouldHydrate]);

  const connectProject = (token: string) => {
    try {
      browserSessionStorage().setItem(PROJECT_TOKEN_KEY, token);
    } catch {
      // The in-memory token still permits the current session in privacy-restricted browsers.
    }
    setSessionToken(token);
  };

  const closeVerification = () => {
    setVerificationOpen(false);
    verifyTrigger.current?.focus();
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
          <Topbar title="Locked run" attestationType="Web2Json" mode="new" />
          <main className="entry-layout">
            <section className="entry-state">
              <h1>Connect project to open run</h1>
              <p>Proofline needs a session-scoped project token to load this persisted run.</p>
            </section>
          </main>
        </div>
        <ProjectTokenDialog onConnect={connectProject} backHref="/runs" />
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

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="shell-main">
        <Topbar title={title} network={network} attestationType={attestationType} />
        <main className="run-layout" id="run">
          <section className="run-primary" aria-labelledby="run-title">
            <header className="run-heading">
              <span className="section-label">Run detail</span>
              <h1 id="run-title">{title}</h1>
              <p>Attestation: <strong>{attestationType}</strong><span aria-hidden="true">•</span>Network: <strong>{network}</strong><span aria-hidden="true">•</span>Started: {startedAt}</p>
              {hydrationError ? <span className="hydration-error" role="alert">{hydrationError}</span> : null}
            </header>
            <RunTimeline stages={timeline} />
            <section className="next-action" aria-labelledby="next-action-title">
              <span className="next-action-icon" aria-hidden="true"><FileMagnifyingGlass size={51} /></span>
              <div className="next-action-content">
                <h2 id="next-action-title">Proof is ready.</h2>
                <p>Verify your consumer contract before consuming the attestation.</p>
                <button ref={verifyTrigger} className="verify-button" type="button" onClick={() => setVerificationOpen(true)}>{consumerFailed ? "Retry verification" : "Verify consumer"}<ArrowRight size={28} weight="bold" aria-hidden="true" /></button>
                <div className="action-footer">
                  <span>Next step: Verify consumer invariants and enforcement.</span>
                  {bundleState === "verified" && bundleSource ? (
                    <a
                      className="bundle-download"
                      href={`data:application/json;charset=utf-8,${encodeURIComponent(bundleSource)}`}
                      download={`${activeRunId}.proofline.json`}
                    >
                      <CheckCircle size={16} weight="fill" aria-hidden="true" />Bundle verified
                    </a>
                  ) : (
                    <button className="bundle-action" type="button" disabled={bundleState === "running"} onClick={exportBundle}>
                      <DownloadSimple size={16} aria-hidden="true" />
                      {bundleState === "running" ? "Verifying bundle…" : "Export bundle"}
                    </button>
                  )}
                </div>
                {bundleState === "error" ? <p className="bundle-error" role="alert">{bundleError}</p> : null}
              </div>
            </section>
          </section>
          <DiagnosticsPanel diagnostics={hydratedRun?.diagnostics} expanded={diagnosticExpanded} onToggle={() => setDiagnosticExpanded((value) => !value)} />
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
        />
      ) : null}
    </div>
  );
}

function ProductEntry({
  projectToken,
  services,
  analytics,
  route,
}: AppProps & { route: "runs" | "new" }) {
  const [sessionToken, setSessionToken] = useState(
    () => projectToken ?? sessionProjectToken(),
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const resolvedToken = projectToken ?? sessionToken;
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

  const connectProject = (token: string) => {
    try {
      browserSessionStorage().setItem(PROJECT_TOKEN_KEY, token);
    } catch {
      // The current in-memory session remains usable when storage is denied.
    }
    setSessionToken(token);
    setConnectOpen(false);
  };
  const recordStart = () => {
    emitProductEvent({
      name: "COMPOSER_STARTED",
      metadata: { entryPoint: route === "runs" ? "runs" : "direct" },
    });
  };

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
            onConnect={() => setConnectOpen(true)}
            onStart={recordStart}
            onResume={(run) => emitProductEvent({
              name: "RUN_RESUMED",
              metadata: { priorStatus: run.status },
            })}
          />
        ) : (
          <NewRunEntry onConnect={() => setConnectOpen(true)} />
        )}
      </div>
      {connectOpen ? (
        <ProjectTokenDialog
          onConnect={connectProject}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function App(props: AppProps = {}) {
  const pathname = globalThis.location?.pathname ?? "/";
  const routedRun = deepRouteRunId();
  if (props.runId || routedRun) {
    return <RunCockpit {...props} />;
  }
  return <ProductEntry {...props} route={pathname === "/runs/new" ? "new" : "runs"} />;
}
