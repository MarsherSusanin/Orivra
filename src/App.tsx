import { ArrowRight, FileMagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EvidenceStrip } from "./components/EvidenceStrip";
import { RunTimeline } from "./components/RunTimeline";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { VerificationDialog } from "./components/VerificationDialog";
import { initialRunStages } from "./data/run";

export function App() {
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);

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
                <button className="verify-button" type="button" onClick={() => setVerificationOpen(true)}>Verify consumer<ArrowRight size={28} weight="bold" aria-hidden="true" /></button>
                <span>Next step: Verify consumer invariants and enforcement.</span>
              </div>
            </section>
          </section>
          <DiagnosticsPanel expanded={diagnosticExpanded} onToggle={() => setDiagnosticExpanded((value) => !value)} />
          <EvidenceStrip />
        </main>
      </div>
      {verificationOpen ? <VerificationDialog onClose={() => setVerificationOpen(false)} /> : null}
    </div>
  );
}
