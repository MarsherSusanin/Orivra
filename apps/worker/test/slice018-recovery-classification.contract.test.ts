// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  validManifest,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import { projectRun } from "@proofline/domain";
import {
  createProductionCommandHandlers,
  createRunWorker,
} from "../src/worker";

describe("Slice 018 worker recovery classification", () => {
  it.each([
    ["not-finalized", "REQUEST_RECEIPT_PENDING", "waiting"],
    ["transport", "VERIFIER_TRANSPORT_FAILED", "retryable"],
  ])("classifies %s before the repository schedules the same command", async (category, code, recoveryState) => {
    const retryCommand = vi.fn();
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository: {
        claimNextCommand: vi.fn().mockResolvedValue({
          claimToken: "claim_018",
          command: {
            id: "command_018",
            kind: "RECOVERABLE_COMMAND",
            runId: RUN_ID,
            attempts: 2,
            payload: {},
          },
        }),
        completeCommand: vi.fn(),
        retryCommand,
      },
      handlers: {
        RECOVERABLE_COMMAND: vi.fn().mockRejectedValue({
          category,
          code,
          message: "private upstream detail",
          retryable: true,
          evidence: { stage: "round", stack: "private stack" },
        }),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await worker.processOne();
    expect(retryCommand).toHaveBeenCalledWith(
      "command_018",
      "claim_018",
      expect.objectContaining({
        category,
        code,
        retryable: true,
        recoveryState,
        evidence: { stage: "round" },
      }),
    );
    expect(JSON.stringify(retryCommand.mock.calls)).not.toMatch(/private upstream|private stack/i);
  });

  it("observes a durable relayer hash after restart and never broadcasts it again", async () => {
    const manifest = {
      ...validManifest,
      submission: { ...validManifest.submission, mode: "relayer" as const },
    };
    const events = [
      {
        version: "1" as const,
        runId: RUN_ID,
        sequence: 1,
        commandId: "command_create",
        occurredAt: OCCURRED_AT,
        type: "RUN_CREATED" as const,
        payload: { manifest },
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
    const transactionHash = `0x${"9".repeat(64)}`;
    const fdcHub = validPreflightReport.registrySnapshot.resolvedContracts.FdcHub;
    const artifacts = [{
      kind: "preflight-evidence",
      canonicalBytes: new TextEncoder().encode(JSON.stringify({
        version: "1",
        canonicalUrl: validPreflightReport.canonicalUrl,
        requestBytes: "0x1234abcd",
        requestCalldata: "0xfeedcafe",
        quotedFeeWei: "12345",
        network: {
          chainId: 114,
          blockNumber: "12345678",
          registryAddress: validPreflightReport.registrySnapshot.registryAddress,
          resolvedContracts: {
            ...validPreflightReport.registrySnapshot.resolvedContracts,
            FdcHub: fdcHub,
          },
        },
      })),
    }];
    const persisted = {
      runId: RUN_ID,
      idempotencyKey: "submission-relayer-run",
      nonce: 7n,
      rawTransaction: "0x02f8",
      transactionHash,
      chainId: 114,
      target: fdcHub,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
      broadcastAt: null,
      broadcastAttemptedAt: "2026-08-03T01:59:00.000Z",
    };
    const repository = {
      loadRunExecutionContext: vi.fn().mockResolvedValue({
        runId: RUN_ID,
        projectId: "project_018",
        manifest,
        events,
        projection: projectRun(events),
        artifacts,
      }),
      findRelayerTransaction: vi.fn().mockResolvedValue(persisted),
      persistRelayerTransaction: vi.fn(),
      markRelayerBroadcast: vi.fn(),
      claimRelayerBroadcastAttempt: vi.fn(),
    };
    const ports = {
      resolveRecordedTransaction: vi.fn().mockResolvedValue(true),
      broadcastRawTransaction: vi.fn(),
    };
    const handlers = createProductionCommandHandlers({
      repository: repository as any,
      ports: ports as any,
      clock: { now: () => OCCURRED_AT },
    });

    const outcome = await handlers.BROADCAST_RELAYER_TRANSACTION({
      id: "command_broadcast",
      kind: "BROADCAST_RELAYER_TRANSACTION",
      runId: RUN_ID,
      attempts: 2,
      payload: { idempotencyKey: persisted.idempotencyKey },
    });
    expect(ports.resolveRecordedTransaction).toHaveBeenCalledWith(transactionHash);
    expect(ports.broadcastRawTransaction).not.toHaveBeenCalled();
    expect(repository.markRelayerBroadcast).toHaveBeenCalledWith(
      persisted.idempotencyKey,
      transactionHash,
    );
    expect(outcome.events).toEqual([
      expect.objectContaining({ type: "REQUEST_SUBMITTED" }),
    ]);
  });
});
