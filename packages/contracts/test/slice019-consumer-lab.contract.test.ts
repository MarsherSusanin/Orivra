import { describe, expect, it } from "vitest";
import { ConsumerLabReportV1Schema } from "../src";
import { RUN_ID } from "./fixtures";

export const consumerLabReport = {
  version: "1",
  runId: RUN_ID,
  statement: "Valid proof ≠ trusted URL",
  proofValid: true,
  consumerIdentity: "canonical-vulnerable",
  passed: false,
  checks: (["scheme", "host", "path", "query"] as const).map((invariant) => ({
    invariant, expected: `expected-${invariant}`, observed: `observed-${invariant}`,
    enforced: false, passed: false,
  })),
  diagnostics: [{ version: "1", code: "MISSING_CONSUMER_HOST_INVARIANT", severity: "warning", confidence: "high", summary: "Missing URL checks", evidence: { missingChecks: ["scheme", "host", "path", "query"] }, remediation: "Use the generated safe consumer." }],
  safeConsumer: {
    identity: "canonical-safe", contractName: "ProoflineSafeWeb2JsonConsumer",
    compilerVersion: "solc-0.8.36", compileStatus: "passed",
    sha256: `sha256:${"a".repeat(64)}`, source: "contract ProoflineSafeWeb2JsonConsumer {}\n",
    diff: "--- canonical-vulnerable\n+++ ProoflineSafeWeb2JsonConsumer\n",
  },
  verdict: { state: "needs-fixes", missingChecks: 4 },
} as const;

describe("Slice 019 ConsumerLabReportV1", () => {
  it("accepts exactly four ordered invariant rows and exact artifact evidence", () => {
    expect(ConsumerLabReportV1Schema.parse(consumerLabReport)).toEqual(consumerLabReport);
    expect(ConsumerLabReportV1Schema.safeParse({ ...consumerLabReport, checks: consumerLabReport.checks.slice(1) }).success).toBe(false);
    expect(ConsumerLabReportV1Schema.safeParse({ ...consumerLabReport, checks: [consumerLabReport.checks[1], consumerLabReport.checks[0], consumerLabReport.checks[2], consumerLabReport.checks[3]] }).success).toBe(false);
    expect(ConsumerLabReportV1Schema.safeParse({ ...consumerLabReport, safeConsumer: { ...consumerLabReport.safeConsumer, privateKey: "secret" } }).success).toBe(false);
  });

  it("requires Safe to integrate to have no missing checks and a passed compile", () => {
    expect(ConsumerLabReportV1Schema.safeParse({ ...consumerLabReport, verdict: { state: "safe-to-integrate", missingChecks: 4 } }).success).toBe(false);
    expect(ConsumerLabReportV1Schema.safeParse({ ...consumerLabReport, safeConsumer: { ...consumerLabReport.safeConsumer, compileStatus: "not-run" }, verdict: { state: "safe-to-integrate", missingChecks: 0 } }).success).toBe(false);
    const safeChecks = consumerLabReport.checks.map((check) => ({ ...check, enforced: true, passed: true })) as typeof consumerLabReport.checks;
    expect(ConsumerLabReportV1Schema.safeParse({ ...consumerLabReport, consumerIdentity: "canonical-safe", passed: true, checks: safeChecks, diagnostics: [], verdict: { state: "safe-to-integrate", missingChecks: 0 } }).success).toBe(true);
  });
});
