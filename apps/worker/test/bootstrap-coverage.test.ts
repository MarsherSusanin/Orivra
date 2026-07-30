// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import {
  createProductionWorker,
  runWorkerLoop,
} from "../src/bootstrap";

function environment(override: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
    PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"b".repeat(64)}`,
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
  const runtime = {
    kind: "live" as const,
    execute: vi.fn(async () => ({ runId: "run_live", consumerVerified: true })),
  };
  const createRuntime = vi.fn(() => runtime);
  const createPipelinePorts = vi.fn(() => ({} as any));
  const createRepository = vi.fn(() => repository as any);
  const logger = { info: vi.fn(), error: vi.fn() };
  const worker = createProductionWorker({
    environment: environment(),
    pool: {},
    verifier: { prepareRequest: vi.fn() },
    createRuntime,
    createPipelinePorts,
    createRepository,
    clock: { now: () => "2025-05-15T12:04:11.000Z" },
    logger,
  });
  return { worker, repository, runtime, logger };
}

describe("production worker bootstrap coverage", () => {
  it.each([
    ["project", { PROOFLINE_PROJECT_TOKEN: "" }],
    ["private key", { PROOFLINE_COSTON2_PRIVATE_KEY: "" }],
  ])("requires the %s credential", (_label, override) => {
    expect(() =>
      createProductionWorker({
        environment: environment(override),
        pool: {},
        verifier: { prepareRequest: vi.fn() },
        createRuntime: vi.fn(() => ({ kind: "live", execute: vi.fn() })) as any,
        createPipelinePorts: vi.fn(() => ({})) as any,
        createRepository: vi.fn(() => ({})) as any,
      }),
    ).toThrow(/required/i);
  });

  it("executes a live command with validated manifest and injected secrets", async () => {
    const fixture = composition({
      id: "command-live",
      kind: "RUN_LIVE_COSTON2",
      runId: "run-1",
      payload: { manifest: validManifest },
    });
    await expect(fixture.worker.processOne()).resolves.toBe(true);
    expect(fixture.runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: validManifest,
        projectToken: environment().PROOFLINE_PROJECT_TOKEN,
        privateKey: environment().PROOFLINE_COSTON2_PRIVATE_KEY,
        timeoutMs: 600_000,
      }),
    );
    expect(fixture.repository.completeCommand).toHaveBeenCalledOnce();
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
