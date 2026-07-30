export type RunStageState = "complete" | "active" | "pending" | "failed";

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

export const evidenceItems: ReadonlyArray<{
  label: string;
  value: string;
  kind?: "copy" | "external";
}> = [
  { label: "Transaction hash", value: "0x9f3e...7ab2c1d4", kind: "copy" },
  { label: "Voting round", value: "42871" },
  { label: "Fee", value: "0.012345 ETH" },
  { label: "Elapsed time", value: "1m 57s" },
  { label: "Explorer", value: "View on Blockscout", kind: "external" },
];

export async function simulateConsumerVerification() {
  await new Promise((resolve) => window.setTimeout(resolve, 360));

  return {
    outcome: "failed" as const,
    code: "EXPECTED_HOST_NOT_ENFORCED",
    summary: "Consumer needs one fix",
    checks: [
      { label: "Cryptographic proof", status: "passed" as const },
      { label: "Request identity", status: "passed" as const },
      { label: "Source host invariant", status: "failed" as const },
      { label: "Replay protection", status: "passed" as const },
    ],
  };
}
