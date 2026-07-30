// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  makeRunEvents,
  validManifest,
} from "../../../../packages/contracts/test/fixtures";
import { createPostgresCommandRepository } from "../../src/postgres";

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

function result(
  rows: Array<Record<string, unknown>> = [],
  rowCount: number | null = rows.length,
): QueryResult {
  return { rows, rowCount };
}

function repositoryHarness(
  override?: (text: string, values?: readonly unknown[]) => QueryResult | undefined,
) {
  const events = makeRunEvents();
  const client = {
    query: vi.fn(async (text: string, values?: readonly unknown[]) => {
      const overridden = override?.(text, values);
      if (overridden) return overridden;
      if (/SELECT[\s\S]+FROM proofline_private\.runs/i.test(text)) {
        return result([
          {
            id: events[0].runId,
            project_id: "11111111-1111-4111-8111-111111111111",
            manifest: validManifest,
            projection: {
              version: "1",
              runId: events[0].runId,
              sequence: 1,
              terminal: false,
              stages: {
                preflight: "active",
                request: "pending",
                round: "pending",
                proof: "pending",
                verify: "pending",
                consumer: "pending",
              },
            },
            last_sequence: 1,
          },
        ]);
      }
      if (/SELECT[\s\S]+FROM proofline_private\.run_events/i.test(text)) {
        return result([{ event_payload: events[0] }]);
      }
      if (/SELECT[\s\S]+FROM proofline_private\.run_artifacts/i.test(text)) {
        return result([
          {
            id: "artifact_preflight",
            run_id: events[0].runId,
            kind: "preflight-evidence",
            canonical_bytes: new TextEncoder().encode('{"version":"1"}'),
            sha256: new Uint8Array(32).fill(1),
            metadata: {},
          },
        ]);
      }
      if (/SET status = 'succeeded'/i.test(text)) {
        return result([{ id: "command_current" }], 1);
      }
      return result([], 1);
    }),
    release: vi.fn(),
  };
  const repository = createPostgresCommandRepository({
    pool: { connect: vi.fn().mockResolvedValue(client) },
  }) as any;
  return { repository, client, events };
}

describe("Slice 003 PostgreSQL execution context and leases", () => {
  it("loads manifest, ordered journal, projection, and immutable evidence", async () => {
    const harness = repositoryHarness();
    expect(
      harness.repository.loadRunExecutionContext,
      "Handlers need one persisted context instead of command payload guesses",
    ).toEqual(expect.any(Function));

    await expect(
      harness.repository.loadRunExecutionContext(harness.events[0].runId),
    ).resolves.toMatchObject({
      runId: harness.events[0].runId,
      projectId: "11111111-1111-4111-8111-111111111111",
      manifest: validManifest,
      events: [harness.events[0]],
      artifacts: [expect.objectContaining({ kind: "preflight-evidence" })],
    });
  });

  it("renews only the active claim before bounded external I/O", async () => {
    const harness = repositoryHarness();
    expect(harness.repository.renewLease).toEqual(expect.any(Function));
    await harness.repository.renewLease(
      "command_current",
      "11111111-1111-4111-8111-111111111111",
      "30 seconds",
    );

    const renewal = harness.client.query.mock.calls.find(([text]) =>
      /UPDATE proofline_private\.run_commands/i.test(String(text)) &&
      /lease_expires_at/i.test(String(text)) &&
      !/SET status =/i.test(String(text)),
    );
    expect(renewal?.[0]).toMatch(/lease_token\s*=\s*\$2::uuid/i);
    expect(renewal?.[0]).toMatch(/status\s*=\s*'leased'/i);
    expect(renewal?.[0]).toMatch(/lease_expires_at\s*>\s*now\(\)/i);
  });
});

describe("Slice 003 atomic production command outcome", () => {
  it("schedules deduplicated child commands before completing and committing the lease", async () => {
    const harness = repositoryHarness();
    await harness.repository.completeCommand(
      "command_current",
      "11111111-1111-4111-8111-111111111111",
      {
        events: [],
        artifacts: [],
        nextCommands: [
          {
            id: "command_child",
            projectId: "11111111-1111-4111-8111-111111111111",
            runId: harness.events[0].runId,
            idempotencyKey: "run:poll-receipt",
            kind: "POLL_TRANSACTION_RECEIPT",
            payload: { transactionHash: `0x${"9".repeat(64)}` },
          },
        ],
      },
    );

    const calls = harness.client.query.mock.calls;
    const childIndex = calls.findIndex(([text]) =>
      /INSERT INTO proofline_private\.run_commands/i.test(String(text)),
    );
    const completionIndex = calls.findIndex(([text]) =>
      /SET status = 'succeeded'/i.test(String(text)),
    );
    const commitIndex = calls.findIndex(([text]) => /^COMMIT$/i.test(String(text)));
    expect(childIndex).toBeGreaterThan(0);
    expect(completionIndex).toBeGreaterThan(childIndex);
    expect(commitIndex).toBeGreaterThan(completionIndex);
    expect(calls[childIndex]?.[0]).toMatch(
      /ON CONFLICT[\s\S]+DO NOTHING|WHERE NOT EXISTS/i,
    );
    expect(calls[childIndex]?.[1]).toEqual([
      "command_child",
      "11111111-1111-4111-8111-111111111111",
      harness.events[0].runId,
      "run:poll-receipt",
      "POLL_TRANSACTION_RECEIPT",
      JSON.stringify({ transactionHash: `0x${"9".repeat(64)}` }),
    ]);
  });

  it("rolls back child scheduling when lease completion is stale", async () => {
    const harness = repositoryHarness((text) =>
      /SET status = 'succeeded'/i.test(text) ? result([], 0) : undefined,
    );
    await expect(
      harness.repository.completeCommand(
        "command_stale",
        "11111111-1111-4111-8111-111111111111",
        {
          nextCommands: [
            {
              id: "command_must_rollback",
              projectId: "11111111-1111-4111-8111-111111111111",
              runId: harness.events[0].runId,
              idempotencyKey: "stale:child",
              kind: "FETCH_DA_PROOF",
              payload: {},
            },
          ],
        },
      ),
    ).rejects.toThrow(/stale/i);
    expect(
      harness.client.query.mock.calls.some(([text]) =>
        /INSERT INTO proofline_private\.run_commands/i.test(String(text)),
      ),
    ).toBe(true);
    expect(
      harness.client.query.mock.calls.map(([text]) => String(text).trim()).at(-1),
    ).toBe("ROLLBACK");
  });
});
