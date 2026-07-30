// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import { projectRun } from "@proofline/domain";
import {
  createProductionCommandHandlers,
  createRunWorker,
} from "../src/worker";

const projectId = "11111111-1111-4111-8111-111111111111";
const transactionHash = `0x${"9".repeat(64)}`;
const fdcHub = "0x3333333333333333333333333333333333333333";
const fdcVerification = "0x1111111111111111111111111111111111111111";
const relay = "0x4444444444444444444444444444444444444444";
const relayerManifest = {
  ...validManifest,
  submission: { ...validManifest.submission, mode: "relayer" as const },
};

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

const preflightArtifact = {
  kind: "preflight-evidence",
  canonicalBytes: bytes({
    version: "1",
    canonicalUrl: "https://api.example.com/prices/eth",
    requestBytes: "0x574542324a534f4e",
    requestCalldata: "0xfeedcafe",
    quotedFeeWei: "12345",
    network: {
      chainId: 114,
      registryAddress: "0x2222222222222222222222222222222222222222",
      resolvedContracts: {
        FdcHub: fdcHub,
        FdcVerification: fdcVerification,
        Relay: relay,
      },
    },
  }),
};

function context(
  eventCount: number,
  artifacts: Array<Record<string, unknown>> = [preflightArtifact],
  manifest = validManifest as typeof validManifest | typeof relayerManifest,
) {
  const events = makeRunEvents().slice(0, eventCount).map((event) =>
    event.type === "RUN_CREATED"
      ? { ...event, payload: { manifest } }
      : event,
  );
  return {
    runId: RUN_ID,
    projectId,
    manifest,
    events,
    projection: projectRun(events),
    artifacts,
  };
}

function ports(overrides: Record<string, unknown> = {}) {
  return {
    preflight: vi.fn(),
    signRelayerTransaction: vi.fn(),
    broadcastRawTransaction: vi.fn(),
    deriveTransactionHash: vi.fn(),
    observeWalletTransaction: vi.fn(),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash,
      blockHash: `0x${"c".repeat(64)}`,
      blockTimestamp: 1_747_308_251n,
    }),
    getVotingConfiguration: vi.fn().mockResolvedValue({
      firstVotingRoundStartTs: 1_747_265_565n,
      votingEpochDurationSeconds: 90n,
      protocolId: 200,
    }),
    isRelayFinalized: vi.fn(),
    getRelayRoot: vi.fn(),
    fetchDaProof: vi.fn(),
    verifyProof: vi.fn(),
    verifyConsumer: vi.fn(),
    ...overrides,
  } as any;
}

function handlers(input: {
  executionContext: ReturnType<typeof context>;
  portOverrides?: Record<string, unknown>;
  persisted?: Record<string, unknown> | null;
}) {
  const persisted = input.persisted ?? null;
  const repository = {
    loadRunExecutionContext: vi.fn().mockResolvedValue(input.executionContext),
    findRelayerTransaction: vi.fn().mockResolvedValue(persisted),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
  const adapter = ports(input.portOverrides);
  return {
    handlers: createProductionCommandHandlers({
      repository: repository as any,
      ports: adapter,
      clock: { now: () => OCCURRED_AT },
    }),
    repository,
    ports: adapter,
  };
}

describe("Slice 005 Relay-gated lifecycle", () => {
  it("persists receipt evidence but does not finalize the round before Relay", async () => {
    const fixture = handlers({ executionContext: context(3) });
    const outcome = await fixture.handlers.POLL_TRANSACTION_RECEIPT({
      id: "cmd_receipt",
      kind: "POLL_TRANSACTION_RECEIPT",
      runId: RUN_ID,
      attempts: 1,
      payload: { transactionHash },
    });

    expect(outcome.events ?? []).not.toEqual([
      expect.objectContaining({ type: "ROUND_FINALIZED" }),
    ]);
    expect(outcome.events ?? []).toEqual([]);
    expect(outcome.artifacts).toEqual([
      expect.objectContaining({ kind: "receipt-evidence" }),
    ]);
    expect(outcome.nextCommands).toEqual([
      expect.objectContaining({
        kind: "POLL_RELAY_FINALIZATION",
        payload: expect.objectContaining({ votingRound: expect.any(Number) }),
      }),
    ]);
  });

  it("appends ROUND_FINALIZED only after Relay returns true", async () => {
    const receipt = {
      kind: "receipt-evidence",
      canonicalBytes: bytes({
        version: "1",
        transactionHash,
        blockHash: `0x${"c".repeat(64)}`,
        blockTimestamp: "1747308251",
        votingRound: 4752,
        protocolId: 200,
      }),
    };
    const pending = handlers({
      executionContext: context(3, [preflightArtifact, receipt]),
      portOverrides: { isRelayFinalized: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      pending.handlers.POLL_RELAY_FINALIZATION({
        id: "cmd_relay_pending",
        kind: "POLL_RELAY_FINALIZATION",
        runId: RUN_ID,
        attempts: 1,
        payload: { votingRound: 4752, protocolId: 200 },
      }),
    ).rejects.toMatchObject({ category: "not-finalized", retryable: true });

    const finalized = handlers({
      executionContext: context(3, [preflightArtifact, receipt]),
      portOverrides: { isRelayFinalized: vi.fn().mockResolvedValue(true) },
    });
    const outcome = await finalized.handlers.POLL_RELAY_FINALIZATION({
      id: "cmd_relay_final",
      kind: "POLL_RELAY_FINALIZATION",
      runId: RUN_ID,
      attempts: 2,
      payload: { votingRound: 4752, protocolId: 200 },
    });
    expect(outcome.events).toEqual([
      expect.objectContaining({
        type: "ROUND_FINALIZED",
        payload: { votingRound: 4752 },
      }),
    ]);
    expect(outcome.nextCommands).toEqual([
      expect.objectContaining({ kind: "FETCH_DA_PROOF" }),
    ]);
  });
});

describe("Slice 005 bounded worker failure evidence", () => {
  afterEach(() => vi.useRealTimers());

  it("dead-letters exhausted retries with stable terminal evidence", async () => {
    const repository = {
      claimNextCommand: vi.fn().mockResolvedValue({
        claimToken: "claim_1",
        command: {
          id: "command_1",
          kind: "POLL_RELAY_FINALIZATION",
          runId: RUN_ID,
          attempts: 3,
          payload: {},
        },
      }),
      completeCommand: vi.fn(),
      retryCommand: vi.fn(),
      renewLease: vi.fn(),
    };
    const worker = (createRunWorker as any)({
      environment: "test",
      mode: "replay",
      repository,
      maxAttempts: 3,
      handlers: {
        POLL_RELAY_FINALIZATION: vi.fn().mockRejectedValue({
          category: "not-finalized",
          code: "RELAY_FINALIZATION_PENDING",
          message: "Relay is pending",
          retryable: true,
          evidence: { votingRound: 4752 },
        }),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await worker.processOne();
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_1",
      expect.objectContaining({
        category: "not-finalized",
        code: "COMMAND_RETRY_EXHAUSTED",
        retryable: false,
        terminal: true,
        evidence: expect.objectContaining({
          originalCode: "RELAY_FINALIZATION_PENDING",
          votingRound: 4752,
        }),
      }),
    );
  });

  it("renews a lease repeatedly while a bounded handler is still active", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const handler = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const repository = {
      claimNextCommand: vi.fn().mockResolvedValue({
        claimToken: "claim_heartbeat",
        command: {
          id: "command_heartbeat",
          kind: "POLL_TRANSACTION_RECEIPT",
          runId: RUN_ID,
          attempts: 1,
          payload: {},
        },
      }),
      completeCommand: vi.fn(),
      retryCommand: vi.fn(),
      renewLease: vi.fn(),
    };
    const worker = (createRunWorker as any)({
      environment: "test",
      mode: "replay",
      repository,
      leaseHeartbeatMs: 10,
      handlers: { POLL_TRANSACTION_RECEIPT: handler },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const pending = worker.processOne();
    await vi.advanceTimersByTimeAsync(35);
    expect(repository.renewLease.mock.calls.length).toBeGreaterThanOrEqual(3);
    finish();
    await pending;
  });
});

function expectedFingerprint() {
  const canonical = JSON.stringify({
    runId: RUN_ID,
    idempotencyKey: "submission-1",
    chainId: 114,
    target: fdcHub.toLowerCase(),
    calldata: "0xfeedcafe",
    valueWei: "12345",
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

describe("Slice 005 persisted relayer policy and identity", () => {
  const policyArtifact = {
    kind: "relayer-policy",
    canonicalBytes: bytes({
      version: "1",
      projectFeeCapWei: "20000",
      globalFeeCapWei: "30000",
      quotaRemaining: 2,
      balanceFloorWei: "50000",
    }),
  };

  it("passes persisted project/global caps and quota into signing policy", async () => {
    const sign = vi.fn().mockResolvedValue({
      projectId,
      runId: RUN_ID,
      idempotencyKey: "submission-1",
      nonce: 7n,
      rawTransaction: "0x02f8",
      transactionHash,
      commandFingerprint: expectedFingerprint(),
      chainId: 114,
      target: fdcHub,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
      fromAddress: "0x5555555555555555555555555555555555555555",
    });
    const fixture = handlers({
      executionContext: context(
        2,
        [preflightArtifact, policyArtifact],
        relayerManifest,
      ),
      portOverrides: { signRelayerTransaction: sign },
    });
    await fixture.handlers.SUBMIT_RELAYER({
      id: "cmd_submit",
      kind: "SUBMIT_RELAYER",
      runId: RUN_ID,
      attempts: 1,
      payload: { idempotencyKey: "submission-1" },
    });

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: {
          projectFeeCapWei: 20_000n,
          globalFeeCapWei: 30_000n,
          quotaRemaining: 2,
          balanceFloorWei: 50_000n,
        },
      }),
    );
  });

  it("rejects a persisted command fingerprint mismatch", async () => {
    const persisted = {
      runId: RUN_ID,
      idempotencyKey: "submission-1",
      nonce: 7n,
      rawTransaction: "0x02f8",
      transactionHash,
      commandFingerprint: `sha256:${"f".repeat(64)}`,
      chainId: 114,
      target: fdcHub,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
      broadcastAt: null,
    };
    const fixture = handlers({
      executionContext: context(
        2,
        [preflightArtifact, policyArtifact],
        relayerManifest,
      ),
      persisted,
    });
    await expect(
      fixture.handlers.SUBMIT_RELAYER({
        id: "cmd_submit_recovery",
        kind: "SUBMIT_RELAYER",
        runId: RUN_ID,
        attempts: 2,
        payload: { idempotencyKey: "submission-1" },
      }),
    ).rejects.toThrow(/fingerprint|identity/i);
  });

  it("verifies raw signed bytes derive the persisted hash before broadcast", async () => {
    const persisted = {
      runId: RUN_ID,
      idempotencyKey: "submission-1",
      nonce: 7n,
      rawTransaction: "0x02f8",
      transactionHash,
      commandFingerprint: expectedFingerprint(),
      chainId: 114,
      target: fdcHub,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
      broadcastAt: null,
    };
    const broadcast = vi.fn().mockResolvedValue(transactionHash);
    const fixture = handlers({
      executionContext: context(2, [preflightArtifact, policyArtifact]),
      persisted,
      portOverrides: {
        deriveTransactionHash: vi.fn().mockReturnValue(`0x${"8".repeat(64)}`),
        broadcastRawTransaction: broadcast,
      },
    });
    await expect(
      fixture.handlers.BROADCAST_RELAYER_TRANSACTION({
        id: "cmd_broadcast",
        kind: "BROADCAST_RELAYER_TRANSACTION",
        runId: RUN_ID,
        attempts: 1,
        payload: { idempotencyKey: "submission-1" },
      }),
    ).rejects.toThrow(/raw|hash|identity/i);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("grants the worker only the durable broadcast-attempt and acceptance markers", async () => {
    const sql = await readFile(
      new URL("../../api/db/migrations/001_initial.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toMatch(
      /GRANT\s+UPDATE\s*\(\s*broadcast_attempted_at\s*,\s*broadcast_at\s*\)\s+ON\s+proofline_private\.relayer_transactions\s+TO\s+proofline_worker/i,
    );
    expect(sql).not.toMatch(
      /GRANT\s+UPDATE\s+ON[\s\S]*?relayer_transactions[\s\S]*?TO\s+proofline_worker/i,
    );
  });
});
