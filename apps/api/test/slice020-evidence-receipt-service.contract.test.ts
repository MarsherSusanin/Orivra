// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { makeBundleInput, RUN_ID } from "../../../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
} from "../../../packages/domain/src";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function serializedBundle() {
  return canonicalSerializeProofBundle(createProofBundle(makeBundleInput()));
}

function production(row: Record<string, unknown>) {
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }),
  };
  const service = createProductionProoflineService({
    pool: pool as any,
    tokenDigestKey: "slice020-receipt-digest-key",
    publicWebOrigin: "https://proofline.test",
  });
  const getEvidenceReceipt = (service as Record<string, unknown>).getEvidenceReceipt;
  expect(
    getEvidenceReceipt,
    "production service must expose getEvidenceReceipt",
  ).toEqual(expect.any(Function));
  if (typeof getEvidenceReceipt !== "function") {
    throw new Error("getEvidenceReceipt is missing");
  }
  return {
    pool,
    getEvidenceReceipt: getEvidenceReceipt.bind(service) as (
      context: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>,
  };
}

function artifactRow(input: { bytes: string; digest?: Buffer | null }) {
  return {
    canonical_bytes: Buffer.from(input.bytes, "utf8"),
    sha256:
      input.digest === undefined
        ? createHash("sha256").update(input.bytes).digest()
        : input.digest,
  };
}

describe("Slice 020A persisted Evidence Receipt read", () => {
  it("returns a receipt only after verifying the owned artifact column SHA", async () => {
    const bytes = serializedBundle();
    const fixture = production(artifactRow({ bytes }));
    await expect(
      fixture.getEvidenceReceipt({ projectId: PROJECT_ID, runId: RUN_ID }),
    ).resolves.toMatchObject({
      version: "1",
      runId: RUN_ID,
      bundleChecksum: JSON.parse(bytes).checksum,
      replayResult: { byteIdentical: true },
    });
    expect(fixture.pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/run_artifacts[\s\S]*proof-bundle/i),
      [RUN_ID, PROJECT_ID],
    );
  });

  it("returns a stable pending state when the owned bundle does not exist yet", async () => {
    const fixture = production({ canonical_bytes: null, sha256: null });
    await expect(
      fixture.getEvidenceReceipt({ projectId: PROJECT_ID, runId: RUN_ID }),
    ).rejects.toMatchObject({
      status: 409,
      code: "EVIDENCE_RECEIPT_PENDING",
    });
  });

  it("fails closed when canonical bytes disagree with the persisted artifact SHA", async () => {
    const fixture = production(
      artifactRow({ bytes: serializedBundle(), digest: Buffer.alloc(32, 7) }),
    );
    await expect(
      fixture.getEvidenceReceipt({ projectId: PROJECT_ID, runId: RUN_ID }),
    ).rejects.toMatchObject({
      status: 500,
      code: "EVIDENCE_RECEIPT_INVALID",
    });
  });
});
