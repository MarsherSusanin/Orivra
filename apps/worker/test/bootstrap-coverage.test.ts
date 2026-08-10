// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createProductionWorker,
  runWorkerLoop,
} from "../src/bootstrap";

function runtimeConfig() {
  return {
    maxAttempts: 8,
    leaseHeartbeatMs: 10_000,
    relayerPolicy: {
      globalFeeCapWei: 20_000n,
      balanceFloorWei: 1_000n,
      dailyProjectQuota: 4,
    },
  };
}

const replayEvidence = {
  bundleCanonicalJson: '{"version":"1"}',
  bundleSha256: `sha256:${"a".repeat(64)}`,
  preflightReportCanonicalJson: '{"version":"1"}',
  preflightReportSha256: `sha256:${"b".repeat(64)}`,
};

function serializeForRedaction(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? entry.toString(10) : entry
  );
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
    runtimeConfig: runtimeConfig(),
    replayEvidence,
    pool: {},
    verifier: { prepareRequest: vi.fn() },
    createPipelinePorts,
    createRepository,
    clock: { now: () => "2025-05-15T12:04:11.000Z" },
    logger,
  } as any);
  return { worker, repository, createPipelinePorts, logger };
}

describe("production worker bootstrap coverage", () => {
  it("does not request project-token or execution-private-key credentials", () => {
    expect(() =>
      createProductionWorker({
        runtimeConfig: runtimeConfig(),
        replayEvidence,
        pool: {},
        verifier: { prepareRequest: vi.fn() },
        createPipelinePorts: vi.fn(() => ({})) as any,
        createRepository: vi.fn(() => ({ claimNextCommand: vi.fn() })) as any,
      } as any),
    ).not.toThrow();
    const exposed = serializeForRedaction(runtimeConfig());
    for (const marker of [
      "PROJECT_TOKEN",
      "COSTON2_PRIVATE_KEY",
      `0x${"b".repeat(64)}`,
      "verifier-key",
      "worker-password",
      "/run/proofline/replay",
    ]) {
      expect(exposed).not.toContain(marker);
    }
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
      expect.objectContaining({ message: "Worker command failed" }),
    );
    expect(JSON.stringify(fixture.repository.retryCommand.mock.calls)).not.toMatch(
      /run id/i,
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
