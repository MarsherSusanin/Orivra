import { ArrowRight, CheckCircle, DownloadSimple, FileMagnifyingGlass } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EvidenceStrip } from "./components/EvidenceStrip";
import { RunTimeline } from "./components/RunTimeline";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { VerificationDialog } from "./components/VerificationDialog";
import { initialRunStages } from "./data/run";
import {
  createLiveSurfaceServices,
  createTestSurfaceServices,
  type RunSurfaceServices,
} from "./services/run-surface";

const COCKPIT_RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";

export type AppProps = {
  runId?: string;
  projectToken?: string;
  services?: RunSurfaceServices;
};

function sessionProjectToken(): string {
  try {
    return globalThis.sessionStorage?.getItem("proofline:project-token") ?? "";
  } catch {
    return "";
  }
}

export function App({ runId, projectToken, services }: AppProps = {}) {
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [bundleState, setBundleState] = useState<"idle" | "running" | "verified" | "error">("idle");
  const [bundleSource, setBundleSource] = useState<string | null>(null);
  const [bundleError, setBundleError] = useState("");
  const verifyTrigger = useRef<HTMLButtonElement>(null);
  const resolvedToken = projectToken ?? sessionProjectToken();
  const servicePort = useMemo(() => {
    if (services) return services;
    if (import.meta.env.MODE === "test") return createTestSurfaceServices();
    return createLiveSurfaceServices({
      baseUrl: import.meta.env.VITE_PROOFLINE_API_BASE_URL ?? "/api",
      projectToken: resolvedToken,
    });
  }, [resolvedToken, services]);
  const [activeRunId] = useState(
    () => runId ?? servicePort.resume?.()?.runId ?? COCKPIT_RUN_ID,
  );

  const closeVerification = () => {
    setVerificationOpen(false);
    verifyTrigger.current?.focus();
  };

  const exportBundle = async () => {
    setBundleState("running");
    setBundleError("");
    setBundleSource(null);
    try {
      const bundle = await servicePort.exportBundle({
        runId: activeRunId,
        projectToken: resolvedToken,
      });
      const replay = await servicePort.replayBundle(bundle);
      if (!replay.byteIdentical) throw new Error("Replay bytes differ from the exported bundle");
      setBundleSource(bundle);
      setBundleState("verified");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Bundle export failed";
      setBundleError(message.replace(/(?:project|share)_[a-f0-9]{64}/gi, "[REDACTED]"));
      setBundleState("error");
    }
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="shell-main">
        <Topbar />
        <main className="run-layout" id="run">
          <section className="run-primary" aria-labelledby="run-title">
            <header className="run-heading">
              <span className="section-label">Run detail</span>
              <h1 id="run-title">ETH/USD snapshot</h1>
              <p>Attestation: <strong>Web2Json</strong><span aria-hidden="true">•</span>Network: <strong>Coston2</strong><span aria-hidden="true">•</span>Started: May 15, 2025 12:04:11 UTC</p>
            </header>
            <RunTimeline stages={initialRunStages} />
            <section className="next-action" aria-labelledby="next-action-title">
              <span className="next-action-icon" aria-hidden="true"><FileMagnifyingGlass size={51} /></span>
              <div className="next-action-content">
                <h2 id="next-action-title">Proof is ready.</h2>
                <p>Verify your consumer contract before consuming the attestation.</p>
                <button ref={verifyTrigger} className="verify-button" type="button" onClick={() => setVerificationOpen(true)}>Verify consumer<ArrowRight size={28} weight="bold" aria-hidden="true" /></button>
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
          <DiagnosticsPanel expanded={diagnosticExpanded} onToggle={() => setDiagnosticExpanded((value) => !value)} />
          <EvidenceStrip />
        </main>
      </div>
      {verificationOpen ? (
        <VerificationDialog
          context={{ runId: activeRunId, projectToken: resolvedToken }}
          services={servicePort}
          onClose={closeVerification}
        />
      ) : null}
    </div>
  );
}
