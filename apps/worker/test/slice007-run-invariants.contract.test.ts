// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  expectedCanonicalUrl,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import { appendRunEvents, projectRun } from "@proofline/domain";
import {
  createProductionCommandHandlers,
  createRunWorker,
} from "../src/worker";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
const RELAY = "0x4444444444444444444444444444444444444444";
const REGISTRY = "0x2222222222222222222222222222222222222222";
const REQUEST_CALLDATA = "0xfeedcafe";
const QUOTED_FEE = 12_345n;
const relayerManifest = {
  ...validManifest,
  submission: { ...validManifest.submission, mode: "relayer" as const },
};

function preflightArtifact() {
  return {
    kind: "preflight-evidence",
    canonicalBytes: new TextEncoder().encode(
      JSON.stringify({
        version: "1",
        canonicalUrl: expectedCanonicalUrl,
        requestBytes: "0x574542324a534f4e",
        requestCalldata: REQUEST_CALLDATA,
        quotedFeeWei: QUOTED_FEE.toString(),
        network: {
          chainId: 114,
          blockNumber: "12345678",
          registryAddress: REGISTRY,
          resolvedContracts: {
            FdcHub: FDC_HUB,
            FdcRequestFeeConfigurations:
              "0x6666666666666666666666666666666666666666",
            FdcVerification: FDC_VERIFICATION,
            Relay: RELAY,
          },
        },
      }),
    ),
  };
}

function relayerHarness(initialEvents = makeRunEvents().slice(0, 2)) {
  const state = {
    events: initialEvents.map((event) =>
      event.type === "RUN_CREATED"
        ? { ...event, payload: { manifest: relayerManifest } }
        : event,
    ) as any[],
    transactions: new Map<string, any>(),
  };
  let nonce = 0n;
  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      manifest: relayerManifest,
      events: [...state.events],
      projection: projectRun(state.events as any),
      artifacts: [preflightArtifact()],
    })),
    findRelayerTransaction: vi.fn(async (key: string) =>
      state.transactions.get(key) ?? null,
    ),
    // Slice 007 freezes run identity as the idempotency boundary. The writer may
    // use this port or enforce the same invariant atomically in persistence.
    findRelayerTransactionByRun: vi.fn(async (runId: string) =>
      [...state.transactions.values()].find((value) => value.runId === runId) ?? null,
    ),
    persistRelayerTransaction: vi.fn(async (value: any) => {
      state.transactions.set(value.idempotencyKey, {
        ...value,
        broadcastAttemptedAt: null,
        broadcastAt: null,
      });
    }),
    claimRelayerBroadcastAttempt: vi.fn(async (key: string) => {
      const prior = state.transactions.get(key);
      if (!prior || prior.broadcastAttemptedAt) return false;
      state.transactions.set(key, {
        ...prior,
        broadcastAttemptedAt: OCCURRED_AT,
      });
      return true;
    }),
    markRelayerBroadcast: vi.fn(async (key: string, transactionHash: string) => {
      const prior = state.transactions.get(key);
      state.transactions.set(key, {
        ...prior,
        transactionHash,
        broadcastAt: OCCURRED_AT,
      });
    }),
  };
  const signRelayerTransaction = vi.fn(async (value: any) => {
    nonce += 1n;
    const transactionHash = `0x${nonce.toString(16).padStart(64, "0")}`;
    return {
      projectId: PROJECT_ID,
      runId: RUN_ID,
      idempotencyKey: value.idempotencyKey,
      nonce,
      rawTransaction: `0x${Number(nonce).toString(16).padStart(2, "0")}`,
      transactionHash,
      chainId: 114,
      target: FDC_HUB,
      calldata: REQUEST_CALLDATA,
      valueWei: QUOTED_FEE,
      broadcastAt: null,
    };
  });
  const broadcastRawTransaction = vi.fn(async (raw: string) => {
    const transaction = [...state.transactions.values()].find(
      (value) => value.rawTransaction === raw,
    );
    return transaction.transactionHash;
  });
  const ports = {
    signRelayerTransaction,
    broadcastRawTransaction,
    resolveRecordedTransaction: vi.fn(async () => false),
  } as any;
  const handlers = () =>
    createProductionCommandHandlers({
      repository: repository as any,
      ports,
      clock: { now: () => OCCURRED_AT },
    }) as Record<string, (command: any) => Promise<any>>;

  return { state, repository, ports, handlers };
}

describe("Slice 007 one relayer spend path per run", () => {
  it("rejects a second idempotency key after broadcast and worker restart", async () => {
    const fixture = relayerHarness();
    const firstHandlers = fixture.handlers();
    const firstSubmission = await firstHandlers.SUBMIT_RELAYER({
      id: "command_submit_a",
      runId: RUN_ID,
      payload: { idempotencyKey: "submission-a" },
    });
    const firstBroadcast = await firstHandlers.BROADCAST_RELAYER_TRANSACTION({
      id: "command_broadcast_a",
      runId: RUN_ID,
      payload: firstSubmission.nextCommands[0].payload,
    });
    fixture.state.events = appendRunEvents(
      fixture.state.events as any,
      firstBroadcast.events,
    );

    const restartedHandlers = fixture.handlers();
    await expect(
      restartedHandlers.SUBMIT_RELAYER({
        id: "command_submit_b",
        runId: RUN_ID,
        payload: { idempotencyKey: "submission-b" },
      }),
    ).rejects.toThrow(/already|one relayer|run.*transaction|submitted|terminal/i);

    expect(fixture.ports.signRelayerTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.ports.broadcastRawTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.state.transactions.size).toBe(1);
  });

  it("rejects relayer submission before signing when the journal is terminal", async () => {
    const fixture = relayerHarness(makeRunEvents());

    await expect(
      fixture.handlers().SUBMIT_RELAYER({
        id: "command_submit_terminal",
        runId: RUN_ID,
        payload: { idempotencyKey: "terminal-submission" },
      }),
    ).rejects.toThrow(/terminal|immutable|already complete/i);
    expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.repository.persistRelayerTransaction).not.toHaveBeenCalled();
  });

  it("makes relayer identity unique by run in the PostgreSQL schema", async () => {
    const sql = await readFile(
      new URL("../../api/db/migrations/001_initial.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toMatch(
      /(?:UNIQUE\s*\(\s*run_id\s*\)|CREATE\s+UNIQUE\s+INDEX[\s\S]*relayer_transactions[\s\S]*\(\s*run_id\s*\))/i,
    );
  });
});

describe("Slice 007 terminal worker evidence", () => {
  it("marks an unknown command as a durable terminal failure", async () => {
    const repository = {
      claimNextCommand: vi.fn().mockResolvedValue({
        claimToken: "claim_unknown",
        command: {
          id: "command_unknown",
          kind: "UNKNOWN_COMMAND",
          runId: RUN_ID,
          attempts: 1,
          payload: {},
        },
      }),
      completeCommand: vi.fn(),
      retryCommand: vi.fn(),
    };
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository,
      handlers: {},
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await worker.processOne();
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_unknown",
      "claim_unknown",
      expect.objectContaining({
        category: "configuration",
        retryable: false,
        terminal: true,
      }),
    );
  });
});
