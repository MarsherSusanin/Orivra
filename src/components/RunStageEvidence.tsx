import { FileText } from "@phosphor-icons/react";
import type { HydratedRunView } from "../services/run-surface";

type RunStageKey = keyof HydratedRunView["stages"];

const COMPLETED_STATUS: Record<RunStageKey, string> = {
  preflight: "Completed",
  request: "Submitted",
  round: "Finalized",
  proof: "Available",
  verify: "Verified",
  consumer: "Completed",
};

const COMPLETED_COPY: Record<RunStageKey, { title: string; description: string }> = {
  preflight: {
    title: "Preflight completed.",
    description: "The exact request passed the persisted preflight boundary.",
  },
  request: {
    title: "Request was submitted.",
    description: "The immutable submission mode and transaction evidence belong to this run.",
  },
  round: {
    title: "Voting round was finalized.",
    description: "The persisted round identifier is bound to this attestation request.",
  },
  proof: {
    title: "Proof is available.",
    description: "The proof stage completed and the persisted evidence is ready for verification.",
  },
  verify: {
    title: "Proof verification passed.",
    description: "The persisted proof verification completed before consumer processing.",
  },
  consumer: {
    title: "Consumer evidence is complete.",
    description: "The consumer result and its diagnostics are persisted for this run.",
  },
};

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function displayStatus(stage: RunStageKey, state: HydratedRunView["stages"][RunStageKey]) {
  if (state === "completed") return COMPLETED_STATUS[stage];
  if (state === "active") return "In progress";
  if (state === "failed") return "Failed";
  return "Pending";
}

function stageCopy(stage: RunStageKey, state: HydratedRunView["stages"][RunStageKey]) {
  if (state === "completed") return COMPLETED_COPY[stage];
  const label = sentenceCase(stage);
  if (state === "active") {
    return {
      title: `${label} is in progress.`,
      description: `Orivra is waiting for the persisted ${stage} transition to complete.`,
    };
  }
  if (state === "failed") {
    return {
      title: `${label} failed.`,
      description: `Review the persisted ${stage} evidence before continuing this run.`,
    };
  }
  return {
    title: `Waiting for ${stage}.`,
    description: `The ${stage} stage has not started yet.`,
  };
}

function stageFacts(stage: RunStageKey, run: HydratedRunView) {
  const state = run.stages[stage];
  const detail = run.stageDetails?.[stage];
  const common = [
    { label: "Status", value: displayStatus(stage, state) },
    { label: "Recorded at", value: detail?.time ?? "—" },
    { label: "Duration", value: detail?.duration ?? "—" },
  ];
  if (stage === "request") {
    return [
      ...common,
      { label: "Submission mode", value: run.submissionMode ? sentenceCase(run.submissionMode) : "—" },
      { label: "Transaction hash", value: run.evidence.transactionHash ?? "—", code: true },
      { label: "Network", value: run.network?.toLowerCase() === "coston2" ? "Coston2" : run.network ?? "—" },
    ];
  }
  if (stage === "round") {
    return [
      ...common,
      { label: "Voting round", value: run.evidence.votingRound ?? "—" },
      { label: "Network", value: run.network?.toLowerCase() === "coston2" ? "Coston2" : run.network ?? "—" },
      { label: "Elapsed run time", value: run.evidence.elapsed ?? "—" },
    ];
  }
  if (stage === "proof") {
    return [
      ...common,
      { label: "Attestation", value: run.attestationType ?? "Web2Json" },
      { label: "Network", value: run.network?.toLowerCase() === "coston2" ? "Coston2" : run.network ?? "—" },
      { label: "Voting round", value: run.evidence.votingRound ?? "—" },
    ];
  }
  if (stage === "verify") {
    return [
      ...common,
      { label: "Verification result", value: displayStatus(stage, state) },
      { label: "Proof evidence", value: run.stages.proof === "completed" ? "Persisted proof available" : "Not available" },
      { label: "Attestation", value: run.attestationType ?? "Web2Json" },
    ];
  }
  return [
    ...common,
    {
      label: "Consumer processing",
      value: state === "active" ? "Persisting consumer evidence" : displayStatus(stage, state),
    },
    {
      label: "Persisted diagnostics",
      value: run.diagnostics?.length ? `${run.diagnostics.length} recorded` : "No diagnostics recorded",
    },
    { label: "Run state", value: run.terminal ? "Terminal" : "Open" },
  ];
}

export function RunStageEvidence({
  run,
  stage,
}: {
  run: HydratedRunView;
  stage: Exclude<RunStageKey, "preflight">;
}) {
  const state = run.stages[stage];
  const copy = stageCopy(stage, state);
  const facts = stageFacts(stage, run);
  const titleId = `stage-evidence-${stage}-title`;
  return (
    <section className={`stage-evidence is-${state}`} aria-labelledby={titleId}>
      <header className="stage-evidence-heading">
        <span className="stage-evidence-icon" aria-hidden="true"><FileText size={35} /></span>
        <div>
          <span className="section-label">Persisted {stage} evidence</span>
          <h2 id={titleId}>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
      </header>
      <dl className="stage-evidence-grid">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{"code" in fact && fact.code ? <code>{fact.value}</code> : fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
