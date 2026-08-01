// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { makeRunEvents, validManifest } from "../../../packages/contracts/test/fixtures";
import { projectRun } from "@proofline/domain";
import { createProductionProoflineService } from "../src/production-service";

const projectId = "11111111-1111-4111-8111-111111111111";
const ids = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
] as const;

function row(id: string, updatedAt: string, eventCount = 5) {
  const projection = projectRun(makeRunEvents().slice(0, eventCount).map((event) => ({
    ...event,
    runId: id,
  })));
  return {
    id,
    manifest: validManifest,
    projection,
    last_sequence: projection.sequence,
    created_at: new Date("2026-08-02T00:00:00.000Z"),
    updated_at: new Date(updatedAt),
  };
}

function service(query: ReturnType<typeof vi.fn>) {
  return createProductionProoflineService({
    pool: { query } as never,
    tokenDigestKey: "run-list-test-key",
    publicWebOrigin: "https://proofline.test",
  });
}

describe("production run discovery", () => {
  it("returns a stable project-scoped page and an opaque continuation cursor", async () => {
    const firstRows = [
      row(ids[2], "2026-08-02T03:00:00.000Z"),
      row(ids[1], "2026-08-02T02:00:00.000Z"),
      row(ids[0], "2026-08-02T01:00:00.000Z"),
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: firstRows, rowCount: firstRows.length })
      .mockResolvedValueOnce({ rows: [firstRows[2]], rowCount: 1 });
    const production = service(query);

    const first = await production.listRuns({ projectId, limit: 2 });
    expect(first).toMatchObject({
      version: "1",
      runs: [
        { runId: ids[2], sourceHost: "api.example.com", status: "active", currentStage: "verify", resumable: true },
        { runId: ids[1], sourceHost: "api.example.com", status: "active", currentStage: "verify", resumable: true },
      ],
      nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
    });
    expect(query.mock.calls[0][0]).toMatch(/project_id = \$1[\s\S]*updated_at DESC, run\.id DESC/i);
    expect(query.mock.calls[0][1]).toEqual([projectId, 3]);

    const second = await production.listRuns({
      projectId,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.nextCursor).toBeUndefined();
    expect(query.mock.calls[1][1]).toEqual([
      projectId,
      "2026-08-02T02:00:00.000Z",
      ids[1],
      3,
    ]);
  });

  it("maps completed and failed projections and pushes filters into SQL", async () => {
    const failedEvents = [
      { ...makeRunEvents()[0], runId: ids[0] },
      {
        version: "1" as const,
        runId: ids[0],
        sequence: 2,
        commandId: "cmd_failed",
        occurredAt: "2026-08-02T02:00:00.000Z",
        type: "RUN_FAILED" as const,
        payload: {
          stage: "preflight" as const,
          error: {
            version: "1" as const,
            category: "transport" as const,
            code: "VERIFIER_UNAVAILABLE",
            message: "Verifier unavailable",
            retryable: false,
            evidence: {},
          },
        },
      },
    ];
    const failed = {
      ...row(ids[0], "2026-08-02T02:00:00.000Z", 1),
      projection: projectRun(failedEvents),
      last_sequence: 2,
    };
    const completed = row(ids[1], "2026-08-02T03:00:00.000Z", 7);
    const query = vi.fn().mockResolvedValue({ rows: [failed, completed], rowCount: 2 });
    const production = service(query);

    const page = await production.listRuns({ projectId, status: "failed", limit: 20 });
    expect(page.runs.map(({ status, resumable }) => ({ status, resumable }))).toEqual([
      { status: "failed", resumable: false },
      { status: "completed", resumable: false },
    ]);
    expect(query.mock.calls[0][0]).toMatch(/terminalFailure|consumer.*failed/i);
    expect(query.mock.calls[0][1][0]).toBe(projectId);
  });

  it("fails closed before SQL for malformed cursors and invalid filters", async () => {
    const query = vi.fn();
    const production = service(query);
    await expect(
      production.listRuns({ projectId, cursor: "dGhpcy1pcy1ub3QtanNvbg", limit: 20 }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_RUN_LIST_CURSOR" });
    await expect(
      production.listRuns({ projectId, status: "pending", limit: 20 }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_RUN_LIST_QUERY" });
    expect(query).not.toHaveBeenCalled();
  });
});
