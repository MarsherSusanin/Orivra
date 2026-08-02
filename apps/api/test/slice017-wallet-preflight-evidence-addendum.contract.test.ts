// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  validManifest,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111117";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa117";
const FDC_HUB = "0x3333333333333333333333333333333333333333";

const persistedPreflightEvidence = {
  version: "1",
  canonicalUrl: validPreflightReport.canonicalUrl,
  requestBytes: "0x1234abcd",
  requestCalldata: "0xfeedcafe",
  quotedFeeWei: "12345",
  network: {
    chainId: 114,
    blockNumber: validPreflightReport.registrySnapshot.blockNumber,
    registryAddress: validPreflightReport.registrySnapshot.registryAddress,
    resolvedContracts: {
      ...validPreflightReport.registrySnapshot.resolvedContracts,
      FdcHub: FDC_HUB,
    },
  },
};

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function serviceWithEvidence(evidence: unknown) {
  const query = vi.fn(async (text: string) => {
    if (/LEFT JOIN LATERAL/i.test(text)) {
      return result([{
        id: RUN_ID,
        project_id: PROJECT_ID,
        manifest: validManifest,
        projection: { terminal: false, stages: { preflight: "completed" } },
        kind: "preflight-evidence",
        canonical_bytes: Buffer.from(JSON.stringify(evidence)),
      }]);
    }
    return result([], 0);
  });
  return createProductionProoflineService({
    pool: { query } as any,
    tokenDigestKey: "slice-017-wallet-evidence",
    publicWebOrigin: "https://proofline.test",
  });
}

function prepare(evidence: unknown) {
  return serviceWithEvidence(evidence).createSubmission({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    mode: "wallet",
    idempotencyKey: "wallet-exact-evidence",
  });
}

describe("Slice 017 wallet preparation evidence boundary", () => {
  it("derives the unsigned transaction only from exact persisted V1 evidence", async () => {
    await expect(prepare(persistedPreflightEvidence)).resolves.toEqual({
      version: "1",
      runId: RUN_ID,
      mode: "wallet",
      effectOwner: "wallet",
      transaction: {
        chainId: "0x72",
        to: FDC_HUB,
        data: "0xfeedcafe",
        value: "0x3039",
      },
    });
  });

  it.each([
    [
      "legacy top-level defaults",
      {
        chainId: 114,
        fdcHub: FDC_HUB,
        requestCalldata: "0xfeedcafe",
        quotedFeeWei: "12345",
      },
    ],
    [
      "missing persisted chain",
      {
        ...persistedPreflightEvidence,
        network: {
          ...persistedPreflightEvidence.network,
          chainId: undefined,
        },
      },
    ],
    [
      "wrong persisted chain",
      {
        ...persistedPreflightEvidence,
        network: { ...persistedPreflightEvidence.network, chainId: 1 },
      },
    ],
    [
      "legacy top-level hub fallback",
      {
        ...persistedPreflightEvidence,
        fdcHub: FDC_HUB,
        network: {
          ...persistedPreflightEvidence.network,
          resolvedContracts: {
            ...persistedPreflightEvidence.network.resolvedContracts,
            FdcHub: undefined,
          },
        },
      },
    ],
    [
      "unknown legacy field",
      { ...persistedPreflightEvidence, chainId: 114 },
    ],
    [
      "missing exact request calldata",
      { ...persistedPreflightEvidence, requestCalldata: undefined },
    ],
    [
      "invalid quoted fee",
      { ...persistedPreflightEvidence, quotedFeeWei: "-1" },
    ],
  ])("rejects %s as PREFLIGHT_EVIDENCE_INVALID", async (_label, evidence) => {
    await expect(prepare(evidence)).rejects.toMatchObject({
      status: 409,
      code: "PREFLIGHT_EVIDENCE_INVALID",
    });
  });
});
