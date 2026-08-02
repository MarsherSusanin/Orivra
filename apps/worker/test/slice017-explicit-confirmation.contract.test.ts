// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  makeBundleInput,
  validManifest,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
  projectRun,
} from "@proofline/domain";
import { validateRelayerSubmission } from "@proofline/fdc-coston2";
import {
  createProductionCommandHandlers,
  createRunWorker,
} from "../src/worker";

const PROJECT_ID = "11111111-1111-4111-8111-111111111117";
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"9".repeat(64)}`;
const OTHER_TX_HASH = `0x${"8".repeat(64)}`;
const encoder = new TextEncoder();

type SubmissionMode = "wallet" | "relayer" | "replay";

function manifest(mode: SubmissionMode) {
  return {
    ...validManifest,
    submission: { ...validManifest.submission, mode },
  };
}

function events(mode: SubmissionMode) {
  return [
    {
      version: "1" as const,
      runId: RUN_ID,
      sequence: 1,
      commandId: "command_create",
      occurredAt: OCCURRED_AT,
      type: "RUN_CREATED" as const,
      payload: { manifest: manifest(mode) },
    },
    {
      version: "1" as const,
      runId: RUN_ID,
      sequence: 2,
      commandId: "command_preflight",
      occurredAt: OCCURRED_AT,
      type: "PREFLIGHT_ACCEPTED" as const,
      payload: {
        canonicalUrl: validPreflightReport.canonicalUrl,
        requestBytes: "0x1234abcd",
        quotedFeeWei: "12345",
      },
    },
  ];
}

function preflightArtifact() {
  return {
    kind: "preflight-evidence",
    canonicalBytes: encoder.encode(JSON.stringify({
      version: "1",
      canonicalUrl: validPreflightReport.canonicalUrl,
      requestBytes: "0x1234abcd",
      requestCalldata: "0xfeedcafe",
      quotedFeeWei: "12345",
      network: {
        chainId: 114,
        blockNumber: validPreflightReport.registrySnapshot.blockNumber,
        registryAddress: validPreflightReport.registrySnapshot.registryAddress,
        resolvedContracts: {
          ...validPreflightReport.registrySnapshot.resolvedContracts,
          FdcHub: FDC_HUB,
        },
      },
    })),
  };
}

function command(kind: string, payload: Record<string, unknown> = {}) {
  return {
    id: `command_${kind.toLowerCase()}`,
    kind,
    runId: RUN_ID,
    attempts: 1,
    payload,
  };
}

function harness(input: {
  mode: SubmissionMode;
  artifacts?: Record<string, unknown>[];
  observedHash?: string;
  observed?: Partial<{
    transactionHash: string;
    chainId: number;
    target: string;
    calldata: string;
    valueWei: bigint;
  }>;
}) {
  const runEvents = events(input.mode);
  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      manifest: manifest(input.mode),
      events: runEvents,
      projection: projectRun(runEvents as any),
      artifacts: input.artifacts ?? [preflightArtifact()],
    })),
    findRelayerTransaction: vi.fn(),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
  const ports = {
    preflight: vi.fn(),
    loadReplayBundle: vi.fn(),
    loadReplayPreflightReport: vi.fn(),
    signRelayerTransaction: vi.fn(),
    broadcastRawTransaction: vi.fn(),
    observeWalletTransaction: vi.fn(async () => ({
      transactionHash: input.observedHash ?? TX_HASH,
      chainId: 114,
      target: FDC_HUB,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
      ...input.observed,
    })),
    getTransactionReceipt: vi.fn(),
    getVotingConfiguration: vi.fn(),
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as any,
    ports: ports as any,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (value: any) => Promise<any>>;
  return { handlers, ports, repository };
}

describe("Slice 017 preflight is evidence-only", () => {
  it.each(["relayer", "replay"] as const)(
    "does not create an automatic %s effect after accepted preflight",
    async (mode) => {
      const fixture = harness({ mode });
      const outcome = await fixture.handlers.RUN_PREFLIGHT(command("RUN_PREFLIGHT"));

      expect(outcome.nextCommands ?? []).toEqual([]);
      expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.broadcastRawTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.loadReplayBundle).not.toHaveBeenCalled();
      expect(fixture.ports.loadReplayPreflightReport).not.toHaveBeenCalled();
    },
  );
});

describe("Slice 017 final command authorization", () => {
  it.each(["wallet", "relayer"] as const)(
    "rejects APPLY_REPLAY_EVIDENCE for persisted %s mode before any effect or artifact read",
    async (mode) => {
      const fixture = harness({ mode, artifacts: [] });
      await expect(
        fixture.handlers.APPLY_REPLAY_EVIDENCE(
          command("APPLY_REPLAY_EVIDENCE", { idempotencyKey: "explicit-replay" }),
        ),
      ).rejects.toMatchObject({
        category: "configuration",
        code: "SUBMISSION_MODE_MISMATCH",
        retryable: false,
      });
      expect(fixture.ports.loadReplayBundle).not.toHaveBeenCalled();
      expect(fixture.ports.loadReplayPreflightReport).not.toHaveBeenCalled();
      expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.broadcastRawTransaction).not.toHaveBeenCalled();
    },
  );

  it("requires the observed wallet transaction hash to equal the attached command hash", async () => {
    const fixture = harness({ mode: "wallet", observedHash: OTHER_TX_HASH });
    await expect(
      fixture.handlers.ATTACH_WALLET_TRANSACTION(
        command("ATTACH_WALLET_TRANSACTION", { transactionHash: TX_HASH }),
      ),
    ).rejects.toMatchObject({
      category: "configuration",
      code: "WALLET_TRANSACTION_HASH_MISMATCH",
      retryable: false,
    });
    expect(fixture.ports.observeWalletTransaction).toHaveBeenCalledWith({
      transactionHash: TX_HASH,
      runId: RUN_ID,
    });
    expect(fixture.ports.getTransactionReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.getVotingConfiguration).not.toHaveBeenCalled();
  });

  it.each(["", "0x1234", `0x${"g".repeat(64)}`])(
    "rejects malformed attached hash %j before wallet RPC observation",
    async (transactionHash) => {
      const fixture = harness({ mode: "wallet" });
      await expect(
        fixture.handlers.ATTACH_WALLET_TRANSACTION(
          command("ATTACH_WALLET_TRANSACTION", { transactionHash }),
        ),
      ).rejects.toMatchObject({
        category: "configuration",
        code: "WALLET_TRANSACTION_HASH_INVALID",
        retryable: false,
      });
      expect(fixture.ports.observeWalletTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.getTransactionReceipt).not.toHaveBeenCalled();
      expect(fixture.ports.getVotingConfiguration).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["chain", { chainId: 1 }],
    ["target", { target: "0x5555555555555555555555555555555555555555" }],
    ["calldata", { calldata: "0xdeadbeef" }],
    ["value", { valueWei: 12_346n }],
  ] as const)(
    "normalizes wallet %s mismatch as one terminal intent error",
    async (_label, observed) => {
      const fixture = harness({ mode: "wallet", observed: { ...observed } });
      await expect(
        fixture.handlers.ATTACH_WALLET_TRANSACTION(
          command("ATTACH_WALLET_TRANSACTION", { transactionHash: TX_HASH }),
        ),
      ).rejects.toMatchObject({
        version: "1",
        category: "configuration",
        code: "WALLET_TRANSACTION_INTENT_MISMATCH",
        retryable: false,
      });
      expect(fixture.ports.observeWalletTransaction).toHaveBeenCalledOnce();
      expect(fixture.ports.getTransactionReceipt).not.toHaveBeenCalled();
      expect(fixture.ports.getVotingConfiguration).not.toHaveBeenCalled();
    },
  );

  it("applies explicitly confirmed replay evidence without wallet, RPC, relayer or source-host effects", async () => {
    const source = makeBundleInput();
    const replayManifest = manifest("replay");
    const bundle = createProofBundle({
      ...source,
      manifest: replayManifest,
      events: source.events.map((event) =>
        event.type === "RUN_CREATED"
          ? { ...event, payload: { manifest: replayManifest } }
          : event,
      ),
    });
    const fixture = harness({
      mode: "replay",
      artifacts: [
        preflightArtifact(),
        {
          kind: "replay-source",
          canonicalBytes: encoder.encode(canonicalSerializeProofBundle(bundle)),
        },
      ],
    });

    await expect(
      fixture.handlers.APPLY_REPLAY_EVIDENCE(
        command("APPLY_REPLAY_EVIDENCE", { idempotencyKey: "explicit-replay" }),
      ),
    ).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "PROOF_AVAILABLE" }),
      ]),
      nextCommands: [expect.objectContaining({ kind: "BUILD_PROOF_BUNDLE" })],
    });
    expect(fixture.ports.loadReplayBundle).not.toHaveBeenCalled();
    expect(fixture.ports.loadReplayPreflightReport).not.toHaveBeenCalled();
    expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.ports.broadcastRawTransaction).not.toHaveBeenCalled();
    expect(fixture.ports.observeWalletTransaction).not.toHaveBeenCalled();
    expect(fixture.ports.getTransactionReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.getVotingConfiguration).not.toHaveBeenCalled();
  });
});

describe("Slice 017 relayer policy terminal evidence", () => {
  const relayerInput = {
    idempotencyKey: "slice017-worker-policy",
    chainId: 114,
    target: FDC_HUB,
    expectedTarget: FDC_HUB,
    calldata: "0xfeedcafe",
    expectedCalldata: "0xfeedcafe",
    valueWei: 12_345n,
    quotedFeeWei: 12_345n,
    projectFeeCapWei: 20_000n,
    globalFeeCapWei: 30_000n,
    quotaRemaining: 1,
    balanceWei: 100_000n,
    balanceFloorWei: 50_000n,
    gasLimit: 21_000n,
    maxFeePerGasWei: 1n,
  };

  it.each([
    [{ globalFeeCapWei: 12_000n }, "GLOBAL_FEE_CAP_EXCEEDED"],
    [{ quotaRemaining: 0 }, "RELAYER_QUOTA_EXHAUSTED"],
    [{ balanceFloorWei: 70_000n }, "BALANCE_FLOOR_VIOLATION"],
  ] as const)("persists non-retryable %s without generic retry normalization", async (override, code) => {
    const retryCommand = vi.fn();
    const worker = createRunWorker({
      environment: "test",
      mode: "live",
      repository: {
        claimNextCommand: vi.fn().mockResolvedValue({
          claimToken: "claim_slice017",
          command: {
            id: "command_submit_relayer",
            kind: "SUBMIT_RELAYER",
            runId: RUN_ID,
            attempts: 8,
            payload: {},
          },
        }),
        completeCommand: vi.fn(),
        retryCommand,
      },
      handlers: {
        SUBMIT_RELAYER: vi.fn(async () =>
          validateRelayerSubmission({ ...relayerInput, ...override }),
        ),
      },
      logger: { info: vi.fn(), error: vi.fn() },
      maxAttempts: 8,
    });

    await expect(worker.processOne()).resolves.toBe(true);
    expect(retryCommand).toHaveBeenCalledWith(
      "command_submit_relayer",
      "claim_slice017",
      expect.objectContaining({
        category: "configuration",
        code,
        retryable: false,
        terminal: true,
      }),
    );
    expect(JSON.stringify(retryCommand.mock.calls)).not.toMatch(
      /COMMAND_RETRY_EXHAUSTED|Bearer|private|authorization/i,
    );
  });
});
