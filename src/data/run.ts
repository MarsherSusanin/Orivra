export type RunStageState = "complete" | "active" | "pending" | "failed";

export type ProjectionStageState = "completed" | "active" | "pending" | "failed";

export type ProjectionStages = {
  preflight: ProjectionStageState;
  request: ProjectionStageState;
  round: ProjectionStageState;
  proof: ProjectionStageState;
  verify: ProjectionStageState;
  consumer: ProjectionStageState;
};

export type RunStage = {
  key: string;
  label: string;
  state: RunStageState;
  status: string;
  time: string;
  duration: string;
};

export type EvidenceItem = {
  label: string;
  value: string;
  kind?: "copy" | "external";
  rawValue?: string;
  href?: string;
};

const stageConfiguration = [
  { key: "preflight", label: "Preflight", complete: "Completed" },
  { key: "request", label: "Request", complete: "Submitted" },
  { key: "round", label: "Round", complete: "Finalized" },
  { key: "proof", label: "Proof", complete: "Available" },
  { key: "verify", label: "Verify", complete: "Verified" },
  { key: "consumer", label: "Consumer", complete: "Completed" },
] as const;

export function timelineFromProjection(
  projection: ProjectionStages,
  details: Partial<Record<keyof ProjectionStages, Pick<RunStage, "time" | "duration">>> = {},
): RunStage[] {
  return stageConfiguration.map(({ key, label, complete }) => {
    const state = projection[key];
    const status =
      state === "completed"
        ? complete
        : state === "failed"
          ? "Failed"
        : state === "active"
            ? "In progress"
            : "Pending";
    return {
      key,
      label,
      state: state === "completed" ? "complete" : state,
      status,
      time: details[key]?.time ?? "—",
      duration: details[key]?.duration ?? "—",
    };
  });
}
