// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { RUN_ID, validManifest } from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;

function shareRequest() {
  return new Request(`https://api.proofline.test/v1/runs/${RUN_ID}/share`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${PROJECT_TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": `share-${RUN_ID}`,
    },
    body: "{}",
  });
}

function terminalPool() {
  const query = vi.fn(async (text: string) => {
    if (/FROM proofline_private\.run_commands/i.test(text)) {
      return { rowCount: 0, rows: [] };
    }
    if (/FROM proofline_private\.runs/i.test(text)) {
      return {
        rowCount: 1,
        rows: [{
          id: RUN_ID,
          project_id: PROJECT_ID,
          manifest: validManifest,
          projection: {
            version: "1",
            runId: RUN_ID,
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
  });
  return { query };
}

describe("Slice 020B share-link HTTP boundary", () => {
  it("returns a non-cacheable, non-referring link without a raw token field", async () => {
    const createShare = vi.fn().mockResolvedValue({
      version: "1",
      runId: RUN_ID,
      url: `https://proofline.test/runs/${RUN_ID}#share=${SHARE_TOKEN}`,
    });
    const api = createProoflineApi({
      service: { createShare },
      authenticate: vi.fn().mockResolvedValue({
        kind: "project",
        projectId: PROJECT_ID,
      }),
    });

    const response = await api.fetch(shareRequest());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toMatch(/no-store/i);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.json();
    expect(body).toEqual({
      version: "1",
      runId: RUN_ID,
      url: `https://proofline.test/runs/${RUN_ID}#share=${SHARE_TOKEN}`,
    });
    expect(body).not.toHaveProperty("token");
  });

  it("creates a deterministic fragment-only URL from the production service", async () => {
    const production = createProductionProoflineService({
      pool: terminalPool() as any,
      tokenDigestKey: "slice020b-share-digest-key",
      publicWebOrigin: "https://proofline.test///",
    });
    const first = await production.createShare({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      idempotencyKey: `share-${RUN_ID}`,
    });
    const second = await production.createShare({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      idempotencyKey: `share-${RUN_ID}`,
    });

    expect(second).toEqual(first);
    expect(first).toEqual({
      version: "1",
      runId: RUN_ID,
      url: expect.stringMatching(
        new RegExp(`^https://proofline\\.test/runs/${RUN_ID}#share=share_[a-f0-9]{64}$`),
      ),
    });
    expect(new URL(first.url).search).toBe("");
    expect(first).not.toHaveProperty("token");
  });
});
