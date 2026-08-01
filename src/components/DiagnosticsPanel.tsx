import { CaretRight, Warning } from "@phosphor-icons/react";
import type { RunDiagnosticView } from "../services/run-surface";

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function evidenceText(value: Record<string, unknown> | undefined): string {
  if (!value) return "No additional evidence was returned.";
  const detail = value.detail;
  if (typeof detail === "string") return detail;
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`)
    .join(" ");
}

export function DiagnosticsPanel({
  expanded,
  onToggle,
  diagnostics,
}: {
  expanded: boolean;
  onToggle: () => void;
  diagnostics?: readonly RunDiagnosticView[];
}) {
  const diagnostic = diagnostics?.[0];
  return (
    <aside className="diagnostics" aria-labelledby="diagnostics-title">
      <p className="section-label" id="diagnostics-title">Diagnostics</p>
      {diagnostics === undefined ? (
        <section className="diagnostic-card diagnostic-unavailable" aria-label="Diagnostics unavailable">
          <div className="diagnostic-heading">
            <h2>Diagnostics unavailable</h2>
          </div>
          <p className="diagnostic-copy">Diagnostics are pending persisted run evidence.</p>
        </section>
      ) : diagnostic ? <section className="diagnostic-card">
        <div className="diagnostic-heading">
          <Warning className="warning-icon" size={44} aria-hidden="true" />
          <h2>{diagnostic.summary}</h2>
        </div>
        <dl className="diagnostic-summary">
          <div><dt>Severity</dt><dd><span className="warning-badge">{sentenceCase(diagnostic.severity)}</span></dd></div>
          <div><dt>Confidence</dt><dd className="warning-value">{sentenceCase(diagnostic.confidence)}</dd></div>
        </dl>
        <p className="diagnostic-copy">{diagnostic.remediation ?? "Review the evidence and enforce the expected consumer invariant."}</p>
        {expanded ? (
          <div className="diagnostic-evidence" role="region" aria-label="Diagnostic evidence">
            <code>{diagnostic.code}</code>
            <p>{evidenceText(diagnostic.evidence)}</p>
          </div>
        ) : null}
        <button className="details-button" type="button" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "Hide details" : "View details"}<CaretRight size={17} weight="bold" aria-hidden="true" />
        </button>
      </section> : (
        <section className="diagnostic-card diagnostic-clear" aria-label="No consumer diagnostics">
          <div className="diagnostic-heading">
            <h2>No invariant findings</h2>
          </div>
          <p className="diagnostic-copy">The consumer verification completed without diagnostics.</p>
        </section>
      )}
    </aside>
  );
}
