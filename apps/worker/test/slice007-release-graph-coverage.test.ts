// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  makeBundleInput,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import {
  appendRunEvents,
  canonicalSerializeProofBundle,
  createProofBundle,
  projectRun,
} from "@proofline/domain";
import { createProductionCommandHandlers } from "../src/worker";

const TARGET_RUN_ID = "run_slice007_replay_target";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
const TRANSACTION_HASH = `0x${"9".repeat(64)}`;
const encoder = new TextEncoder();

function artifact(kind: string, value: unknown) {
  return {
    kind,
    canonicalBytes: encoder.encode(JSON.stringify(value)),
  };
}

function replayBundle(input?: {
  terminal?: boolean;
  consumerPassed?: boolean;
}) {
  const source = makeBundleInput();
  const manifest = {
    ...source.manifest,
    submission: { ...source.manifest.submission, mode: "replay" as const },
  };
  const consumerPassed = input?.consumerPassed ?? true;
  const events = source.events
    .map((event) => {
      if (event.type === "RUN_CREATED") {
        return { ...event, payload: { manifest } };
      }
      if (event.type === "CONSUMER_VERIFIED") {
        return {
          ...event,
          payload: {
            passed: consumerPassed,
            diagnostics: consumerPassed ? [] : source.verification.diagnostics,
          },
        };
      }
      return event;
    })
    .slice(0, input?.terminal === false ? 2 : undefined);
  return createProofBundle({
    ...source,
    manifest,
    events,
    verification: {
      ...source.verification,
      consumerVerified: consumerPassed,
    },
  });
}

function targetCreated(manifest: any) {
  return {
    version: "1" as const,
    runId: TARGET_RUN_ID,
    sequence: 1,
    commandId: "create-replay-target",
    occurredAt: OCCURRED_AT,
    type: "RUN_CREATED" as const,
    payload: { manifest },
  };
}

function command(kind: string, payload: Record<string, unknown> = {}) {
  return {
    id: `command_${kind.toLowerCase()}`,
    kind,
    runId: TARGET_RUN_ID,
    attempts: 1,
    payload,
  };
}

function replayHarness(serialized: string, manifest = replayBundle().manifest) {
  const state = {
    events: [targetCreated(manifest)] as any[],
    artifacts: [] as any[],
  };
  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
      runId: TARGET_RUN_ID,
      projectId: PROJECT_ID,
      manifest,
      events: [...state.events],
      projection: projectRun(state.events),
      artifacts: [...state.artifacts],
    })),
    findRelayerTransaction: vi.fn(),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
  const ports = {
    loadReplayBundle: vi.fn(async () => serialized),
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as any,
    ports: ports as any,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (value: any) => Promise<any>>;
  return { state, repository, ports, handlers };
}

describe("Slice 007 replay command graph coverage", () => {
  it("hydrates one terminal replay source, rewrites its journal, and builds a bundle", async () => {
    const source = replayBundle();
    const serialized = canonicalSerializeProofBundle(source);
    const fixture = replayHarness(serialized, source.manifest);

    const preflight = await fixture.handlers.RUN_PREFLIGHT(
      command("RUN_PREFLIGHT"),
    );
    expect(preflight).toMatchObject({
      events: [{ type: "PREFLIGHT_ACCEPTED", sequence: 2 }],
      artifacts: [
        {
          kind: "replay-source",
          metadata: {
            version: "1",
            sourceRunId: source.runId,
            sourceChecksum: source.checksum,
          },
        },
        { kind: "preflight-evidence" },
      ],
      nextCommands: [{ kind: "APPLY_REPLAY_EVIDENCE" }],
    });
    fixture.state.events = appendRunEvents(
      fixture.state.events,
      preflight.events,
    );
    fixture.state.artifacts.push(...preflight.artifacts);

    const applied = await fixture.handlers.APPLY_REPLAY_EVIDENCE(
      command("APPLY_REPLAY_EVIDENCE"),
    );
    const expectedTypes = [
      "REQUEST_SUBMITTED",
      "ROUND_FINALIZED",
      "PROOF_AVAILABLE",
      "PROOF_VERIFIED",
      "CONSUMER_VERIFIED",
    ];
    expect(applied.events.map((event: any) => event.type)).toEqual(
      expectedTypes,
    );
    const expectedCommandIds = expectedTypes.map(
      (type, index) =>
        `command_apply_replay_evidence:replay:${index + 1}:${type.toLowerCase()}`,
    );
    expect(applied.events.map((event: any) => event.commandId)).toEqual(
      expectedCommandIds,
    );
    expect(new Set(expectedCommandIds).size).toBe(expectedCommandIds.length);
    expect(applied.events).toEqual(
      expectedTypes.map((type, index) =>
        expect.objectContaining({
          type,
          runId: TARGET_RUN_ID,
          commandId: expectedCommandIds[index],
          occurredAt: OCCURRED_AT,
        }),
      ),
    );
    const retried = await fixture.handlers.APPLY_REPLAY_EVIDENCE(
      command("APPLY_REPLAY_EVIDENCE"),
    );
    expect(retried.events).toEqual(applied.events);
    expect(applied.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "proof-evidence" }),
        expect.objectContaining({ kind: "verification-evidence" }),
        expect.objectContaining({ kind: "consumer-evidence" }),
        expect.objectContaining({ kind: "safe-consumer" }),
      ]),
    );
    // The handler contract returns one ordered command-outcome batch;
    // persistence integration is gated independently.
    fixture.state.events = [...fixture.state.events, ...applied.events];
    fixture.state.artifacts.push(...applied.artifacts);

    const built = await fixture.handlers.BUILD_PROOF_BUNDLE(
      command("BUILD_PROOF_BUNDLE"),
    );
    expect(projectRun(fixture.state.events)).toMatchObject({ terminal: true });
    expect(built.artifacts).toEqual([
      expect.objectContaining({
        kind: "proof-bundle",
        metadata: expect.objectContaining({ checksum: expect.any(String) }),
      }),
    ]);
  });

  it("resumes replay preflight and apply without duplicating durable events", async () => {
    const source = replayBundle();
    const fixture = replayHarness(
      canonicalSerializeProofBundle(source),
      source.manifest,
    );
    fixture.state.events = [
      targetCreated(source.manifest),
      {
        ...source.events[1],
        runId: TARGET_RUN_ID,
        sequence: 2,
        commandId: "persisted-preflight",
      },
      ...source.events.slice(2).map((event, index) => ({
        ...event,
        runId: TARGET_RUN_ID,
        sequence: index + 3,
        commandId: "persisted-replay",
      })),
    ];

    const resumedPreflight = await fixture.handlers.RUN_PREFLIGHT(
      command("RUN_PREFLIGHT"),
    );
    expect(resumedPreflight).not.toHaveProperty("events");
    expect(resumedPreflight).toMatchObject({
      nextCommands: [{ kind: "APPLY_REPLAY_EVIDENCE" }],
    });
    const resumedApply = await fixture.handlers.APPLY_REPLAY_EVIDENCE(
      command("APPLY_REPLAY_EVIDENCE"),
    );
    expect(resumedApply).not.toHaveProperty("events");
    expect(resumedApply).toMatchObject({
      nextCommands: [{ kind: "BUILD_PROOF_BUNDLE" }],
    });
  });

  it("fails closed when replay mode has no persisted bundle loader", async () => {
    const source = replayBundle();
    const fixture = replayHarness(
      canonicalSerializeProofBundle(source),
      source.manifest,
    );
    const handlers = createProductionCommandHandlers({
      repository: fixture.repository as any,
      ports: {} as any,
      clock: { now: () => OCCURRED_AT },
    }) as Record<string, (value: any) => Promise<any>>;

    await expect(
      handlers.RUN_PREFLIGHT(command("RUN_PREFLIGHT")),
    ).rejects.toMatchObject({
      category: "configuration",
      code: "REPLAY_EVIDENCE_MISSING",
      retryable: false,
    });
  });

  it.each([
    [
      "different manifest",
      () => {
        const source = replayBundle();
        return {
          serialized: canonicalSerializeProofBundle(source),
          manifest: {
            ...source.manifest,
            consumer: {
              ...source.manifest.consumer,
              expectedHost: "mirror.example.net",
            },
          },
        };
      },
    ],
    [
      "nonterminal source",
      () => {
        const source = replayBundle({ terminal: false });
        return {
          serialized: canonicalSerializeProofBundle(source),
          manifest: source.manifest,
        };
      },
    ],
    [
      "failed consumer",
      () => {
        const source = replayBundle({ consumerPassed: false });
        return {
          serialized: canonicalSerializeProofBundle(source),
          manifest: source.manifest,
        };
      },
    ],
  ])("rejects %s replay evidence", async (_label, makeCase) => {
    const value = makeCase();
    const fixture = replayHarness(value.serialized, value.manifest);
    await expect(
      fixture.handlers.RUN_PREFLIGHT(command("RUN_PREFLIGHT")),
    ).rejects.toThrow(/terminal|passing|lifecycle|proof/i);
  });

  it("requires the durable replay-source artifact before applying evidence", async () => {
    const source = replayBundle();
    const fixture = replayHarness(
      canonicalSerializeProofBundle(source),
      source.manifest,
    );
    fixture.state.events.push({
      ...source.events[1],
      runId: TARGET_RUN_ID,
      sequence: 2,
      commandId: "persisted-preflight",
    });

    await expect(
      fixture.handlers.APPLY_REPLAY_EVIDENCE(
        command("APPLY_REPLAY_EVIDENCE"),
      ),
    ).rejects.toThrow(/replay-source.*required/i);
  });
});

function preflightArtifact() {
  return artifact("preflight-evidence", {
    canonicalUrl:
      "https://api.example.com/prices/eth?currency=USD&source=primary&window=1h",
    requestBytes: "0x574542324a534f4e",
    requestCalldata: "0xfeedcafe",
    quotedFeeWei: "12345",
    network: {
      chainId: 114,
      registryAddress: "0x2222222222222222222222222222222222222222",
      resolvedContracts: {
        FdcHub: FDC_HUB,
        FdcVerification: FDC_VERIFICATION,
        Relay: "0x4444444444444444444444444444444444444444",
      },
    },
  });
}

function liveHarness(input?: {
  events?: any[];
  persisted?: any;
  byRun?: any;
  observed?: Record<string, unknown>;
  reportedHash?: string;
  alreadyRecorded?: boolean;
}) {
  const events = input?.events ?? makeRunEvents().slice(0, 2);
  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      manifest: validManifest,
      events,
      projection: projectRun(events),
      artifacts: [preflightArtifact()],
    })),
    findRelayerTransaction: vi.fn(async () => input?.persisted ?? null),
    findRelayerTransactionByRun: vi.fn(async () => input?.byRun ?? null),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
  const ports = {
    signRelayerTransaction: vi.fn(),
    broadcastRawTransaction: vi.fn(
      async () => input?.reportedHash ?? TRANSACTION_HASH,
    ),
    resolveRecordedTransaction: vi.fn(
      async () => input?.alreadyRecorded ?? false,
    ),
    observeWalletTransaction: vi.fn(async () => ({
      transactionHash: TRANSACTION_HASH,
      chainId: 114,
      target: FDC_HUB,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
      ...input?.observed,
    })),
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as any,
    ports: ports as any,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (value: any) => Promise<any>>;
  return { repository, ports, handlers };
}

function persistedRelayer(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    idempotencyKey: "submission-1",
    chainId: 114,
    target: FDC_HUB,
    calldata: "0xfeedcafe",
    valueWei: 12_345n,
    nonce: 7n,
    rawTransaction: "0x02f8",
    transactionHash: TRANSACTION_HASH,
    broadcastAt: null,
    ...overrides,
  };
}

describe("Slice 007 wallet and relayer recovery coverage", () => {
  it("attaches a matching wallet transaction once and resumes without duplicate event", async () => {
    const first = liveHarness();
    const outcome = await first.handlers.ATTACH_WALLET_TRANSACTION(
      command("ATTACH_WALLET_TRANSACTION", {
        transactionHash: TRANSACTION_HASH,
      }),
    );
    expect(outcome).toMatchObject({
      events: [
        {
          type: "REQUEST_SUBMITTED",
          payload: { mode: "wallet", transactionHash: TRANSACTION_HASH },
        },
      ],
      nextCommands: [{ kind: "POLL_TRANSACTION_RECEIPT" }],
    });

    const resumed = liveHarness({ events: makeRunEvents().slice(0, 3) });
    await expect(
      resumed.handlers.ATTACH_WALLET_TRANSACTION(
        command("ATTACH_WALLET_TRANSACTION", {
          transactionHash: TRANSACTION_HASH,
        }),
      ),
    ).resolves.toMatchObject({
      events: [],
      nextCommands: [{ kind: "POLL_TRANSACTION_RECEIPT" }],
    });
  });

  it.each([
    ["chain", { chainId: 1 }],
    ["target", { target: "0x5555555555555555555555555555555555555555" }],
    ["calldata", { calldata: "0xdeadbeef" }],
    ["fee", { valueWei: 12_346n }],
  ])("rejects wallet transaction with mismatched %s", async (_label, observed) => {
    const fixture = liveHarness({ observed });
    await expect(
      fixture.handlers.ATTACH_WALLET_TRANSACTION(
        command("ATTACH_WALLET_TRANSACTION", {
          transactionHash: TRANSACTION_HASH,
        }),
      ),
    ).rejects.toThrow(/does not match.*preflight/i);
  });

  it("reconciles the run-level relayer identity without signing after restart", async () => {
    const persisted = persistedRelayer();
    const fixture = liveHarness({ byRun: persisted });
    await expect(
      fixture.handlers.SUBMIT_RELAYER(
        command("SUBMIT_RELAYER", { idempotencyKey: "submission-1" }),
      ),
    ).resolves.toMatchObject({
      nextCommands: [{ kind: "BROADCAST_RELAYER_TRANSACTION" }],
    });
    expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.repository.persistRelayerTransaction).not.toHaveBeenCalled();
  });

  it("accepts a matching persisted calldata digest but rejects a changed digest", async () => {
    const digest = createHash("sha256")
      .update(Buffer.from("feedcafe", "hex"))
      .digest("hex");
    const matching = liveHarness({
      byRun: persistedRelayer({ calldata: undefined, calldataHash: digest }),
    });
    await expect(
      matching.handlers.SUBMIT_RELAYER(
        command("SUBMIT_RELAYER", { idempotencyKey: "submission-1" }),
      ),
    ).resolves.toBeDefined();

    const changed = liveHarness({
      byRun: persistedRelayer({
        calldata: undefined,
        calldataHash: "0".repeat(64),
      }),
    });
    await expect(
      changed.handlers.SUBMIT_RELAYER(
        command("SUBMIT_RELAYER", { idempotencyKey: "submission-1" }),
      ),
    ).rejects.toThrow(/identity conflict/i);
  });

  it("fails closed when broadcast has no durable signed identity", async () => {
    const fixture = liveHarness();
    await expect(
      fixture.handlers.BROADCAST_RELAYER_TRANSACTION(
        command("BROADCAST_RELAYER_TRANSACTION", {
          idempotencyKey: "submission-1",
        }),
      ),
    ).rejects.toThrow(/persisted signed.*required/i);
  });

  it("uses recorded transaction recovery without a duplicate broadcast", async () => {
    const persisted = persistedRelayer();
    const fixture = liveHarness({
      persisted,
      alreadyRecorded: true,
    });
    await expect(
      fixture.handlers.BROADCAST_RELAYER_TRANSACTION(
        command("BROADCAST_RELAYER_TRANSACTION", {
          idempotencyKey: "submission-1",
        }),
      ),
    ).resolves.toMatchObject({
      events: [{ type: "REQUEST_SUBMITTED" }],
      nextCommands: [{ kind: "POLL_TRANSACTION_RECEIPT" }],
    });
    expect(fixture.ports.broadcastRawTransaction).not.toHaveBeenCalled();
    expect(fixture.repository.markRelayerBroadcast).toHaveBeenCalledOnce();
  });

  it("rejects a broadcaster that reports a different transaction hash", async () => {
    const fixture = liveHarness({
      persisted: persistedRelayer(),
      reportedHash: `0x${"8".repeat(64)}`,
    });
    await expect(
      fixture.handlers.BROADCAST_RELAYER_TRANSACTION(
        command("BROADCAST_RELAYER_TRANSACTION", {
          idempotencyKey: "submission-1",
        }),
      ),
    ).rejects.toThrow(/broadcast transaction hash mismatch/i);
    expect(fixture.repository.markRelayerBroadcast).not.toHaveBeenCalled();
  });
});
