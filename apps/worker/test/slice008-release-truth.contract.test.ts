// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import { projectRun } from "@proofline/domain";
import { createProductionCommandHandlers } from "../src/worker";

const PROJECT_ID = "11111111-1111-4111-8111-111111111118";
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
const TRANSACTION_HASH = `0x${"9".repeat(64)}`;
const encoder = new TextEncoder();
const relayerManifest = {
  ...validManifest,
  submission: { ...validManifest.submission, mode: "relayer" as const },
};

function artifact(kind: string, value: unknown) {
  return { kind, canonicalBytes: encoder.encode(JSON.stringify(value)) };
}

const preflightArtifact = artifact("preflight-evidence", {
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

const proofArtifact = artifact("proof-evidence", {
  version: "1",
  proof: {
    votingRound: 42871,
    merkleProof: [`0x${"a".repeat(64)}`],
    response: "0x1234",
  },
  attestationType: "Web2Json",
  relayRoot: `0x${"b".repeat(64)}`,
});

function executionContext(
  eventCount: number,
  manifest = validManifest as typeof validManifest | typeof relayerManifest,
) {
  const events = makeRunEvents().slice(0, eventCount).map((event) =>
    event.type === "RUN_CREATED"
      ? { ...event, payload: { manifest } }
      : event,
  );
  return {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    manifest,
    events,
    projection: projectRun(events),
    artifacts: [preflightArtifact, proofArtifact],
  };
}

function command(kind: string, payload: Record<string, unknown> = {}) {
  return {
    id: `slice008_${kind.toLowerCase()}`,
    kind,
    runId: RUN_ID,
    attempts: 1,
    payload,
  };
}

function baseRepository(context = executionContext(6)) {
  return {
    loadRunExecutionContext: vi.fn(async () => context),
    findRelayerTransaction: vi.fn(),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
}

describe("Slice 008 consumer intent and diagnostic evidence", () => {
  it("stops at proof verification without silently scheduling a consumer", async () => {
    const repository = baseRepository(executionContext(5));
    const verifyConsumer = vi.fn();
    const handlers = createProductionCommandHandlers({
      repository: repository as any,
      ports: {
        verifyProof: vi.fn(async () => ({
          verified: true,
          verificationContract: FDC_VERIFICATION,
        })),
        verifyConsumer,
      } as any,
      clock: { now: () => OCCURRED_AT },
    });

    const result = await handlers.VERIFY_PROOF(command("VERIFY_PROOF") as any);
    expect(result.events).toEqual([
      expect.objectContaining({ type: "PROOF_VERIFIED" }),
    ]);
    expect(result.nextCommands ?? []).toEqual([]);
    expect(verifyConsumer).not.toHaveBeenCalled();
  });

  it("rejects a failed consumer result without versioned diagnostic evidence", async () => {
    const repository = baseRepository(executionContext(6));
    const handlers = createProductionCommandHandlers({
      repository: repository as any,
      ports: {
        verifyConsumer: vi.fn(async () => ({ passed: false, diagnostics: [] })),
      } as any,
      clock: { now: () => OCCURRED_AT },
    });

    await expect(
      handlers.VERIFY_CONSUMER(
        command("VERIFY_CONSUMER", {
          consumer: "canonical-vulnerable",
        }) as any,
      ),
    ).rejects.toMatchObject({
      code: "CONSUMER_DIAGNOSTICS_MISSING",
      retryable: false,
    });
  });
});

function persistedRelayer(attemptedAt: string | null) {
  return {
    runId: RUN_ID,
    idempotencyKey: "slice008-broadcast",
    chainId: 114,
    target: FDC_HUB,
    calldata: "0xfeedcafe",
    valueWei: 12_345n,
    nonce: 7n,
    rawTransaction: "0x02f8",
    transactionHash: TRANSACTION_HASH,
    broadcastAt: null,
    broadcastAttemptedAt: attemptedAt,
  };
}

describe("Slice 008 durable relayer attempt boundary", () => {
  it("records the sole attempt before I/O and never broadcasts on the crash retry", async () => {
    const order: string[] = [];
    let attemptedAt: string | null = null;
    let markCalls = 0;
    const repository = {
      ...baseRepository(executionContext(2, relayerManifest)),
      findRelayerTransaction: vi.fn(async () =>
        persistedRelayer(attemptedAt),
      ),
      claimRelayerBroadcastAttempt: vi.fn(async () => {
        order.push("attempt");
        if (attemptedAt) return false;
        attemptedAt = OCCURRED_AT;
        return true;
      }),
      markRelayerBroadcast: vi.fn(async () => {
        markCalls += 1;
        if (markCalls === 1) {
          throw new Error("simulated crash after RPC acceptance");
        }
      }),
    };
    const broadcaster = vi.fn(async () => {
      order.push("broadcast");
      return TRANSACTION_HASH;
    });
    const ports = {
      deriveTransactionHash: vi.fn(() => TRANSACTION_HASH),
      resolveRecordedTransaction: vi.fn(async () => false),
      broadcastRawTransaction: broadcaster,
    };
    const handlers = createProductionCommandHandlers({
      repository: repository as any,
      ports: ports as any,
      clock: { now: () => OCCURRED_AT },
    });
    const broadcastCommand = command("BROADCAST_RELAYER_TRANSACTION", {
      idempotencyKey: "slice008-broadcast",
    });

    await expect(
      handlers.BROADCAST_RELAYER_TRANSACTION(broadcastCommand as any),
    ).rejects.toThrow(/simulated crash/i);
    await expect(
      handlers.BROADCAST_RELAYER_TRANSACTION(broadcastCommand as any),
    ).rejects.toThrow(/ambiguous|manual recovery|attempt/i);

    expect(order.slice(0, 2)).toEqual(["attempt", "broadcast"]);
    expect(repository.claimRelayerBroadcastAttempt).toHaveBeenCalled();
    expect(broadcaster).toHaveBeenCalledOnce();
    expect(ports.resolveRecordedTransaction).toHaveBeenCalledWith(
      TRANSACTION_HASH,
    );
  });
});
