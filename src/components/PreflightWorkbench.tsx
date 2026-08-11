import {
  ArrowRight,
  CheckCircle,
  ClockCountdown,
  ShieldCheck,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import type { PreflightReportV1 } from "../../packages/contracts/src";

export type PreflightReportSurfaceState =
  | { kind: "loading" }
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "invalid" }
  | { kind: "transport" }
  | { kind: "valid"; report: PreflightReportV1 };

const verdictContent = {
  ready: {
    heading: "Ready to submit",
    eyebrow: "All preflight checks passed",
    description: "The persisted request is deterministic, ABI-compatible, and within its fee cap.",
    icon: CheckCircle,
  },
  attention: {
    heading: "Review before submission",
    eyebrow: "Evidence needs attention",
    description: "The request can continue, but review the bounded findings before signing.",
    icon: Warning,
  },
  blocked: {
    heading: "Submission blocked",
    eyebrow: "Remediation required",
    description: "Orivra found a persisted blocker. Fix the manifest and create a new run.",
    icon: XCircle,
  },
} as const;

const fallbackContent = {
  loading: {
    heading: "Loading preflight evidence",
    description: "Reading the persisted report for this exact request.",
  },
  pending: {
    heading: "Preflight evidence is preparing",
    description: "Persisted evidence is pending. Orivra will read it after the run advances.",
  },
  unavailable: {
    heading: "Preflight report unavailable",
    description: "This run has no persisted public preflight report. Submission remains blocked.",
  },
  invalid: {
    heading: "Preflight report invalid",
    description: "The persisted report failed its public contract. Submission remains blocked.",
  },
  transport: {
    heading: "Preflight report could not be loaded",
    description: "Orivra could not read persisted evidence. Submission remains blocked.",
  },
} as const;

function ShapeEvidence({
  title,
  shape,
}: {
  title: string;
  shape: PreflightReportV1["responseShape"];
}) {
  return (
    <article className="preflight-shape-card">
      <header>
        <h4>{title}</h4>
        <span className={shape.truncated ? "is-attention" : "is-complete"}>
          {shape.truncated ? "Redacted · truncated" : "Redacted · complete"}
        </span>
      </header>
      <dl>
        {shape.nodes.map((node, index) => (
          <div key={`${node.path}-${node.type}-${index}`}>
            <dt><code>{node.path || "/"}</code></dt>
            <dd>{node.type}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function FindingEvidence({
  diagnostic,
}: {
  diagnostic: PreflightReportV1["diagnostics"][number];
}) {
  return (
    <article className={`preflight-finding is-${diagnostic.severity}`}>
      <div className="preflight-finding-heading">
        <code>{diagnostic.code}</code>
        <span>{diagnostic.severity} · {diagnostic.confidence} confidence</span>
      </div>
      <p>{diagnostic.summary}</p>
      <dl>
        <div>
          <dt>reportFields</dt>
          <dd>{diagnostic.evidence.reportFields.join(", ")}</dd>
        </div>
        <div>
          <dt>Remediation</dt>
          <dd>{diagnostic.remediation}</dd>
        </div>
      </dl>
    </article>
  );
}

export function PreflightWorkbench({
  state,
  readOnly,
  onContinue,
}: {
  state: PreflightReportSurfaceState;
  readOnly: boolean;
  onContinue(): void;
}) {
  if (state.kind !== "valid") {
    const content = fallbackContent[state.kind];
    return (
      <section
        className={`next-action preflight-workbench preflight-workbench-state is-${state.kind}`}
        aria-label="Preflight workbench"
        aria-live={state.kind === "loading" || state.kind === "pending" ? "polite" : "assertive"}
      >
        <span className="preflight-state-icon" aria-hidden="true">
          {state.kind === "loading" || state.kind === "pending"
            ? <ClockCountdown size={34} />
            : <Warning size={34} />}
        </span>
        <div
          className="preflight-state-copy"
          role={state.kind === "loading" || state.kind === "pending" ? "status" : "alert"}
          aria-atomic="true"
        >
          <span className="section-label">Preflight workbench</span>
          <h2 id="preflight-workbench-title">{content.heading}</h2>
          <p>{content.description}</p>
        </div>
      </section>
    );
  }

  const { report } = state;
  const content = verdictContent[report.verdict];
  const VerdictIcon = content.icon;
  const canContinue = !readOnly && report.verdict !== "blocked";

  return (
    <section
      className={`next-action preflight-workbench is-${report.verdict}`}
      aria-label="Preflight workbench"
    >
      <header className="preflight-verdict">
        <span className="preflight-verdict-icon" aria-hidden="true">
          <VerdictIcon size={40} weight="duotone" />
        </span>
        <div className="preflight-verdict-copy">
          <span className="section-label">Preflight workbench</span>
          <span className="preflight-verdict-eyebrow">{content.eyebrow}</span>
          <h2 id="preflight-workbench-title">{content.heading}</h2>
          <p>{content.description}</p>
          {readOnly ? (
            <p className="preflight-read-only">
              Read-only share access. Evidence is available; submission controls are disabled.
            </p>
          ) : null}
        </div>
        {canContinue ? (
          <button className="preflight-continue" type="button" onClick={onContinue}>
            Continue to submission
            <ArrowRight size={22} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <section
        className="preflight-evidence-section preflight-identity"
        aria-labelledby="preflight-identity-title"
      >
        <div className="preflight-section-heading">
          <span>01</span>
          <div>
            <h3 id="preflight-identity-title">Request identity and fee</h3>
            <p>Registry-resolved evidence captured for the exact request.</p>
          </div>
        </div>
        <dl className="preflight-evidence-grid">
          <div className="is-wide">
            <dt>Canonical URL</dt>
            <dd><code>{report.canonicalUrl}</code></dd>
          </div>
          <div className="is-wide">
            <dt>Request SHA-256</dt>
            <dd><code>{report.requestIdentitySha256}</code></dd>
          </div>
          <div>
            <dt>Quoted fee</dt>
            <dd><code>{report.fee.quotedWei}</code> wei</dd>
          </div>
          <div>
            <dt>Fee cap</dt>
            <dd><code>{report.fee.capWei}</code> wei</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>Chain 114 · Coston2</dd>
          </div>
          <div>
            <dt>Registry block</dt>
            <dd><code>{report.registrySnapshot.blockNumber}</code></dd>
          </div>
          <div className="is-wide">
            <dt>Registry</dt>
            <dd><code>{report.registrySnapshot.registryAddress}</code></dd>
          </div>
          <div className="is-wide">
            <dt>Resolved FdcHub</dt>
            <dd><code>{report.registrySnapshot.resolvedContracts.FdcHub}</code></dd>
          </div>
        </dl>
      </section>

      <section
        className="preflight-evidence-section preflight-samples"
        aria-labelledby="preflight-samples-title"
      >
        <div className="preflight-section-heading">
          <span>02</span>
          <div>
            <h3 id="preflight-samples-title">Determinism samples</h3>
            <p>
              {report.determinism.passed
                ? `Deterministic across five samples · ${report.determinism.distinctFingerprints} distinct fingerprint.`
                : `Not deterministic · ${report.determinism.distinctFingerprints} distinct fingerprints.`}
            </p>
          </div>
        </div>
        <ol>
          {report.sampleFingerprints.map((fingerprint, index) => (
            <li id={`sample-${index + 1}`} key={`${fingerprint}-${index}`}>
              <span>{index + 1}</span>
              <code>{fingerprint}</code>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="preflight-evidence-section preflight-transform"
        aria-labelledby="preflight-transform-title"
      >
        <div className="preflight-section-heading">
          <span>03</span>
          <div>
            <h3 id="preflight-transform-title">Transform and ABI evidence</h3>
            <p>Only bounded paths and types are retained; source values stay redacted.</p>
          </div>
        </div>
        <div className="preflight-shapes">
          <ShapeEvidence title="Source response shape" shape={report.responseShape} />
          <ShapeEvidence title="Transformed JQ shape" shape={report.jqPreview} />
        </div>
        <div className={`preflight-abi ${report.abiCompatibility.compatible ? "is-complete" : "is-blocked"}`}>
          <ShieldCheck size={25} aria-hidden="true" />
          <div>
            <strong>
              {report.abiCompatibility.compatible ? "ABI compatible" : "ABI incompatible"}
            </strong>
            <span>
              Checked against {report.abiCompatibility.checkedSamples} samples
              {report.abiCompatibility.encodedBytes === undefined
                ? "."
                : ` · ${report.abiCompatibility.encodedBytes} encoded bytes.`}
            </span>
            {report.abiCompatibility.encodedSha256 ? (
              <code>{report.abiCompatibility.encodedSha256}</code>
            ) : null}
          </div>
        </div>
      </section>

      <section
        className="preflight-evidence-section preflight-findings"
        aria-labelledby="preflight-findings-title"
      >
        <div className="preflight-section-heading">
          <span>04</span>
          <div>
            <h3 id="preflight-findings-title">Security findings</h3>
            <p>Stable codes point back to bounded report fields and one remediation.</p>
          </div>
        </div>
        {report.diagnostics.length === 0 ? (
          <div className="preflight-findings-clear">
            <CheckCircle size={23} weight="fill" aria-hidden="true" />
            <span>No security findings in the persisted report.</span>
          </div>
        ) : (
          <div className="preflight-finding-list">
            {report.diagnostics.map((diagnostic) => (
              <FindingEvidence key={diagnostic.code} diagnostic={diagnostic} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
