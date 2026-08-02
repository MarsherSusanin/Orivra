// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function poolWithRun(runId = RUN_ID) {
  return {
    query: vi.fn(async (text: string) => {
      if (/FROM proofline_private\.run_commands/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      if (/FROM proofline_private\.runs/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{
            id: runId,
            project_id: PROJECT_ID,
            manifest: validManifest,
            projection: {
              version: "1",
              runId,
              sequence: 7,
              terminal: true,
              stages: {
                preflight: "completed",
                request: "completed",
                round: "completed",
                proof: "completed",
                verify: "completed",
                consumer: "completed",
              },
            },
            last_sequence: 7,
          }],
        };
      }
      if (/INSERT/i.test(text)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    }),
  };
}

function create(publicWebOrigin: string, runId = RUN_ID) {
  return createProductionProoflineService({
    pool: poolWithRun(runId) as any,
    tokenDigestKey: "slice020-verifier-origin-key",
    publicWebOrigin,
  });
}

describe("Slice 020 corrective public web origin boundary", () => {
  it.each([
    "http://proofline.test",
    "https://proofline.test:444",
    "https://user@proofline.test",
    "https://proofline.test/app",
    "https://proofline.test?tenant=one",
    "https://proofline.test#handoff",
  ])("fails at composition for unsafe public origin %s", (origin) => {
    expect(() => create(origin)).toThrow(/public web origin|https|origin/i);
  });

  it.each([
    "https://proofline.test",
    "https://proofline.test/",
    "https://proofline.test:443/",
  ])("accepts only a root HTTPS origin on the default port: %s", (origin) => {
    expect(() => create(origin)).not.toThrow();
  });

  it("parses its generated result through ShareLinkV1 and fails closed", async () => {
    const production = create("https://proofline.test", "run/invalid");

    await expect(production.createShare({
      projectId: PROJECT_ID,
      runId: "run/invalid",
      idempotencyKey: "share-invalid-run-identity",
    })).rejects.toThrow(/share|run-bound|contract|invalid/i);
  });
});
