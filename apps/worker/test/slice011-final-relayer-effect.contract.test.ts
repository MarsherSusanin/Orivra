// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { projectRun } from "@proofline/domain";
import {
  OCCURRED_AT,
  RUN_ID,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import { createProductionCommandHandlers } from "../src/worker";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
const TRANSACTION_HASH = `0x${"9".repeat(64)}`;
const IDEMPOTENCY_KEY = "slice011-broadcast";
const encoder = new TextEncoder();

type SubmissionMode = "wallet" | "relayer" | "replay";

function manifest(mode: SubmissionMode) {
  return {
    ...validManifest,
    submission: { ...validManifest.submission, mode },
  };
}

function executionContext(mode: SubmissionMode) {
  const persistedManifest = manifest(mode);
  const events = makeRunEvents()
    .slice(0, 2)
    .map((event) =>
      event.type === "RUN_CREATED"
        ? { ...event, payload: { manifest: persistedManifest } }
        : event,
    );
  return {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    manifest: persistedManifest,
    events,
    projection: projectRun(events as any),
    artifacts: [
      {
        kind: "preflight-evidence",
        canonicalBytes: encoder.encode(
          JSON.stringify({
            canonicalUrl:
              "https://api.example.com/prices/eth?currency=USD&source=primary&window=1h",
            requestBytes: "0x574542324a534f4e",
            requestCalldata: "0xfeedcafe",
            quotedFeeWei: "12345",
            network: {
              chainId: 114,
              registryAddress:
                "0x2222222222222222222222222222222222222222",
              resolvedContracts: {
                FdcHub: FDC_HUB,
                FdcVerification: FDC_VERIFICATION,
                Relay: "0x4444444444444444444444444444444444444444",
              },
            },
          }),
        ),
      },
      {
        kind: "relayer-policy",
        canonicalBytes: encoder.encode(
          JSON.stringify({
            projectFeeCapWei: "20000",
            globalFeeCapWei: "30000",
            quotaRemaining: 1,
            balanceFloorWei: "0",
          }),
        ),
      },
    ],
  };
}

function command() {
  return {
    id: "slice011_broadcast_relayer_transaction",
    kind: "BROADCAST_RELAYER_TRANSACTION",
    runId: RUN_ID,
    attempts: 1,
    payload: { idempotencyKey: IDEMPOTENCY_KEY },
  };
}

function persistedRelayer() {
  const canonical = JSON.stringify({
    runId: RUN_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    chainId: 114,
    target: FDC_HUB.toLowerCase(),
    calldata: "0xfeedcafe",
    valueWei: "12345",
  });
  return {
    runId: RUN_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    chainId: 114,
    target: FDC_HUB,
    calldata: "0xfeedcafe",
    valueWei: 12_345n,
    nonce: 7n,
    rawTransaction: "0x02f8",
    transactionHash: TRANSACTION_HASH,
    commandFingerprint: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    broadcastAt: null as string | null,
    broadcastAttemptedAt: null as string | null,
  };
}

function harness(mode: SubmissionMode) {
  const row = persistedRelayer();
  const trace: string[] = [];
  const repository = {
    loadRunExecutionContext: vi.fn(async () => executionContext(mode)),
    findRelayerTransaction: vi.fn(async () => {
      trace.push("find");
      return row;
    }),
    claimRelayerBroadcastAttempt: vi.fn(async () => {
      trace.push("claim");
      row.broadcastAttemptedAt = OCCURRED_AT;
      return true;
    }),
    markRelayerBroadcast: vi.fn(async () => {
      trace.push("mark");
      row.broadcastAt = OCCURRED_AT;
    }),
  };
  const ports = {
    deriveTransactionHash: vi.fn(() => {
      trace.push("derive");
      return TRANSACTION_HASH;
    }),
    resolveRecordedTransaction: vi.fn(async () => {
      trace.push("resolve");
      return false;
    }),
    broadcastRawTransaction: vi.fn(async () => {
      trace.push("broadcast");
      return TRANSACTION_HASH;
    }),
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as any,
    ports: ports as any,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (value: any) => Promise<any>>;
  return { handlers, ports, repository, trace };
}

describe("Slice 011 final relayer effect authorization", () => {
  it.each(["wallet", "replay"] as const)(
    "rejects a persisted BROADCAST_RELAYER_TRANSACTION for a %s manifest before repository or network effects",
    async (mode) => {
      const fixture = harness(mode);
      let result: any;
      let failure: unknown;

      try {
        result = await fixture.handlers.BROADCAST_RELAYER_TRANSACTION(command());
      } catch (cause) {
        failure = cause;
      }

      expect.soft(failure).toMatchObject({
        code: "SUBMISSION_MODE_MISMATCH",
        retryable: false,
      });
      expect.soft(result?.events ?? []).toEqual([]);
      expect.soft(result?.nextCommands ?? []).toEqual([]);
      expect.soft(fixture.repository.findRelayerTransaction).not.toHaveBeenCalled();
      expect.soft(fixture.ports.deriveTransactionHash).not.toHaveBeenCalled();
      expect.soft(fixture.repository.claimRelayerBroadcastAttempt).not.toHaveBeenCalled();
      expect.soft(fixture.ports.resolveRecordedTransaction).not.toHaveBeenCalled();
      expect.soft(fixture.ports.broadcastRawTransaction).not.toHaveBeenCalled();
      expect.soft(fixture.repository.markRelayerBroadcast).not.toHaveBeenCalled();
    },
  );

  it("keeps the relayer attempt marker before RPC I/O and never rebroadcasts after the durable acceptance marker", async () => {
    const fixture = harness("relayer");

    const first = await fixture.handlers.BROADCAST_RELAYER_TRANSACTION(command());
    expect(fixture.trace).toEqual([
      "find",
      "derive",
      "claim",
      "broadcast",
      "mark",
    ]);
    expect(fixture.trace.indexOf("claim")).toBeLessThan(
      fixture.trace.indexOf("broadcast"),
    );
    expect(first).toMatchObject({
      events: [
        expect.objectContaining({
          type: "REQUEST_SUBMITTED",
          payload: { mode: "relayer", transactionHash: TRANSACTION_HASH },
        }),
      ],
      nextCommands: [
        expect.objectContaining({
          kind: "POLL_TRANSACTION_RECEIPT",
          payload: { transactionHash: TRANSACTION_HASH },
        }),
      ],
    });

    fixture.trace.length = 0;
    const retry = await fixture.handlers.BROADCAST_RELAYER_TRANSACTION({
      ...command(),
      id: "slice011_broadcast_relayer_transaction_retry",
      attempts: 2,
    });

    expect(fixture.trace).toEqual(["find", "derive"]);
    expect(fixture.repository.claimRelayerBroadcastAttempt).toHaveBeenCalledOnce();
    expect(fixture.ports.broadcastRawTransaction).toHaveBeenCalledOnce();
    expect(fixture.repository.markRelayerBroadcast).toHaveBeenCalledOnce();
    expect(fixture.ports.resolveRecordedTransaction).not.toHaveBeenCalled();
    expect(retry.nextCommands).toEqual([
      expect.objectContaining({
        kind: "POLL_TRANSACTION_RECEIPT",
        payload: { transactionHash: TRANSACTION_HASH },
      }),
    ]);
  });
});
