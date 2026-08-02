// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { exactTrustManifest, RUN_ID } from "../../../packages/contracts/test/fixtures";
import { generateSafeWeb2JsonConsumer } from "@proofline/domain";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function production(row: Record<string, unknown>) {
  return createProductionProoflineService({
    pool: { query: vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }) } as any,
    tokenDigestKey: "slice019-test-key",
    publicWebOrigin: "https://proofline.test",
  });
}

describe("Slice 019 persisted Consumer Lab report", () => {
  it("returns exact safe bytes and fails closed on checksum mutation", async () => {
    const source = generateSafeWeb2JsonConsumer(exactTrustManifest, { contractName: "ProoflineSafeWeb2JsonConsumer" });
    const sourceBytes = Buffer.from(source);
    const evidence = Buffer.from(JSON.stringify({
      version: "1", consumer: "canonical-vulnerable", passed: false,
      diagnostics: [{
        version: "1", code: "MISSING_CONSUMER_HOST_INVARIANT", severity: "warning",
        confidence: "high", summary: "Missing URL checks",
        evidence: { consumer: "canonical-vulnerable", missingChecks: ["scheme", "host", "path", "query"], requestUrl: exactTrustManifest.request.url },
        remediation: "Use the generated safe consumer.",
      }],
    }));
    const row = {
      manifest: exactTrustManifest, consumer_bytes: evidence, safe_bytes: sourceBytes,
      safe_sha256: createHash("sha256").update(sourceBytes).digest(),
      safe_metadata: { compiler: "solc-0.8.36" },
    };
    const report = await production(row).getConsumerLabReport({ runId: RUN_ID, projectId: PROJECT_ID });
    expect(report).toMatchObject({ statement: "Valid proof ≠ trusted URL", verdict: { state: "needs-fixes", missingChecks: 4 } });
    expect(report.safeConsumer.source).toBe(source);
    expect(report.checks.map((check: { invariant: string }) => check.invariant)).toEqual(["scheme", "host", "path", "query"]);

    await expect(production({ ...row, safe_sha256: Buffer.alloc(32) }).getConsumerLabReport({ runId: RUN_ID, projectId: PROJECT_ID }))
      .rejects.toMatchObject({ status: 500, code: "CONSUMER_LAB_INVALID" });
  });

  it("returns pending without both persisted artifacts", async () => {
    await expect(production({ manifest: exactTrustManifest, consumer_bytes: null, safe_bytes: null, safe_sha256: null }).getConsumerLabReport({ runId: RUN_ID, projectId: PROJECT_ID }))
      .rejects.toMatchObject({ status: 409, code: "CONSUMER_LAB_PENDING" });
  });
});
