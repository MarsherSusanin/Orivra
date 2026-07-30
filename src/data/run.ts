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

export const initialRunStages: RunStage[] = [
  { key: "preflight", label: "Preflight", state: "complete", status: "Completed", time: "12:04:11", duration: "3s" },
  { key: "request", label: "Request", state: "complete", status: "Submitted", time: "12:04:14", duration: "12s" },
  { key: "round", label: "Round", state: "complete", status: "Finalized", time: "12:05:56", duration: "1m 42s" },
  { key: "proof", label: "Proof", state: "active", status: "Available", time: "12:06:08", duration: "12s" },
  { key: "verify", label: "Verify", state: "pending", status: "Pending", time: "—", duration: "—" },
  { key: "consumer", label: "Consumer", state: "pending", status: "Pending", time: "—", duration: "—" },
];

export type EvidenceItem = {
  label: string;
  value: string;
  kind?: "copy" | "external";
  rawValue?: string;
  href?: string;
};

export const evidenceItems: ReadonlyArray<EvidenceItem> = [
  {
    label: "Transaction hash",
    value: "0x9f3e...7ab2c1d4",
    rawValue: "0x9f3e0000000000000000000000007ab2c1d4",
    kind: "copy",
  },
  { label: "Voting round", value: "42871" },
  { label: "Fee", value: "0.012345 ETH" },
  { label: "Elapsed time", value: "1m 57s" },
  { label: "Explorer", value: "View on Blockscout", kind: "external" },
];

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
            ? key === "proof"
              ? "Available"
              : "In progress"
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
