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

  it.each([
    ["retry attempts", { maxAttempts: 0 }, /maxAttempts.*positive integer/i],
    ["lease heartbeat", { leaseHeartbeatMs: Number.NaN }, /leaseHeartbeatMs.*positive/i],
  ])("rejects an invalid %s bound before claiming work", (_label, override, error) => {
    const claimNextCommand = vi.fn();
    expect(() =>
      createRunWorker({
        environment: "test",
        mode: "replay",
        repository: {
          claimNextCommand,
          completeCommand: vi.fn(),
          retryCommand: vi.fn(),
        },
        handlers: {},
        logger: { info: vi.fn(), error: vi.fn() },
        ...override,
      }),
    ).toThrow(error);
    expect(claimNextCommand).not.toHaveBeenCalled();
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
      expect.objectContaining({
        category: "configuration",
        retryable: false,
        terminal: true,
        message: "No handler registered for command",
        commandId: "command_1",
      }),
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

  it("downgrades unrecognized categorized failures to bounded transport evidence", async () => {
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
        PREPARE_WEB2JSON: vi.fn().mockRejectedValue({
          category: "stripe-private",
          code: "lowercase-private-code",
          retryable: true,
          message: "customer cus_123",
          evidence: {
            stage: "INVALID STAGE",
            attempt: -1,
            retryAfterSeconds: Number.POSITIVE_INFINITY,
          },
        }),
      },
      logger,
    });

    await worker.processOne();
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_1",
      {
        category: "transport",
        retryable: true,
        message: "Worker command failed",
        evidence: {},
        commandId: "command_1",
      },
    );
    expect(JSON.stringify([
      repository.retryCommand.mock.calls,
      logger.error.mock.calls,
    ])).not.toMatch(/stripe-private|lowercase-private-code|cus_123|INVALID STAGE/);
  });

  it("persists and logs only stable categorized failure copy and allow-listed evidence", async () => {
    const privateMessage =
      "Stripe pi_123 failed for sk_live_private at https://storage.googleapis.com/run?X-Goog-Credential=private&X-Goog-Signature=signed&GoogleAccessId=owner";
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
        PREPARE_WEB2JSON: vi.fn().mockRejectedValue({
          category: "transport",
          code: "VERIFIER_TRANSPORT_FAILED",
          retryable: true,
          message: privateMessage,
          evidence: {
            stage: "preflight",
            attempt: 2,
            retryAfterSeconds: 15,
            url: "https://example.com/private?X-Goog-Security-Token=secret",
            stack: "private adapter stack",
            payload: { stripeCustomer: "cus_123", arbitrary: true },
          },
        }),
      },
      logger,
    });

    await expect(worker.processOne()).resolves.toBe(true);
    const safeFailure = {
      category: "transport",
      code: "VERIFIER_TRANSPORT_FAILED",
      retryable: true,
      message: "Worker command failed",
      evidence: {
        stage: "preflight",
        attempt: 2,
        retryAfterSeconds: 15,
      },
      commandId: "command_1",
    };
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_1",
      safeFailure,
    );
    expect(logger.error).toHaveBeenCalledWith({
      event: "WORKER_COMMAND_FAILED",
      ...safeFailure,
    });
    const persistedAndLogged = JSON.stringify([
      repository.retryCommand.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(persistedAndLogged).not.toMatch(
      /Stripe|pi_123|sk_live|storage\.googleapis|X-Goog|GoogleAccessId|private adapter stack|cus_123|arbitrary/i,
    );
  });

  it("persists and logs stable uncategorized failure copy without message, URL, stack, or payload leakage", async () => {
    const cause = Object.assign(
      new Error(
        "Stripe raw adapter failure sk_live_private https://example.com/private?X-Goog-Signature=signed",
      ),
      {
        stack: "private adapter stack",
        payload: { customer: "cus_123" },
      },
    );
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
      handlers: { PREPARE_WEB2JSON: vi.fn().mockRejectedValue(cause) },
      logger,
    });

    await expect(worker.processOne()).resolves.toBe(true);
    const safeFailure = {
      version: "1",
      category: "transport",
      code: "FDC_TRANSPORT",
      retryable: true,
      message: "Worker command failed",
      evidence: { commandId: "command_1" },
    };
    expect(repository.retryCommand).toHaveBeenCalledWith(
      "command_1",
      "claim_1",
      safeFailure,
    );
    expect(logger.error).toHaveBeenCalledWith({
      event: "WORKER_COMMAND_FAILED",
      ...safeFailure,
    });
    expect(JSON.stringify([
      repository.retryCommand.mock.calls,
      logger.error.mock.calls,
    ])).not.toMatch(
      /Stripe|sk_live|example\.com|X-Goog|private adapter stack|cus_123/i,
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
