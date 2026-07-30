// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { makeRunEvents } from "../../../../packages/contracts/test/fixtures";
import {
  POSTGRES_QUERIES,
  createPostgresRunRepository,
  digestOpaqueToken,
} from "../../src/postgres";

describe("opaque token persistence", () => {
  it("uses keyed SHA-256/HMAC output and never returns or logs the raw 256-bit token", () => {
    const rawToken = "f".repeat(64);
    const first = digestOpaqueToken(rawToken, "digest-key-A");
    const second = digestOpaqueToken(rawToken, "digest-key-A");
    const differentKey = digestOpaqueToken(rawToken, "digest-key-B");

    expect(first).toEqual(second);
    expect(first).not.toEqual(differentKey);
    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(32);
    expect(JSON.stringify(first)).not.toContain(rawToken);
  });
});

describe("repository SQL concurrency contract", () => {
  it("claims queued work with SKIP LOCKED in a short lease transaction", () => {
    expect(POSTGRES_QUERIES.claimNextCommand).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(POSTGRES_QUERIES.claimNextCommand).toMatch(/status\s*=\s*'queued'/i);
    expect(POSTGRES_QUERIES.claimNextCommand).toMatch(/lease_token/i);
    expect(POSTGRES_QUERIES.claimNextCommand).toMatch(/lease_expires_at/i);
    expect(POSTGRES_QUERIES.claimNextCommand).not.toMatch(/https?:|eth_sendRawTransaction/i);
  });

  it("locks one run and appends event plus projection atomically", async () => {
    const statements: string[] = [];
    const events = makeRunEvents();
    const client = {
      query: vi.fn(async (text: string) => {
        statements.push(text.trim());
        if (/SELECT .* FROM proofline_private\.runs/i.test(text)) {
          return {
            rowCount: 1,
            rows: [{ last_sequence: 0, projection: null }],
          };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    const repository = createPostgresRunRepository({
      pool,
      tokenDigestKey: "test-digest-key",
    });

    await repository.appendEvent(events[0]);

    expect(statements[0]).toMatch(/^BEGIN$/i);
    expect(statements.some((statement) => /FOR UPDATE/i.test(statement))).toBe(true);
    expect(statements.some((statement) => /INSERT INTO proofline_private\.run_events/i.test(statement))).toBe(true);
    expect(statements.some((statement) => /UPDATE proofline_private\.runs/i.test(statement))).toBe(true);
    expect(statements.at(-1)).toMatch(/^COMMIT$/i);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the connection on a write conflict", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        statements.push(text.trim());
        if (/SELECT .* FROM proofline_private\.runs/i.test(text)) {
          throw new Error("sequence conflict");
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    const repository = createPostgresRunRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
      tokenDigestKey: "test-digest-key",
    });

    await expect(repository.appendEvent(makeRunEvents()[0])).rejects.toThrow(/conflict/i);
    expect(statements.at(-1)).toMatch(/^ROLLBACK$/i);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
