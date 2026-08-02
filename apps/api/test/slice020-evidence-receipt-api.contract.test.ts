// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { RUN_ID } from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const FOREIGN_SHARE_TOKEN = `share_${"c".repeat(64)}`;

function request(token: string) {
  return new Request(`https://api.proofline.test/v1/runs/${RUN_ID}/receipt`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function harness(
  getEvidenceReceipt = vi.fn().mockResolvedValue({ version: "1", runId: RUN_ID }),
) {
  const api = createProoflineApi({
    service: { getEvidenceReceipt },
    authenticate: vi.fn(async (token: string) => {
      if (token === PROJECT_TOKEN) {
        return { kind: "project" as const, projectId: "project_1" };
      }
      if (token === SHARE_TOKEN) {
        return { kind: "share" as const, projectId: "project_1", runId: RUN_ID };
      }
      if (token === FOREIGN_SHARE_TOKEN) {
        return { kind: "share" as const, projectId: "project_1", runId: "run_other" };
      }
      return null;
    }),
  });
  return { api, getEvidenceReceipt };
}

describe("Slice 020A Evidence Receipt HTTP boundary", () => {
  it.each([
    ["project", PROJECT_TOKEN],
    ["run-scoped share", SHARE_TOKEN],
  ])("allows a %s reader without an idempotency key", async (_label, token) => {
    const fixture = harness();
    const response = await fixture.api.fetch(request(token));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: "1", runId: RUN_ID });
    expect(fixture.getEvidenceReceipt).toHaveBeenCalledWith({
      projectId: "project_1",
      runId: RUN_ID,
      idempotencyKey: undefined,
    });
  });

  it("rejects a share token scoped to another run before reading evidence", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request(FOREIGN_SHARE_TOKEN));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "SHARE_RUN_SCOPE" },
    });
    expect(fixture.getEvidenceReceipt).not.toHaveBeenCalled();
  });

  it("publishes a stable pending response while the bundle artifact is unavailable", async () => {
    const getEvidenceReceipt = vi.fn().mockRejectedValue(
      Object.assign(new Error("Receipt pending"), {
        status: 409,
        code: "EVIDENCE_RECEIPT_PENDING",
      }),
    );
    const response = await harness(getEvidenceReceipt).api.fetch(request(PROJECT_TOKEN));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "EVIDENCE_RECEIPT_PENDING" },
    });
  });
});
