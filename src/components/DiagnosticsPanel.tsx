import { CaretRight, Warning } from "@phosphor-icons/react";

export function DiagnosticsPanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <aside className="diagnostics" aria-labelledby="diagnostics-title">
      <p className="section-label" id="diagnostics-title">Diagnostics</p>
      <section className="diagnostic-card">
        <div className="diagnostic-heading">
          <Warning className="warning-icon" size={44} aria-hidden="true" />
          <h2>Missing consumer host invariant</h2>
        </div>
        <dl className="diagnostic-summary">
          <div><dt>Severity</dt><dd><span className="warning-badge">Warning</span></dd></div>
          <div><dt>Confidence</dt><dd className="warning-value">High</dd></div>
        </dl>
        <p className="diagnostic-copy">The consumer verifies the proof but does not enforce the expected source host.</p>
        {expanded ? (
          <div className="diagnostic-evidence" role="region" aria-label="Diagnostic evidence">
            <code>CONSUMER_INVARIANT_MISSING</code>
            <p>Proof request host is api.example.com; the consumer has no matching assertion.</p>
          </div>
        ) : null}
        <button className="details-button" type="button" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "Hide details" : "View details"}<CaretRight size={17} weight="bold" aria-hidden="true" />
        </button>
      </section>
    </aside>
  );
}
