import { CaretRight, CheckCircle, ClockCountdown, Warning } from "@phosphor-icons/react";
import type { PreflightReportSurfaceState } from "./PreflightWorkbench";

function safeStateCopy(state: Exclude<PreflightReportSurfaceState["kind"], "valid">) {
  if (state === "loading") return "Reading the persisted preflight report.";
  if (state === "pending") return "Persisted preflight evidence is still preparing.";
  if (state === "unavailable") return "The public preflight report is unavailable for this run.";
  if (state === "invalid") return "The persisted preflight report failed its public contract.";
  return "The persisted preflight report could not be loaded.";
}

export function PreflightDiagnosticsRail({
  state,
  expanded,
  onToggle,
}: {
  state: PreflightReportSurfaceState;
  expanded: boolean;
  onToggle(): void;
}) {
  if (state.kind !== "valid") {
    const waiting = state.kind === "loading" || state.kind === "pending";
    return (
      <aside className="diagnostics preflight-diagnostics" aria-labelledby="preflight-diagnostics-title">
        <p className="section-label" id="preflight-diagnostics-title">Preflight diagnostics</p>
        <section className={`diagnostic-card diagnostic-unavailable is-${state.kind}`} aria-label="Preflight evidence status">
          <div className="diagnostic-heading">
            {waiting
              ? <ClockCountdown className="preflight-rail-icon" size={36} aria-hidden="true" />
              : <Warning className="warning-icon" size={36} aria-hidden="true" />}
            <h2>{waiting ? "Evidence pending" : "Submission blocked"}</h2>
          </div>
          <p className="diagnostic-copy">{safeStateCopy(state.kind)}</p>
        </section>
      </aside>
    );
  }

  const { report } = state;
  const diagnostic = report.diagnostics[0];
  if (!diagnostic) {
    return (
      <aside className="diagnostics preflight-diagnostics" aria-labelledby="preflight-diagnostics-title">
        <p className="section-label" id="preflight-diagnostics-title">Preflight diagnostics</p>
        <section className="diagnostic-card diagnostic-clear" aria-label="No preflight diagnostics">
          <div className="diagnostic-heading">
            <CheckCircle className="preflight-clear-icon" size={36} weight="fill" aria-hidden="true" />
            <h2>Request checks passed</h2>
          </div>
          <p className="diagnostic-copy">No preflight findings were persisted for this request.</p>
        </section>
      </aside>
    );
  }

  return (
    <aside className="diagnostics preflight-diagnostics" aria-labelledby="preflight-diagnostics-title">
      <p className="section-label" id="preflight-diagnostics-title">Preflight diagnostics</p>
      <section className="diagnostic-card">
        <div className="diagnostic-heading">
          <Warning className="warning-icon" size={40} aria-hidden="true" />
          <h2>{report.verdict === "blocked" ? "Submission blocked" : "Review before submission"}</h2>
        </div>
        <dl className="diagnostic-summary">
          <div><dt>Verdict</dt><dd><span className="warning-badge">{report.verdict}</span></dd></div>
          <div><dt>Findings</dt><dd className="warning-value">{report.diagnostics.length}</dd></div>
        </dl>
        <p className="diagnostic-copy">{diagnostic.remediation}</p>
        <div
          id="preflight-diagnostic-evidence"
          className="diagnostic-evidence"
          role="region"
          aria-label="Preflight diagnostic evidence"
          hidden={!expanded}
        >
          <code>{diagnostic.code}</code>
          <p>reportFields: {diagnostic.evidence.reportFields.join(", ")}</p>
          {report.diagnostics.length > 1 ? (
            <p>{report.diagnostics.length - 1} additional persisted finding{report.diagnostics.length === 2 ? "" : "s"} shown in the Workbench.</p>
          ) : null}
        </div>
        <button
          className="details-button"
          type="button"
          aria-expanded={expanded}
          aria-controls="preflight-diagnostic-evidence"
          onClick={onToggle}
        >
          {expanded ? "Hide details" : "View details"}
          <CaretRight size={17} weight="bold" aria-hidden="true" />
        </button>
      </section>
    </aside>
  );
}
