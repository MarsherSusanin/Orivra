// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createRunWorker,
  validateWorkerComposition,
} from "../src/worker";

describe("live/replay composition boundary", () => {
  it("fails closed if a replay or simulator adapter is present in production", () => {
    expect(() =>
      validateWorkerComposition({
        environment: "production",
        mode: "live",
        adapters: {
          verifier: { kind: "replay" },
          rpc: { kind: "live" },
          da: { kind: "live" },
        },
      }),
    ).toThrow(/replay|simulat|production/i);

    expect(() =>
      validateWorkerComposition({
        environment: "test",
        mode: "replay",
        adapters: {
          verifier: { kind: "replay" },
          rpc: { kind: "replay" },
          da: { kind: "replay" },
        },
      }),
    ).not.toThrow();
  });
});

describe("restart-safe worker command protocol", () => {
  it("claims and commits a lease before external I/O, then completes with the same claim token", async () => {
    const order: string[] = [];
    const claimed = {
      claimToken: "claim_1",
      command: {
        id: "command_1",
        kind: "PREPARE_WEB2JSON",
        runId: "run_1",
        payload: {},
      },
    };
    const repository = {
      claimNextCommand: vi.fn(async () => {
        order.push("claim-committed");
        return claimed;
      }),
      completeCommand: vi.fn(async () => {
        order.push("complete");
      }),
      retryCommand: vi.fn(),
    };
    const handlers = {
      PREPARE_WEB2JSON: vi.fn(async () => {
        order.push("external-io");
        return { events: [], artifacts: [] };
      }),
    };
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository,
      handlers,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(worker.processOne()).resolves.toBe(true);
    expect(order).toEqual(["claim-committed", "external-io", "complete"]);
    expect(repository.completeCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_1",
      { events: [], artifacts: [] },
    );
  });

  it("retries with evidence and never marks stale leases complete", async () => {
    const repository = {
      claimNextCommand: vi.fn().mockResolvedValue({
        claimToken: "claim_current",
        command: {
          id: "command_1",
          kind: "POLL_DA_PROOF",
          runId: "run_1",
          attempts: 2,
          payload: {},
        },
      }),
      completeCommand: vi.fn(),
      retryCommand: vi.fn().mockResolvedValue(true),
    };
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository,
      handlers: {
        POLL_DA_PROOF: vi.fn().mockRejectedValue(
          Object.assign(new Error("not finalized"), {
            category: "not-finalized",
            retryable: true,
          }),
        ),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(worker.processOne()).resolves.toBe(true);
    expect(repository.completeCommand).not.toHaveBeenCalled();
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_current",
      expect.objectContaining({
        retryable: true,
        category: "not-finalized",
      }),
    );
  });

  it("does not duplicate a relayer broadcast when persisted signed bytes survive a restart", async () => {
    const handler = vi.fn().mockResolvedValue({
      events: [{ type: "REQUEST_SUBMITTED" }],
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const repository = {
      claimNextCommand: vi
        .fn()
        .mockResolvedValueOnce({
          claimToken: "claim_after_restart",
          command: {
            id: "command_relayer",
            kind: "BROADCAST_RELAYER_TRANSACTION",
            payload: {
              rawSignedTransaction: "0x02f8signed",
              transactionHash:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          },
        })
        .mockResolvedValueOnce(null),
      completeCommand: vi.fn(),
      retryCommand: vi.fn(),
    };
    const worker = createRunWorker({
      environment: "test",
      mode: "live",
      repository,
      handlers: { BROADCAST_RELAYER_TRANSACTION: handler },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(await worker.processOne()).toBe(true);
    expect(await worker.processOne()).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ rawSignedTransaction: "0x02f8signed" }),
      }),
    );
  });

  it("redacts worker logs even when a handler throws a secret-bearing error", async () => {
    const error = vi.fn();
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository: {
        claimNextCommand: vi.fn().mockResolvedValue({
          claimToken: "claim_1",
          command: { id: "command_1", kind: "FAIL", payload: {} },
        }),
        completeCommand: vi.fn(),
        retryCommand: vi.fn(),
      },
      handlers: {
        FAIL: async () => {
          throw new Error("Bearer project-secret; key=0xdeadbeef");
        },
      },
      logger: { info: vi.fn(), error },
    });

    await worker.processOne();
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/project-secret|deadbeef/);
  });
});
