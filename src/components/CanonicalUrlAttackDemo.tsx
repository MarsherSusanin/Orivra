import {
  CheckCircle,
  DownloadSimple,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalUrlAttackDemoSummaryV1 } from "@proofline/contracts";
import {
  canonicalUrlAttackRecordingDownloadHref,
  createCanonicalUrlAttackDemoClient,
} from "../services/canonical-url-attack-demo-client";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

type DemoState =
  | { status: "loading" }
  | { status: "available"; summary: CanonicalUrlAttackDemoSummaryV1 }
  | { status: "unavailable" };

export type CanonicalUrlAttackDemoRequestRef = {
  current: Promise<CanonicalUrlAttackDemoSummaryV1> | null;
};

function PublicRunEvidence({
  label,
  run,
}: {
  label: string;
  run: CanonicalUrlAttackDemoSummaryV1["runs"]["attack"];
}) {
  return (
    <article className="canonical-demo-run">
      <header>
        <span className="section-label">{label}</span>
        <strong>{run.submissionMode} submission</strong>
      </header>
      <dl>
        <div><dt>Run</dt><dd>{run.runId}</dd></div>
        <div><dt>Requested URL</dt><dd className="canonical-demo-url">{run.requestedUrl}</dd></div>
        <div><dt>Transaction</dt><dd className="canonical-demo-hash">{run.transactionHash}</dd></div>
        <div><dt>Voting round</dt><dd>{run.votingRound}</dd></div>
        <div><dt>Proof SHA-256</dt><dd className="canonical-demo-hash">{run.proofSha256}</dd></div>
      </dl>
    </article>
  );
}

function AvailableDemo({ summary }: { summary: CanonicalUrlAttackDemoSummaryV1 }) {
  const downloadHref = canonicalUrlAttackRecordingDownloadHref(summary);
  return (
    <main className="canonical-demo">
      <header className="canonical-demo-heading">
        <div>
          <span className="section-label">Canonical URL attack</span>
          <h1>{summary.statement}</h1>
          <p>
            One valid Coston2 proof is accepted by a vulnerable consumer and
            rejected by the URL-bound consumer. The evidence below comes from
            an immutable recording selected by its exact byte digest.
          </p>
        </div>
        <a
          className="canonical-demo-download"
          href={downloadHref}
          download
        >
          <DownloadSimple size={20} aria-hidden="true" />
          Download exact recording
        </a>
      </header>

      <section
        className="canonical-demo-panel"
        aria-label="Persisted Coston2 evidence"
      >
        <div className="canonical-demo-section-heading">
          <span className="canonical-demo-section-icon" aria-hidden="true">
            <ShieldCheck size={26} />
          </span>
          <div>
            <span className="section-label">Persisted Coston2 evidence</span>
            <h2>Two live run identities, one transformed response shape</h2>
          </div>
        </div>
        <div className="canonical-demo-evidence">
          <PublicRunEvidence label="Attack run" run={summary.runs.attack} />
          <PublicRunEvidence label="Control run" run={summary.runs.control} />
        </div>
        <dl className="canonical-demo-recording">
          <div><dt>Recording checksum</dt><dd className="canonical-demo-hash">{summary.recording.checksum}</dd></div>
          <div><dt>Exact byte SHA-256</dt><dd className="canonical-demo-hash">{summary.recording.sha256}</dd></div>
          <div><dt>Recorded at</dt><dd>{summary.recording.recordedAt}</dd></div>
          <div><dt>Release tree</dt><dd className="canonical-demo-hash">{summary.recording.release.treeSha}</dd></div>
        </dl>
      </section>

      <section
        className="canonical-demo-panel"
        aria-label="Deterministic local EVM replay"
      >
        <div className="canonical-demo-section-heading">
          <span className="canonical-demo-section-icon is-green" aria-hidden="true">
            <CheckCircle size={26} />
          </span>
          <div>
            <span className="section-label">Deterministic local EVM replay</span>
            <h2>Three checksum-bound consumer calls</h2>
          </div>
        </div>
        <ol className="canonical-demo-outcomes">
          {summary.outcomes.map((outcome) => (
            <li key={`${outcome.scenario}-${outcome.consumer}`}>
              <span className={`canonical-demo-result is-${outcome.result.status}`}>
                {outcome.result.status}
              </span>
              <div>
                <strong>{outcome.scenario} · {outcome.consumer}</strong>
                <span>
                  {outcome.result.status === "reverted"
                    ? `${outcome.result.error} · ${outcome.result.selector}`
                    : "Consumer call returned successfully"}
                </span>
              </div>
              <code className="canonical-demo-hash">{outcome.runtimeBytecodeSha256}</code>
            </li>
          ))}
        </ol>
        <p className="canonical-demo-toolchain">
          {summary.toolchain.compiler.name} {summary.toolchain.compiler.version}
          <span aria-hidden="true"> · </span>
          {summary.toolchain.runtime.name} {summary.toolchain.runtime.version}
          <span aria-hidden="true"> · </span>
          {summary.toolchain.runtime.hardfork}
        </p>
      </section>
    </main>
  );
}

export function CanonicalUrlAttackDemo({
  requestRef,
}: {
  requestRef?: CanonicalUrlAttackDemoRequestRef;
} = {}) {
  const [state, setState] = useState<DemoState>({ status: "loading" });
  const client = useMemo(
    () => createCanonicalUrlAttackDemoClient({ fetch: globalThis.fetch }),
    [],
  );
  const localRequest = useRef<Promise<CanonicalUrlAttackDemoSummaryV1> | null>(null);
  const request = requestRef ?? localRequest;

  useEffect(() => {
    let subscribed = true;
    request.current ??= client.getSummary();
    void request.current.then(
      (summary) => {
        if (subscribed) setState({ status: "available", summary });
      },
      () => {
        if (subscribed) setState({ status: "unavailable" });
      },
    );
    return () => {
      subscribed = false;
    };
  }, [client]);

  return (
    <div className="app-shell">
      <Sidebar active="" />
      <div className="shell-main entry-shell-main">
        <Topbar
          title="Canonical URL attack"
          attestationType="Web2Json"
          mode="new"
        />
        {state.status === "available" ? (
          <AvailableDemo summary={state.summary} />
        ) : state.status === "unavailable" ? (
          <main className="canonical-demo canonical-demo-unavailable">
            <WarningCircle size={38} aria-hidden="true" />
            <h1>Canonical attack recording unavailable</h1>
            <p>
              No verified persisted recording is available for this deployment.
            </p>
          </main>
        ) : (
          <main className="canonical-demo canonical-demo-unavailable" aria-live="polite">
            <span className="entry-state-spinner" aria-hidden="true" />
            <h1>Loading canonical attack recording</h1>
            <p>Reading the bounded public summary from the same-origin API.</p>
          </main>
        )}
      </div>
    </div>
  );
}
