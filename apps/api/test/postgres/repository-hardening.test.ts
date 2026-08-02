// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { makeRunEvents } from "../../../../packages/contracts/test/fixtures";
import {
  POSTGRES_QUERIES,
  createPostgresCommandRepository,
  createPostgresRunRepository,
} from "../../src/postgres";

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

function makeClient(
  query: (text: string, values?: readonly unknown[]) => Promise<QueryResult>,
) {
  return {
    query: vi.fn(query),
    release: vi.fn(),
  };
}

describe("PostgreSQL run journal hardening", () => {
  it("treats a byte-identical already persisted event as idempotent", async () => {
    const event = makeRunEvents()[0];
    const client = makeClient(async (text) => {
      if (/SELECT last_sequence/i.test(text)) {
        return result([{ last_sequence: 1 }]);
      }
      if (/SELECT event_payload/i.test(text)) {
        return result([{ event_payload: event }]);
      }
      return result([], 1);
    });
    const repository = createPostgresRunRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
      tokenDigestKey: "digest-key",
    });

    await expect(repository.appendEvent(event)).resolves.toBeUndefined();
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO proofline_private\.run_events/i),
      expect.anything(),
    );
    expect(client.query.mock.calls.map(([text]) => text.trim()).at(-1)).toBe("COMMIT");
  });

  it("loads the ordered journal before appending the next event", async () => {
    const [first, second] = makeRunEvents();
    const client = makeClient(async (text) => {
      if (/SELECT last_sequence/i.test(text)) {
        return result([{ last_sequence: 1 }]);
      }
      if (/SELECT event_payload/i.test(text)) {
        return result([{ event_payload: first }]);
      }
      return result([], 1);
    });
    const repository = createPostgresRunRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
      tokenDigestKey: "digest-key",
    });

    await repository.appendEvent(second);

    const insert = client.query.mock.calls.find(([text]) =>
      /INSERT INTO proofline_private\.run_events/i.test(text),
    );
    expect(insert?.[1]?.slice(0, 4)).toEqual([
      second.runId,
      2,
      second.commandId,
      second.type,
    ]);
    expect(JSON.parse(String(insert?.[1]?.[4]))).toEqual(second);
    expect(insert?.[1]?.[5]).toBe(second.occurredAt);
    expect(
      client.query.mock.calls.some(([text]) =>
        /UPDATE proofline_private\.runs/i.test(text),
      ),
    ).toBe(true);
  });

  it("rolls back when the run vanished before the append lock", async () => {
    const client = makeClient(async (text) =>
      /SELECT last_sequence/i.test(text) ? result([], 0) : result([], 1),
    );
    const repository = createPostgresRunRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
      tokenDigestKey: "digest-key",
    });

    await expect(repository.appendEvent(makeRunEvents()[0])).rejects.toThrow(
      /run not found/i,
    );
    expect(client.query.mock.calls.map(([text]) => text.trim())).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe("PostgreSQL command lease hardening", () => {
  it("claims one command in a short transaction and normalizes malformed payload", async () => {
    const client = makeClient(async (text) => {
      if (/WITH candidate/i.test(text)) {
        return result([
          {
            id: "command_1",
            kind: "POLL_DA_PROOF",
            run_id: "run_1",
            attempts: "3",
            payload: "not-an-object",
          },
        ]);
      }
      return result([], 1);
    });
    const repository = createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    });

    await expect(repository.claimNextCommand()).resolves.toMatchObject({
      claimToken: expect.any(String),
      command: {
        id: "command_1",
        kind: "POLL_DA_PROOF",
        runId: "run_1",
        attempts: 3,
        payload: {},
      },
    });
    expect(client.query.mock.calls.map(([text]) => text.trim())).toEqual([
      "BEGIN",
      expect.stringMatching(/WITH candidate/i),
      POSTGRES_QUERIES.loadEvents.trim(),
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("commits an empty queue claim and returns null", async () => {
    const client = makeClient(async () => result([], 0));
    const repository = createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    });

    await expect(repository.claimNextCommand()).resolves.toBeNull();
    expect(client.query.mock.calls.map(([text]) => text.trim()).at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases if claiming fails", async () => {
    const client = makeClient(async (text) => {
      if (/WITH candidate/i.test(text)) throw new Error("connection reset");
      return result([], 1);
    });
    const repository = createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    });

    await expect(repository.claimNextCommand()).rejects.toThrow(/reset/i);
    expect(client.query.mock.calls.map(([text]) => text.trim()).at(-1)).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("atomically stores canonical artifact bytes before completing the lease", async () => {
    const client = makeClient(async () => result([{ id: "command_1" }], 1));
    const repository = createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    });
    const canonicalBytes = new TextEncoder().encode('{"version":"1"}');
    const sha256 = new Uint8Array(32).fill(7);

    await repository.completeCommand("command_1", "11111111-1111-4111-8111-111111111111", {
      artifacts: [
        {
          id: "artifact_1",
          runId: "run_1",
          kind: "proof-bundle",
          canonicalBytes,
          sha256,
        },
      ],
    });

    const calls = client.query.mock.calls;
    const artifactIndex = calls.findIndex(([text]) =>
      /INSERT INTO proofline_private\.run_artifacts/i.test(text),
    );
    const completionIndex = calls.findIndex(([text]) =>
      /SET status = 'succeeded'/i.test(text),
    );
    expect(artifactIndex).toBeGreaterThan(0);
    expect(completionIndex).toBeGreaterThan(artifactIndex);
    expect(calls[artifactIndex]?.[1]).toEqual([
      "artifact_1",
      "run_1",
      "proof-bundle",
      canonicalBytes,
      sha256,
      "{}",
    ]);
    expect(calls.map(([text]) => text.trim()).at(-1)).toBe("COMMIT");
  });

  it("rolls back artifact writes when the lease completion is stale", async () => {
    const client = makeClient(async (text) => {
      if (/SET status = 'succeeded'/i.test(text)) return result([], 0);
      return result([], 1);
    });
    const repository = createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    });

    await expect(
      repository.completeCommand("command_1", "11111111-1111-4111-8111-111111111111", {
        artifacts: [
          {
            id: "artifact_1",
            runId: "run_1",
            kind: "safe-consumer",
            canonicalBytes: new Uint8Array([1]),
            sha256: new Uint8Array(32),
            metadata: { compiler: "solc" },
          },
        ],
      }),
    ).rejects.toThrow(/stale/i);

    expect(
      client.query.mock.calls.some(([text]) =>
        /INSERT INTO proofline_private\.run_artifacts/i.test(text),
      ),
    ).toBe(true);
    expect(client.query.mock.calls.map(([text]) => text.trim()).at(-1)).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("appends ordered completion events and commits the projection with the lease", async () => {
    const [first, second] = makeRunEvents();
    const persisted: unknown[] = [];
    let lastSequence = 0;
    const client = makeClient(async (text, values) => {
      if (/SELECT last_sequence/i.test(text)) {
        return result([{ last_sequence: lastSequence }]);
      }
      if (/SELECT event_payload/i.test(text)) {
        return result(persisted.map((event_payload) => ({ event_payload })));
      }
      if (/INSERT INTO proofline_private\.run_events/i.test(text)) {
        persisted.push(JSON.parse(String(values?.[4])));
        lastSequence += 1;
        return result([], 1);
      }
      if (/SET status = 'succeeded'/i.test(text)) {
        return result([{ id: "command_1" }], 1);
      }
      return result([], 1);
    });
    const repository = createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    });

    await repository.completeCommand("command_1", "11111111-1111-4111-8111-111111111111", {
      events: [first, second],
    });

    expect(persisted).toEqual([first, second]);
    expect(lastSequence).toBe(2);
    expect(client.query.mock.calls.map(([text]) => text.trim()).at(-1)).toBe("COMMIT");
  });

  it.each([true, false])(
    "records retryable=%s failures and releases the connection",
    async (retryable) => {
      const client = makeClient(async () => result([{ id: "command_1" }], 1));
      const repository = createPostgresCommandRepository({
        pool: { connect: vi.fn().mockResolvedValue(client) },
      });

      await repository.retryCommand(
        "command_1",
        "11111111-1111-4111-8111-111111111111",
        { category: "transport", retryable },
      );

      expect(client.query).toHaveBeenCalledWith(
        expect.stringMatching(/SET status = CASE/i),
        [
          "command_1",
          "11111111-1111-4111-8111-111111111111",
          retryable,
          JSON.stringify({ category: "transport", retryable }),
        ],
      );
      expect(client.release).toHaveBeenCalledOnce();
    },
  );

  it("rejects stale retry claims and still releases the connection", async () => {
    const client = makeClient(async () => result([], 0));
    const repository = createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    });

    await expect(
      repository.retryCommand(
        "command_1",
        "11111111-1111-4111-8111-111111111111",
        { retryable: true },
      ),
    ).rejects.toThrow(/stale/i);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
