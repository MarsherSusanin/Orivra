// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  makeRunEvents,
  validManifest,
} from "../../../../packages/contracts/test/fixtures";
import { createPostgresCommandRepository } from "../../src/postgres";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = makeRunEvents()[0].runId;
const IDEMPOTENCY_KEY = "submission-coverage";
const FROM = `0x${"1".repeat(40)}`;
const TARGET = `0x${"2".repeat(40)}`;
const CALLDATA = "0xfeedcafe";
const RAW = "0x02f8";
const HASH = `0x${"3".repeat(64)}`;
const FINGERPRINT = `sha256:${"4".repeat(64)}`;
const CLAIM = "11111111-1111-4111-8111-111111111111";

function bytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}

function sha256Bytes(hex: string): Uint8Array {
  return new Uint8Array(
    createHash("sha256")
      .update(Buffer.from(hex.replace(/^0x/, ""), "hex"))
      .digest(),
  );
}

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function repository(
  query: (text: string, values?: readonly unknown[]) => Promise<ReturnType<typeof result>>,
  relayerPolicy?: {
    globalFeeCapWei: bigint;
    balanceFloorWei: bigint;
    dailyProjectQuota: number;
  },
) {
  const client = { query: vi.fn(query), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  return {
    repository: createPostgresCommandRepository({ pool, relayerPolicy }),
    client,
    pool,
  };
}

function signed(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    runId: RUN_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    chainId: 114,
    fromAddress: FROM,
    nonce: 7n,
    target: TARGET,
    calldata: CALLDATA,
    valueWei: 12_345n,
    rawTransaction: RAW,
    transactionHash: HASH,
    commandFingerprint: FINGERPRINT,
    ...overrides,
  };
}

function persistedRow(overrides: Record<string, unknown> = {}) {
  return {
    run_id: RUN_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    chain_id: 114,
    from_address: bytes(FROM),
    nonce: "7",
    target_address: bytes(TARGET),
    calldata_hash: sha256Bytes(CALLDATA),
    value_wei: "12345",
    raw_signed_transaction: bytes(RAW),
    transaction_hash: bytes(HASH),
    command_fingerprint: bytes(`0x${"4".repeat(64)}`),
    broadcast_at: null,
    ...overrides,
  };
}

describe("PostgreSQL relayer transaction hydration", () => {
  it("returns null or a canonical persisted identity and always releases", async () => {
    let row: Record<string, unknown> | undefined;
    const fixture = repository(async () => (row ? result([row]) : result([], 0)));
    await expect(
      fixture.repository.findRelayerTransaction(IDEMPOTENCY_KEY),
    ).resolves.toBeNull();
    row = persistedRow({ broadcast_at: "2025-05-15T12:04:11.000Z" });
    await expect(
      fixture.repository.findRelayerTransaction(IDEMPOTENCY_KEY),
    ).resolves.toMatchObject({
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      chainId: 114,
      fromAddress: FROM,
      nonce: 7n,
      target: TARGET,
      calldataHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      valueWei: 12_345n,
      rawTransaction: RAW,
      transactionHash: HASH,
      commandFingerprint: FINGERPRINT,
      broadcastAt: "2025-05-15T12:04:11.000Z",
    });
    expect(fixture.client.release).toHaveBeenCalledTimes(2);
  });

  it("releases when persisted byte columns are malformed", async () => {
    const fixture = repository(async () =>
      result([persistedRow({ from_address: "not-bytes" })]),
    );
    await expect(
      fixture.repository.findRelayerTransaction(IDEMPOTENCY_KEY),
    ).rejects.toThrow(/persisted bytes/i);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });
});

describe("PostgreSQL signed transaction persistence", () => {
  it.each([
    ["project", { projectId: undefined }],
    ["run", { runId: undefined }],
    ["sender", { fromAddress: undefined }],
    ["fingerprint", { commandFingerprint: undefined }],
    ["chain", { chainId: 1 }],
    ["value", { valueWei: -1n }],
    ["nonce", { nonce: -1n }],
    ["fingerprint format", { commandFingerprint: "sha256:short" }],
  ])("rejects invalid %s identity before opening a connection", async (_label, override) => {
    const fixture = repository(async () => result([], 1));
    await expect(
      fixture.repository.persistRelayerTransaction(signed(override) as any),
    ).rejects.toThrow(/identity|chain|fingerprint/i);
    expect(fixture.pool.connect).not.toHaveBeenCalled();
  });

  it("inserts the immutable bytes and writes one audit event", async () => {
    const fixture = repository(async (text) =>
      /INSERT INTO proofline_private\.relayer_transactions/i.test(text)
        ? result([{ id: "relayer-1" }], 1)
        : result([], 1),
    );
    await expect(
      fixture.repository.persistRelayerTransaction(signed() as any),
    ).resolves.toBeUndefined();
    expect(
      fixture.client.query.mock.calls.some(([text]) =>
        /RELAYER_TRANSACTION_SIGNED/i.test(text),
      ),
    ).toBe(true);
    expect(fixture.client.query.mock.calls.map(([text]) => text.trim()).at(-1)).toBe(
      "COMMIT",
    );
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it("normalizes a quota race after the project advisory lock", async () => {
    const relayerPolicy = {
      globalFeeCapWei: 20_000n,
      balanceFloorWei: 1_000n,
      dailyProjectQuota: 1,
    };
    const fixture = repository(async (text) => {
      if (/SELECT count\(\*\)::integer AS used/i.test(text)) {
        return result([{ used: 1 }], 1);
      }
      if (/SELECT run_id, chain_id, nonce/i.test(text)) return result([], 0);
      return result([], 1);
    }, relayerPolicy);

    await expect(
      fixture.repository.persistRelayerTransaction(signed({
        policy: {
          projectFeeCapWei: 20_000n,
          globalFeeCapWei: relayerPolicy.globalFeeCapWei,
          quotaRemaining: 1,
          balanceFloorWei: relayerPolicy.balanceFloorWei,
        },
      }) as any),
    ).rejects.toMatchObject({
      version: "1",
      category: "configuration",
      code: "RELAYER_QUOTA_EXHAUSTED",
      retryable: false,
    });
    expect(fixture.client.query).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [PROJECT_ID],
    );
    expect(fixture.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it("accepts a byte-identical conflict without duplicating its audit event", async () => {
    const fixture = repository(async (text) => {
      if (/INSERT INTO proofline_private\.relayer_transactions/i.test(text)) {
        return result([], 0);
      }
      if (/SELECT run_id, chain_id, nonce/i.test(text)) {
        return result([persistedRow()]);
      }
      return result([], 1);
    });
    await expect(
      fixture.repository.persistRelayerTransaction(signed() as any),
    ).resolves.toBeUndefined();
    expect(
      fixture.client.query.mock.calls.some(([text]) =>
        /RELAYER_TRANSACTION_SIGNED/i.test(text),
      ),
    ).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["run", persistedRow({ run_id: "other-run" })],
    ["chain", persistedRow({ chain_id: 1 })],
    ["nonce", persistedRow({ nonce: "8" })],
    ["target", persistedRow({ target_address: bytes(`0x${"9".repeat(40)}`) })],
    ["calldata", persistedRow({ calldata_hash: new Uint8Array(32) })],
    ["fingerprint", persistedRow({ command_fingerprint: new Uint8Array(32) })],
    ["value", persistedRow({ value_wei: "999" })],
    ["raw", persistedRow({ raw_signed_transaction: bytes("0x1234") })],
    ["hash", persistedRow({ transaction_hash: bytes(`0x${"8".repeat(64)}`) })],
  ])("rolls back an idempotency %s mismatch", async (_label, row) => {
    const fixture = repository(async (text) => {
      if (/INSERT INTO proofline_private\.relayer_transactions/i.test(text)) {
        return result([], 0);
      }
      if (/SELECT run_id, chain_id, nonce/i.test(text)) {
        return row ? result([row]) : result([], 0);
      }
      return result([], 1);
    });
    await expect(
      fixture.repository.persistRelayerTransaction(signed() as any),
    ).rejects.toThrow(/identity conflict/i);
    expect(fixture.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it.each([
    ["sender", { fromAddress: "bad" }],
    ["target", { target: "bad" }],
    ["calldata", { calldata: "0x1" }],
    ["raw", { rawTransaction: "0x1" }],
    ["hash", { transactionHash: "0x12" }],
  ])("rolls back malformed hexadecimal %s bytes", async (_label, override) => {
    const fixture = repository(async () => result([], 1));
    await expect(
      fixture.repository.persistRelayerTransaction(signed(override) as any),
    ).rejects.toThrow(/hexadecimal/i);
    expect(fixture.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });
});

describe("PostgreSQL broadcast marker recovery", () => {
  it("marks and audits a first broadcast", async () => {
    const fixture = repository(async (text) =>
      /UPDATE proofline_private\.relayer_transactions/i.test(text)
        ? result([{ id: "relayer-1" }], 1)
        : result([], 1),
    );
    await fixture.repository.markRelayerBroadcast(IDEMPOTENCY_KEY, HASH);
    expect(
      fixture.client.query.mock.calls.some(([text]) =>
        /RELAYER_TRANSACTION_BROADCAST/i.test(text),
      ),
    ).toBe(true);
    expect(fixture.client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("accepts an already marked identical hash without a second audit", async () => {
    const fixture = repository(async (text) => {
      if (/UPDATE proofline_private\.relayer_transactions/i.test(text)) return result([], 0);
      if (/SELECT transaction_hash, broadcast_at/i.test(text)) {
        return result([{ transaction_hash: bytes(HASH), broadcast_at: new Date() }]);
      }
      return result([], 1);
    });
    await expect(
      fixture.repository.markRelayerBroadcast(IDEMPOTENCY_KEY, HASH),
    ).resolves.toBeUndefined();
    expect(
      fixture.client.query.mock.calls.some(([text]) =>
        /RELAYER_TRANSACTION_BROADCAST/i.test(text),
      ),
    ).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["unmarked", { transaction_hash: bytes(HASH), broadcast_at: null }],
    [
      "other hash",
      { transaction_hash: bytes(`0x${"8".repeat(64)}`), broadcast_at: new Date() },
    ],
  ])("rolls back a %s broadcast identity", async (_label, row) => {
    const fixture = repository(async (text) => {
      if (/UPDATE proofline_private\.relayer_transactions/i.test(text)) return result([], 0);
      if (/SELECT transaction_hash, broadcast_at/i.test(text)) {
        return row ? result([row]) : result([], 0);
      }
      return result([], 1);
    });
    await expect(
      fixture.repository.markRelayerBroadcast(IDEMPOTENCY_KEY, HASH),
    ).rejects.toThrow(/identity conflict/i);
    expect(fixture.client.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("PostgreSQL execution context defensive hydration", () => {
  it("hydrates byte artifacts and substitutes safe fallbacks for malformed columns", async () => {
    const events = makeRunEvents().slice(0, 1);
    let fallback = false;
    const fixture = repository(async (text) => {
      if (/FROM proofline_private\.runs/i.test(text)) {
        return result([
          {
            id: RUN_ID,
            project_id: PROJECT_ID,
            manifest: validManifest,
            projection: {},
            last_sequence: 1,
          },
        ]);
      }
      if (/FROM proofline_private\.run_events/i.test(text)) {
        return result(events.map((event_payload) => ({ event_payload })));
      }
      if (/FROM proofline_private\.run_artifacts/i.test(text)) {
        return result([
          {
            id: "artifact-1",
            run_id: RUN_ID,
            kind: "preflight-evidence",
            canonical_bytes: fallback ? "bad" : new Uint8Array([1]),
            sha256: fallback ? null : new Uint8Array(32),
            metadata: fallback ? null : { source: "coverage" },
          },
        ]);
      }
      return result([], 1);
    });
    await expect(fixture.repository.loadRunExecutionContext(RUN_ID)).resolves.toMatchObject({
      artifacts: [
        {
          canonicalBytes: new Uint8Array([1]),
          sha256: new Uint8Array(32),
          metadata: { source: "coverage" },
        },
      ],
    });
    fallback = true;
    await expect(fixture.repository.loadRunExecutionContext(RUN_ID)).resolves.toMatchObject({
      artifacts: [
        {
          canonicalBytes: new Uint8Array(),
          sha256: new Uint8Array(),
          metadata: {},
        },
      ],
    });
  });

  it("rolls back a missing or failed execution-context read", async () => {
    const missing = repository(async (text) =>
      /FROM proofline_private\.runs/i.test(text) ? result([], 0) : result([], 1),
    );
    await expect(
      missing.repository.loadRunExecutionContext(RUN_ID),
    ).rejects.toThrow(/not found/i);
    expect(missing.client.query).toHaveBeenCalledWith("ROLLBACK");

    const failed = repository(async (text) => {
      if (/FROM proofline_private\.runs/i.test(text)) throw new Error("read failed");
      return result([], 1);
    });
    await expect(failed.repository.loadRunExecutionContext(RUN_ID)).rejects.toThrow(
      /read failed/i,
    );
    expect(failed.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(failed.client.release).toHaveBeenCalledOnce();
  });

  it("rejects a stale lease renewal and releases the connection", async () => {
    const fixture = repository(async () => result([], 0));
    await expect(
      fixture.repository.renewLease("command-1", CLAIM),
    ).rejects.toThrow(/stale/i);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });
});
