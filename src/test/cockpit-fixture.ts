import type { HydratedRunView } from "../services/run-surface";
import type { EvidenceItem, RunStage } from "../data/run";

export const TEST_RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
export const TEST_PROJECT_TOKEN = `project_${"a".repeat(64)}`;

export const TEST_RUN_STAGES: RunStage[] = [
  { key: "preflight", label: "Preflight", state: "complete", status: "Completed", time: "12:04:11", duration: "3s" },
  { key: "request", label: "Request", state: "complete", status: "Submitted", time: "12:04:14", duration: "12s" },
  { key: "round", label: "Round", state: "complete", status: "Finalized", time: "12:05:56", duration: "1m 42s" },
  { key: "proof", label: "Proof", state: "active", status: "Available", time: "12:06:08", duration: "12s" },
  { key: "verify", label: "Verify", state: "pending", status: "Pending", time: "—", duration: "—" },
  { key: "consumer", label: "Consumer", state: "pending", status: "Pending", time: "—", duration: "—" },
];

export const TEST_EVIDENCE_ITEMS: readonly EvidenceItem[] = [
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

export const TEST_HYDRATED_RUN: HydratedRunView = {
  runId: TEST_RUN_ID,
  title: "ETH/USD snapshot",
  attestationType: "Web2Json",
  network: "coston2",
  startedAt: "2025-05-15T12:04:11.000Z",
  sequence: 4,
  terminal: false,
  stages: {
    preflight: "completed",
    request: "completed",
    round: "completed",
    proof: "active",
    verify: "pending",
    consumer: "pending",
  },
  stageDetails: {
    preflight: { time: "12:04:11", duration: "3s" },
    request: { time: "12:04:14", duration: "12s" },
    round: { time: "12:05:56", duration: "1m 42s" },
    proof: { time: "12:06:08", duration: "12s" },
  },
  diagnostics: [{
    code: "CONSUMER_INVARIANT_MISSING",
    severity: "warning",
    confidence: "high",
    summary: "Missing consumer host invariant",
    evidence: {
      detail: "Proof request host is api.example.com; the consumer has no matching assertion.",
    },
    remediation: "The consumer verifies the proof but does not enforce the expected source host.",
  }],
  evidence: {
    transactionHash: "0x9f3e0000000000000000000000007ab2c1d4",
    votingRound: "42871",
    fee: "0.012345 ETH",
    elapsed: "1m 57s",
    explorerUrl: "https://coston2-explorer.flare.network/tx/0x9f3e",
  },
};

export function withHydratedRun<T extends object>(services: T) {
  return {
    ...services,
    hydrateRun: async () => TEST_HYDRATED_RUN,
  };
}
