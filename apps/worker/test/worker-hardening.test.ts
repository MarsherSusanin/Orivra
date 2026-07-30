// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createRunWorker,
  validateWorkerComposition,
} from "../src/worker";

function claimed(kind = "PREPARE_WEB2JSON") {
  return {
    claimToken: "claim_1",
    command: {
      id: "command_1",
      kind,
      runId: "run_1",
      payload: {},
    },
  };
}

describe("worker production composition hardening", () => {
  it("requires live mode even when no replay adapter is explicitly registered", () => {
    expect(() =>
      validateWorkerComposition({
        environment: "production",
        mode: "replay",
        adapters: {},
      }),
    ).toThrow(/replay|production/i);
  });

  it("accepts only an all-live production composition", () => {
    expect(() =>
      validateWorkerComposition({
        environment: "production",
        mode: "live",
        adapters: {
          verifier: { kind: "live" },
          rpc: { kind: "live" },
          da: { kind: "live" },
        },
      }),
    ).not.toThrow();
  });
});

describe("worker command failure boundaries", () => {
  it("dead-letters a command with no registered handler", async () => {
    const repository = {
      claimNextCommand: vi.fn().mockResolvedValue(claimed("UNKNOWN_COMMAND")),
      completeCommand: vi.fn(),
      retryCommand: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository,
      handlers: {},
      logger,
    });

    await expect(worker.processOne()).resolves.toBe(true);
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_1",
      {
        category: "configuration",
        retryable: false,
        message: "No handler registered for command",
        commandId: "command_1",
      },
    );
    expect(repository.completeCommand).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ category: "configuration" }),
    );
  });

  it.each([null, "socket closed", 503])(
    "normalizes a non-object handler failure %j and preserves no secrets",
    async (failure) => {
      const repository = {
        claimNextCommand: vi.fn().mockResolvedValue(claimed()),
        completeCommand: vi.fn(),
        retryCommand: vi.fn().mockResolvedValue(undefined),
      };
      const logger = { info: vi.fn(), error: vi.fn() };
      const worker = createRunWorker({
        environment: "test",
        mode: "replay",
        repository,
        handlers: {
          PREPARE_WEB2JSON: vi.fn().mockRejectedValue(failure),
        },
        logger,
      });

      await expect(worker.processOne()).resolves.toBe(true);
      expect(repository.retryCommand).toHaveBeenCalledWith(
        "command_1",
        "claim_1",
        expect.objectContaining({
          category: "transport",
          retryable: true,
          evidence: { commandId: "command_1" },
        }),
      );
      expect(repository.completeCommand).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: "WORKER_COMMAND_FAILED" }),
      );
    },
  );

  it("uses the default message for categorized failures without one", async () => {
    const repository = {
      claimNextCommand: vi.fn().mockResolvedValue(claimed()),
      completeCommand: vi.fn(),
      retryCommand: vi.fn().mockResolvedValue(undefined),
    };
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository,
      handlers: {
        PREPARE_WEB2JSON: vi.fn().mockRejectedValue({
          category: "not-finalized",
          retryable: true,
        }),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await worker.processOne();
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_1",
      expect.objectContaining({ message: "Worker command failed" }),
    );
  });

  it("logs completion only after repository completion succeeds", async () => {
    const order: string[] = [];
    const repository = {
      claimNextCommand: vi.fn().mockResolvedValue(claimed()),
      completeCommand: vi.fn(async () => {
        order.push("persisted");
      }),
      retryCommand: vi.fn(),
    };
    const logger = {
      info: vi.fn(() => order.push("logged")),
      error: vi.fn(),
    };
    const worker = createRunWorker({
      environment: "test",
      mode: "replay",
      repository,
      handlers: {
        PREPARE_WEB2JSON: vi.fn().mockResolvedValue({ events: [] }),
      },
      logger,
    });

    await worker.processOne();
    expect(order).toEqual(["persisted", "logged"]);
    expect(logger.info).toHaveBeenCalledWith({
      event: "WORKER_COMMAND_COMPLETED",
      commandId: "command_1",
    });
  });
});
