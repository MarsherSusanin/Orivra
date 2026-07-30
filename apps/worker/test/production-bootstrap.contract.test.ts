// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

type BootstrapModule = {
  createProductionWorker?: (input: Record<string, unknown>) => any;
  runWorkerLoop?: (input: Record<string, unknown>) => Promise<void>;
};

async function loadBootstrap(): Promise<Required<BootstrapModule>> {
  const module = (await import("../src/bootstrap")) as BootstrapModule;
  expect(module.createProductionWorker).toEqual(expect.any(Function));
  expect(module.runWorkerLoop).toEqual(expect.any(Function));
  if (!module.createProductionWorker || !module.runWorkerLoop) {
    throw new Error("Slice 004 production worker bootstrap is missing");
  }
  return module as Required<BootstrapModule>;
}

describe("Slice 004 production worker bootstrap", () => {
  it("composes injected live dependencies without touching process globals", async () => {
    const { createProductionWorker } = await loadBootstrap();
    const runtime = { kind: "live", execute: vi.fn() };
    const pipelinePorts = { kind: "live" };
    const repository = { claimNextCommand: vi.fn() };
    const createRuntime = vi.fn(() => runtime);
    const createPipelinePorts = vi.fn(() => pipelinePorts);
    const createRepository = vi.fn(() => repository);

    const worker = createProductionWorker({
      environment: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://proofline.invalid/proofline",
        PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
        PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"b".repeat(64)}`,
        PROOFLINE_VERIFIER_API_KEY: "verifier-test-key",
      },
      pool: { end: vi.fn() },
      verifier: { prepareRequest: vi.fn() },
      createRuntime,
      createPipelinePorts,
      createRepository,
      clock: { now: () => "2025-05-15T12:04:11.000Z" },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(worker).toEqual(expect.objectContaining({ processOne: expect.any(Function) }));
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(createPipelinePorts).toHaveBeenCalledOnce();
    expect(createRepository).toHaveBeenCalledOnce();
  });

  it("sleeps only for an idle iteration and stops without real timers or signals", async () => {
    const { runWorkerLoop } = await loadBootstrap();
    const processOne = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const sleep = vi.fn(async () => undefined);
    let checks = 0;

    await runWorkerLoop({
      processOne,
      shouldStop: () => ++checks > 2,
      sleep,
      idleDelayMs: 1_000,
    });

    expect(processOne).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1_000);
  });
});

describe("Slice 004 honest backend coverage scope", () => {
  it("includes production API/bootstrap logic and excludes only exact thin shims", async () => {
    const configModule = await import("../../../vitest.coverage.backend.config");
    const config = configModule.default as any;
    const coverage = config.test?.coverage;

    expect(coverage.include).toEqual(
      expect.arrayContaining([
        "apps/api/src/production-service.ts",
        "apps/api/src/bootstrap.ts",
        "apps/worker/src/bootstrap.ts",
      ]),
    );
    expect(coverage.exclude).toEqual([
      "apps/api/src/server.ts",
      "apps/worker/src/entry.ts",
      "packages/action/src/entry.ts",
      "packages/cli/src/bin.ts",
    ]);
  });
});
