// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createProductionProoflineService } from "../src/production-service";

const runId = "01900000-0000-4000-8000-000000000009";
const projectId = "11111111-1111-4111-8111-111111111111";
const sha = `sha256:${"a".repeat(64)}`;
const evidence = {
  version: "1", runId, commandId: "verify-deployed", chainId: 114,
  address: "0x1111111111111111111111111111111111111111",
  status: "verified", observedAt: "2026-08-16T00:00:00.000Z",
  blockNumber: "123", registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  codeSizeBytes: 45, observedRuntimeBytecodeSha256: sha,
  expectedRuntimeBytecodeSha256: sha, sourceSha256: sha,
  compilerVersion: "solc-0.8.36", diagnostics: [],
};

function service(row: Record<string, unknown>) {
  return createProductionProoflineService({
    pool: { query: vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }) } as any,
    tokenDigestKey: "issue009",
    publicWebOrigin: "https://orivra.test",
  });
}

describe("Issue #9 persisted deployed consumer evidence", () => {
  it("returns exact checksummed evidence and fails closed on mutation", async () => {
    const bytes = Buffer.from(JSON.stringify(evidence));
    const row = { canonical_bytes: bytes, sha256: createHash("sha256").update(bytes).digest() };
    await expect(service(row).getDeployedConsumerVerification({ runId, projectId })).resolves.toEqual(evidence);
    await expect(service({ ...row, sha256: Buffer.alloc(32) }).getDeployedConsumerVerification({ runId, projectId }))
      .rejects.toMatchObject({ code: "DEPLOYED_CONSUMER_EVIDENCE_INVALID" });
  });

  it("returns pending when no append-only observation exists", async () => {
    await expect(service({ canonical_bytes: null, sha256: null }).getDeployedConsumerVerification({ runId, projectId }))
      .rejects.toMatchObject({ status: 409, code: "DEPLOYED_CONSUMER_VERIFICATION_PENDING" });
  });
});
