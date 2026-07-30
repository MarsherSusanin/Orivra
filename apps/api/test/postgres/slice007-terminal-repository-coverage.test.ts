// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  makeRunEvents,
} from "../../../../packages/contracts/test/fixtures";
import {
  POSTGRES_QUERIES,
  createPostgresCommandRepository,
} from "../../src/postgres";

const CLAIM = "11111111-1111-4111-8111-111111111111";
const HASH = `0x${"3".repeat(64)}`;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function result(
  rows: Array<Record<string, unknown>> = [],
  rowCount = rows.length,
) {
  return { rows, rowCount };
}

function repositoryWith(
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

function terminalRetryHarness(kind: string, projection: unknown = {
  version: "1",
  runId: RUN_ID,
  sequence: 1,
  terminal: false,
}) {
  const created = makeRunEvents()[0];
  return repositoryWith(async (text) => {
    if (text === POSTGRES_QUERIES.retryCommand) {
      return result([{ run_id: RUN_ID, kind }], 1);
    }
    if (text === POSTGRES_QUERIES.lockRun) {
      return result([
        { last_sequence: 1, projection },
      ], 1);
    }
    if (text === POSTGRES_QUERIES.loadEvents) {
      return result([{ event_payload: created }], 1);
    }
    return result([], 1);
  });
}

describe("Slice 007 terminal journal persistence coverage", () => {
  it.each([
    ["RUN_PREFLIGHT", "preflight"],
    ["SUBMIT_RELAYER", "request"],
    ["BROADCAST_RELAYER_TRANSACTION", "request"],
    ["ATTACH_WALLET_TRANSACTION", "request"],
    ["POLL_TRANSACTION_RECEIPT", "round"],
    ["POLL_RELAY_FINALIZATION", "round"],
    ["FETCH_DA_PROOF", "proof"],
    ["VERIFY_PROOF", "verify"],
    ["VERIFY_CONSUMER", "consumer"],
    ["BUILD_PROOF_BUNDLE", "consumer"],
    ["UNKNOWN_COMMAND", "preflight"],
  ])("maps terminal %s failure to the durable %s stage", async (kind, stage) => {
    const fixture = terminalRetryHarness(kind);
    const failure =
      kind === "UNKNOWN_COMMAND"
        ? {
            terminal: true,
            retryable: false,
            category: "future-category",
            code: "not canonical",
            message: "",
            evidence: "not-an-object",
          }
        : {
            terminal: true,
            retryable: false,
            category: "timeout",
            code: "COMMAND_RETRY_EXHAUSTED",
            message: "Bounded command deadline exhausted",
            evidence: { kind },
          };

    await fixture.repository.retryCommand("command_terminal", CLAIM, failure);

    const insert = fixture.client.query.mock.calls.find(
      ([text]) => String(text) === POSTGRES_QUERIES.insertEvent,
    );
    expect(insert).toBeDefined();
    const persisted = JSON.parse(String(insert?.[1]?.[4]));
    expect(persisted).toMatchObject({
      version: "1",
      runId: RUN_ID,
      sequence: 2,
      commandId: "command_terminal",
      type: "RUN_FAILED",
      payload: {
        stage,
        error:
          kind === "UNKNOWN_COMMAND"
            ? {
                version: "1",
                category: "configuration",
                code: "WORKER_COMMAND_FAILED",
                message: "Worker command failed",
                retryable: false,
                evidence: {},
              }
            : {
                version: "1",
                category: "timeout",
                code: "COMMAND_RETRY_EXHAUSTED",
                message: "Bounded command deadline exhausted",
                retryable: false,
                evidence: { kind },
              },
      },
    });
    const projectionUpdate = fixture.client.query.mock.calls.find(
      ([text]) => String(text) === POSTGRES_QUERIES.updateProjection,
    );
    expect(JSON.parse(String(projectionUpdate?.[1]?.[1]))).toMatchObject({
      terminal: true,
      terminalFailure: { stage },
    });
    expect(
      fixture.client.query.mock.calls.some(([text]) =>
        /SET status = 'cancelled'/i.test(String(text)),
      ),
    ).toBe(true);
    expect(
      fixture.client.query.mock.calls.map(([text]) => String(text).trim()).at(-1),
    ).toBe("COMMIT");
  });

  it("does not append another failure event when projection is already terminal", async () => {
    const fixture = terminalRetryHarness("VERIFY_PROOF", {
      version: "1",
      runId: RUN_ID,
      sequence: 2,
      terminal: true,
    });

    await fixture.repository.retryCommand("command_terminal", CLAIM, {
      terminal: true,
      retryable: false,
      category: "proof-invalid",
      code: "PROOF_REJECTED",
      message: "already persisted",
    });

    expect(
      fixture.client.query.mock.calls.some(
        ([text]) => String(text) === POSTGRES_QUERIES.insertEvent,
      ),
    ).toBe(false);
    expect(
      fixture.client.query.mock.calls.some(([text]) =>
        /SET status = 'cancelled'/i.test(String(text)),
      ),
    ).toBe(true);
  });

  it("rolls back terminal retry when the owning run disappeared", async () => {
    const fixture = repositoryWith(async (text) => {
      if (text === POSTGRES_QUERIES.retryCommand) {
        return result([{ run_id: RUN_ID, kind: "RUN_PREFLIGHT" }], 1);
      }
      if (text === POSTGRES_QUERIES.lockRun) return result([], 0);
      return result([], 1);
    });

    await expect(
      fixture.repository.retryCommand("command_terminal", CLAIM, {
        terminal: true,
        retryable: false,
      }),
    ).rejects.toThrow(/terminal failure run is missing/i);
    expect(fixture.client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("keeps a retryable command nonterminal and does not cancel sibling work", async () => {
    const fixture = repositoryWith(async (text) =>
      text === POSTGRES_QUERIES.retryCommand
        ? result([{ run_id: RUN_ID, kind: "FETCH_DA_PROOF" }], 1)
        : result([], 1),
    );

    await fixture.repository.retryCommand("command_retry", CLAIM, {
      retryable: true,
      terminal: false,
      category: "timeout",
    });
    expect(
      fixture.client.query.mock.calls.some(([text]) =>
        /SET status = 'cancelled'/i.test(String(text)),
      ),
    ).toBe(false);
    expect(fixture.client.query).not.toHaveBeenCalledWith(
      POSTGRES_QUERIES.lockRun,
      expect.anything(),
    );
  });
});

function persistedRow(broadcastAt: Date | null = null) {
  return {
    run_id: RUN_ID,
    idempotency_key: "submission-1",
    chain_id: 114,
    from_address: new Uint8Array(20).fill(1),
    nonce: "7",
    target_address: new Uint8Array(20).fill(2),
    calldata_hash: new Uint8Array(32).fill(3),
    value_wei: "12345",
    raw_signed_transaction: new Uint8Array([2, 248]),
    transaction_hash: new Uint8Array(Buffer.from(HASH.slice(2), "hex")),
    command_fingerprint: new Uint8Array(32).fill(4),
    broadcast_at: broadcastAt,
  };
}

describe("Slice 007 relayer repository reconciliation coverage", () => {
  it("loads or misses the one transaction identity by run and always releases", async () => {
    let row: Record<string, unknown> | undefined = persistedRow(
      new Date("2025-05-15T12:04:11.000Z"),
    );
    const fixture = repositoryWith(async () =>
      row ? result([row], 1) : result([], 0),
    );

    await expect(
      fixture.repository.findRelayerTransactionByRun(RUN_ID),
    ).resolves.toMatchObject({
      runId: RUN_ID,
      idempotencyKey: "submission-1",
      chainId: 114,
      nonce: 7n,
      transactionHash: HASH,
      broadcastAt: "2025-05-15T12:04:11.000Z",
    });
    row = undefined;
    await expect(
      fixture.repository.findRelayerTransactionByRun(RUN_ID),
    ).resolves.toBeNull();
    expect(fixture.client.release).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit valid relayer policy before opening PostgreSQL", async () => {
    const missing = repositoryWith(async () => result());
    await expect(
      missing.repository.loadRelayerPolicy(PROJECT_ID, 12_345n),
    ).rejects.toThrow(/policy configuration is required/i);
    expect(missing.pool.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["manifest cap", -1n, { globalFeeCapWei: 20_000n, balanceFloorWei: 1n, dailyProjectQuota: 5 }],
    ["global cap", 12_345n, { globalFeeCapWei: -1n, balanceFloorWei: 1n, dailyProjectQuota: 5 }],
    ["balance floor", 12_345n, { globalFeeCapWei: 20_000n, balanceFloorWei: -1n, dailyProjectQuota: 5 }],
    ["fractional quota", 12_345n, { globalFeeCapWei: 20_000n, balanceFloorWei: 1n, dailyProjectQuota: 1.5 }],
    ["empty quota", 12_345n, { globalFeeCapWei: 20_000n, balanceFloorWei: 1n, dailyProjectQuota: 0 }],
  ])("rejects invalid %s policy before opening PostgreSQL", async (_label, cap, policy) => {
    const fixture = repositoryWith(async () => result(), policy);
    await expect(
      fixture.repository.loadRelayerPolicy(PROJECT_ID, cap),
    ).rejects.toThrow(/policy configuration is invalid/i);
    expect(fixture.pool.connect).not.toHaveBeenCalled();
  });

  it("returns bounded remaining quota and releases the policy query", async () => {
    const fixture = repositoryWith(
      async () => result([{ used: 2 }], 1),
      {
        globalFeeCapWei: 20_000n,
        balanceFloorWei: 1_000n,
        dailyProjectQuota: 5,
      },
    );
    await expect(
      fixture.repository.loadRelayerPolicy(PROJECT_ID, 12_345n),
    ).resolves.toEqual({
      projectFeeCapWei: 12_345n,
      globalFeeCapWei: 20_000n,
      quotaRemaining: 3,
      balanceFloorWei: 1_000n,
    });
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });
});
