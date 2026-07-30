// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createProductionWorker,
  runWorkerLoop,
} from "../src/bootstrap";

function environment(override: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    ...override,
  };
}

function composition(command: Record<string, unknown>) {
  const completeCommand = vi.fn(async () => undefined);
  const retryCommand = vi.fn(async () => undefined);
  const repository = {
    claimNextCommand: vi.fn().mockResolvedValueOnce({
      claimToken: "claim-1",
      command,
    }),
    completeCommand,
    retryCommand,
    renewLease: vi.fn(async () => undefined),
    loadRunExecutionContext: vi.fn(),
    findRelayerTransaction: vi.fn(),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
  const createPipelinePorts = vi.fn(() => ({} as any));
  const createRepository = vi.fn(() => repository as any);
  const logger = { info: vi.fn(), error: vi.fn() };
  const worker = createProductionWorker({
    environment: environment(),
    pool: {},
    verifier: { prepareRequest: vi.fn() },
    createPipelinePorts,
    createRepository,
    clock: { now: () => "2025-05-15T12:04:11.000Z" },
    logger,
  });
  return { worker, repository, createPipelinePorts, logger };
}

describe("production worker bootstrap coverage", () => {
  it("does not request project-token or execution-private-key credentials", () => {
    const guardedEnvironment = environment();
    const credentialReads: string[] = [];
    for (const name of [
      "PROOFLINE_PROJECT_TOKEN",
      "PROOFLINE_COSTON2_PRIVATE_KEY",
    ]) {
      Object.defineProperty(guardedEnvironment, name, {
        enumerable: true,
        get() {
          credentialReads.push(name);
          throw new Error(`Production bootstrap requested ${name}`);
        },
      });
    }

    expect(() =>
      createProductionWorker({
        environment: guardedEnvironment,
        pool: {},
        verifier: { prepareRequest: vi.fn() },
        createPipelinePorts: vi.fn(() => ({})) as any,
        createRepository: vi.fn(() => ({ claimNextCommand: vi.fn() })) as any,
      }),
    ).not.toThrow();
    expect(credentialReads).toEqual([]);
  });

  it("never registers the synthetic live command, even in test environment", async () => {
    const fixture = composition({
      id: "command-live",
      kind: "RUN_LIVE_COSTON2",
      runId: "run-1",
      payload: {},
    });
    await expect(fixture.worker.processOne()).resolves.toBe(true);
    expect(fixture.repository.completeCommand).not.toHaveBeenCalled();
    expect(fixture.repository.retryCommand).toHaveBeenCalledWith(
      "command-live",
      "claim-1",
      expect.objectContaining({
        category: "configuration",
        code: "WORKER_HANDLER_MISSING",
        terminal: true,
      }),
    );
  });

  it("rejects a persisted pipeline command without a run id", async () => {
    const fixture = composition({
      id: "command-preflight",
      kind: "RUN_PREFLIGHT",
      payload: {},
    });
    await expect(fixture.worker.processOne()).resolves.toBe(true);
    expect(fixture.repository.completeCommand).not.toHaveBeenCalled();
    expect(fixture.repository.retryCommand).toHaveBeenCalledWith(
      "command-preflight",
      "claim-1",
      expect.objectContaining({ message: expect.stringMatching(/run id/i) }),
    );
  });

  it("does not sleep after processed work and stops on the next injected check", async () => {
    const processOne = vi.fn(async () => true);
    const sleep = vi.fn();
    let checks = 0;
    await runWorkerLoop({
      processOne,
      shouldStop: () => ++checks > 1,
      sleep,
      idleDelayMs: 1_000,
    });
    expect(processOne).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
