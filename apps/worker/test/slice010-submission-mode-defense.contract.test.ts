// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { projectRun } from "@proofline/domain";
import {
  OCCURRED_AT,
  RUN_ID,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import { createProductionCommandHandlers } from "../src/worker";

const PROJECT_ID = "11111111-1111-4111-8111-111111111110";
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
const TRANSACTION_HASH = `0x${"9".repeat(64)}`;

type SubmissionMode = "wallet" | "relayer" | "replay";

function manifest(mode: SubmissionMode) {
  return {
    ...validManifest,
    submission: { ...validManifest.submission, mode },
  };
}

function command(kind: string, payload: Record<string, unknown>) {
  return {
    id: `slice010_${kind.toLowerCase()}`,
    kind,
    runId: RUN_ID,
    attempts: 1,
    payload,
  };
}

function harness(mode: SubmissionMode) {
  const persistedManifest = manifest(mode);
  const events = makeRunEvents()
    .slice(0, 2)
    .map((event) =>
      event.type === "RUN_CREATED"
        ? { ...event, payload: { manifest: persistedManifest } }
        : event,
    );
  const encoder = new TextEncoder();
  const ports = {
    signRelayerTransaction: vi.fn(),
    broadcastRawTransaction: vi.fn(),
    observeWalletTransaction: vi.fn(async () => ({
      transactionHash: TRANSACTION_HASH,
      chainId: 114,
      target: FDC_HUB,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
    })),
  };
  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
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
                blockNumber: "12345678",
                registryAddress:
                  "0x2222222222222222222222222222222222222222",
                resolvedContracts: {
                  FdcHub: FDC_HUB,
                  FdcRequestFeeConfigurations:
                    "0x6666666666666666666666666666666666666666",
                  FdcVerification: FDC_VERIFICATION,
                  Relay: "0x4444444444444444444444444444444444444444",
                },
              },
            }),
          ),
        },
      ],
    })),
    findRelayerTransaction: vi.fn(async () => null),
    findRelayerTransactionByRun: vi.fn(async () => null),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as any,
    ports: ports as any,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (value: any) => Promise<any>>;
  return { handlers, ports, repository };
}

function mismatch() {
  return {
    code: "SUBMISSION_MODE_MISMATCH",
    retryable: false,
  };
}

describe("Slice 010 worker submission defense in depth", () => {
  it.each(["wallet", "replay"] as const)(
    "rejects a persisted SUBMIT_RELAYER command for a %s manifest before custody or broadcast I/O",
    async (mode) => {
      const fixture = harness(mode);

      await expect(
        fixture.handlers.SUBMIT_RELAYER(
          command("SUBMIT_RELAYER", { idempotencyKey: "submission-1" }),
        ),
      ).rejects.toMatchObject(mismatch());
      expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.observeWalletTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.broadcastRawTransaction).not.toHaveBeenCalled();
      expect(fixture.repository.persistRelayerTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(["relayer", "replay"] as const)(
    "rejects a persisted ATTACH_WALLET_TRANSACTION command for a %s manifest before observation or broadcast I/O",
    async (mode) => {
      const fixture = harness(mode);

      await expect(
        fixture.handlers.ATTACH_WALLET_TRANSACTION(
          command("ATTACH_WALLET_TRANSACTION", {
            transactionHash: TRANSACTION_HASH,
          }),
        ),
      ).rejects.toMatchObject(mismatch());
      expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.observeWalletTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.broadcastRawTransaction).not.toHaveBeenCalled();
      expect(fixture.repository.persistRelayerTransaction).not.toHaveBeenCalled();
    },
  );
});
