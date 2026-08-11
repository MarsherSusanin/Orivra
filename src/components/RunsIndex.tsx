import {
  ArrowRight,
  ClockCounterClockwise,
  FileCode,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RunSummaryV1 } from "../../packages/contracts/src";
import type { RunSurfaceServices } from "../services/run-surface";

const STAGES = ["preflight", "request", "round", "proof", "verify", "consumer"] as const;

type RunFilter = "active" | "completed" | "failed";
function routeFilter(): RunFilter | undefined {
  const status = new URLSearchParams(globalThis.location?.search ?? "").get("status");
  return status === "active" || status === "completed" || status === "failed"
    ? status
    : undefined;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function stageState(run: RunSummaryV1, stage: (typeof STAGES)[number]) {
  const current = STAGES.indexOf(run.currentStage);
  const index = STAGES.indexOf(stage);
  if (index < current) return "complete";
  if (index > current) return "pending";
  return run.status === "failed" ? "failed" : run.status === "completed" ? "complete" : "active";
}

function RunCard({
  run,
  onResume,
}: {
  run: RunSummaryV1;
  onResume(run: RunSummaryV1): void;
}) {
  return (
    <li>
      <a
        className="run-card"
        href={`/app/runs/${encodeURIComponent(run.runId)}`}
        onClick={() => {
          if (run.resumable) onResume(run);
        }}
      >
        <div className="run-card-main">
          <span className="run-source-icon" aria-hidden="true"><FileCode size={23} /></span>
          <div>
            <strong>{run.sourceHost}</strong>
            <span>{run.submissionMode} · {formatUpdatedAt(run.updatedAt)}</span>
          </div>
        </div>
        <div
          className="run-progress"
          role="img"
          aria-label={`${run.currentStage} stage, ${run.status}`}
        >
          {STAGES.map((stage) => (
            <span className={`run-progress-segment is-${stageState(run, stage)}`} key={stage} />
          ))}
        </div>
        <div className="run-card-state">
          {run.resumable ? <span className="resume-badge"><ClockCounterClockwise size={15} />Resumable</span> : null}
          <span className={`run-status is-${run.status}`}>{run.status}</span>
          <ArrowRight size={20} aria-hidden="true" />
        </div>
      </a>
    </li>
  );
}

export function RunsIndex({
  services,
  projectToken,
  onConnect,
  onStart,
  onResume,
}: {
  services: RunSurfaceServices;
  projectToken: string;
  onConnect(): void;
  onStart(): void;
  onResume(run: RunSummaryV1): void;
}) {
  const status = routeFilter();
  const [runs, setRuns] = useState<RunSummaryV1[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [state, setState] = useState<"ready" | "loading" | "loading-more" | "error">(
    projectToken && services.listRuns ? "loading" : "ready",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectToken || !services.listRuns) {
      setRuns([]);
      setNextCursor(undefined);
      setState("ready");
      return;
    }
    let cancelled = false;
    setState("loading");
    setError("");
    void services.listRuns({ projectToken, status, limit: 20 }).then(
      (page) => {
        if (cancelled) return;
        setRuns(page.runs);
        setNextCursor(page.nextCursor);
        setState("ready");
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Runs could not be loaded");
        setState("error");
      },
    );
    return () => { cancelled = true; };
  }, [projectToken, services, status]);

  const loadMore = async () => {
    if (!nextCursor || !services.listRuns) return;
    setState("loading-more");
    setError("");
    try {
      const page = await services.listRuns({ projectToken, status, cursor: nextCursor, limit: 20 });
      setRuns((current) => [...current, ...page.runs]);
      setNextCursor(page.nextCursor);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "More runs could not be loaded");
      setState("error");
    }
  };

  return (
    <main className="entry-layout">
      <header className="entry-heading">
        <div>
          <span className="section-label">Project activity</span>
          <h1>Runs</h1>
          <p>Create a Web2Json proof run or continue from persisted evidence.</p>
        </div>
        <a className="entry-primary" href="/app/runs/new" onClick={onStart}>
          <Plus size={20} weight="bold" aria-hidden="true" />Start a Web2Json run
        </a>
      </header>

      <nav className="run-filters" aria-label="Filter runs">
        <a
          className={!status ? "is-active" : ""}
          href="/app/runs"
          aria-current={!status ? "page" : undefined}
        >
          All
        </a>
        {(["active", "completed", "failed"] as const).map((filter) => (
          <a
            className={status === filter ? "is-active" : ""}
            href={`/app/runs?status=${filter}`}
            aria-current={status === filter ? "page" : undefined}
            key={filter}
          >
            {filter[0].toUpperCase() + filter.slice(1)}
          </a>
        ))}
      </nav>

      {state === "loading" ? (
        <section className="entry-state" aria-live="polite">
          <span className="entry-state-spinner" aria-hidden="true" />
          <h2>Loading runs…</h2>
          <p>Reading the latest persisted project state.</p>
        </section>
      ) : null}

      {state === "error" ? (
        <section className="entry-state is-error" role="alert">
          <WarningCircle size={34} aria-hidden="true" />
          <h2>Runs are unavailable</h2>
          <p>{error}</p>
          <button className="entry-secondary" type="button" onClick={onConnect}>Reconnect wallet session</button>
        </section>
      ) : null}

      {state !== "loading" && state !== "error" && runs.length === 0 ? (
        <section className="entry-state">
          <span className="entry-state-icon" aria-hidden="true"><FileCode size={36} /></span>
          <h2>{projectToken ? "No runs yet" : "Sign in to view runs"}</h2>
          <p>
            {projectToken
              ? "Your first run will keep its manifest, lifecycle, proof, and consumer evidence together."
              : "Use your wallet to restore a browser session. You can still inspect the Composer entry first."}
          </p>
          <div className="entry-state-actions">
            {!projectToken ? <button className="entry-secondary" type="button" onClick={onConnect}>Sign in with wallet</button> : null}
            <a className="entry-text-link" href="/templates">Browse templates <ArrowRight size={16} /></a>
          </div>
        </section>
      ) : null}

      {state !== "loading" && runs.length > 0 ? (
        <section className="runs-section" aria-labelledby="recent-runs-title">
          <div className="runs-section-heading">
            <h2 id="recent-runs-title">Recent runs</h2>
            <span>{runs.length} shown</span>
          </div>
          <ul className="run-list">
            {runs.map((run) => <RunCard run={run} onResume={onResume} key={run.runId} />)}
          </ul>
          {nextCursor ? (
            <button className="load-more" type="button" disabled={state === "loading-more"} onClick={() => void loadMore()}>
              {state === "loading-more" ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
