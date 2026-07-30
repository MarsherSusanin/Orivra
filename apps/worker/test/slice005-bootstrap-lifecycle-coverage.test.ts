// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pool = { end: vi.fn(async () => undefined) };
  return {
    pool,
    poolOptions: [] as unknown[],
    Pool: vi.fn(function (this: unknown, options: unknown) {
      mocks.poolOptions.push(options);
      return pool;
    }),
    createVerifier: vi.fn(() => ({ prepareRequest: vi.fn() })),
    createRepository: vi.fn(() => ({ claimNextCommand: vi.fn() })),
    createPipelinePorts: vi.fn(() => ({ kind: "live" })),
    createRuntime: vi.fn(() => ({ kind: "live", execute: vi.fn() })),
    createHandlers: vi.fn(() => ({})),
    worker: { processOne: vi.fn<() => Promise<boolean>>() },
    createRunWorker: vi.fn(() => ({ processOne: mocks.worker.processOne })),
  };
});

vi.mock("pg", () => ({ Pool: mocks.Pool }));
vi.mock("@proofline/api/src/postgres", () => ({
  createPostgresCommandRepository: mocks.createRepository,
}));
vi.mock("@proofline/fdc-coston2", () => ({
  createWeb2JsonVerifierClient: mocks.createVerifier,
}));
vi.mock("../src/live-runtime", () => ({
  createLiveCoston2PipelinePorts: mocks.createPipelinePorts,
  createLiveCoston2Runtime: mocks.createRuntime,
}));
vi.mock("../src/worker", () => ({
  createProductionCommandHandlers: mocks.createHandlers,
  createRunWorker: mocks.createRunWorker,
}));

import {
  createProductionWorker,
  startProductionWorker,
} from "../src/bootstrap";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://proofline.invalid/proofline",
    PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
    PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"b".repeat(64)}`,
    PROOFLINE_VERIFIER_API_KEY: "verifier-key",
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolOptions.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Slice 005 production worker configuration", () => {
  it.each([
    ["unsigned global cap", { PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "-1" }, /unsigned/i],
    ["required balance floor", { PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "" }, /required/i],
    ["positive quota", { PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "0" }, /positive/i],
    [
      "safe quota",
      { PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "9007199254740992" },
      /safe integer/i,
    ],
  ])("rejects invalid persisted relayer policy: %s", (_label, override, error) => {
    expect(() =>
      createProductionWorker({
        environment: environment(override),
        pool: mocks.pool,
        verifier: { prepareRequest: vi.fn() },
        createPipelinePorts: mocks.createPipelinePorts as any,
        createRuntime: mocks.createRuntime as any,
      }),
    ).toThrow(error);
    expect(mocks.createRunWorker).not.toHaveBeenCalled();
  });

  it.each([
    ["attempts", { PROOFLINE_WORKER_MAX_ATTEMPTS: "0" }, /positive/i],
    [
      "heartbeat",
      { PROOFLINE_WORKER_LEASE_HEARTBEAT_MS: "9007199254740992" },
      /safe integer/i,
    ],
  ])("rejects an invalid worker %s bound", (_label, override, error) => {
    expect(() =>
      createProductionWorker({
        environment: environment(override),
        pool: mocks.pool,
        verifier: { prepareRequest: vi.fn() },
        createRepository: mocks.createRepository as any,
        createPipelinePorts: mocks.createPipelinePorts as any,
        createRuntime: mocks.createRuntime as any,
      }),
    ).toThrow(error);
  });

  it("passes validated persisted policy to the default PostgreSQL repository", () => {
    createProductionWorker({
      environment: environment({
        PROOFLINE_WORKER_MAX_ATTEMPTS: "3",
        PROOFLINE_WORKER_LEASE_HEARTBEAT_MS: "2500",
      }),
      pool: mocks.pool,
      verifier: { prepareRequest: vi.fn() },
      createPipelinePorts: mocks.createPipelinePorts as any,
      createRuntime: mocks.createRuntime as any,
    });

    expect(mocks.createRepository).toHaveBeenCalledWith({
      pool: mocks.pool,
      relayerPolicy: {
        globalFeeCapWei: 20_000n,
        balanceFloorWei: 1_000n,
        dailyProjectQuota: 4,
      },
    });
    expect(mocks.createRunWorker).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 3, leaseHeartbeatMs: 2_500 }),
    );
  });
});

describe("Slice 005 production worker process lifecycle", () => {
  it("fails before side effects when the default process environment lacks DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await expect(startProductionWorker()).rejects.toThrow(/DATABASE_URL.*required/i);
    expect(mocks.Pool).not.toHaveBeenCalled();
  });

  it("uses pool defaults but still fails fast when verifier configuration is absent", async () => {
    await expect(
      startProductionWorker({ DATABASE_URL: "postgres://proofline.invalid/db" }),
    ).rejects.toThrow(/PROOFLINE_VERIFIER_API_KEY.*required/i);
    expect(mocks.poolOptions).toEqual([
      {
        connectionString: "postgres://proofline.invalid/db",
        max: 4,
        idleTimeoutMillis: 30_000,
      },
    ]);
    expect(mocks.createVerifier).not.toHaveBeenCalled();
  });

  it("registers shutdown signals, processes once, and closes the production pool", async () => {
    const signals = new Map<string, () => void>();
    vi.spyOn(process, "on").mockImplementation(((signal: string, listener: () => void) => {
      signals.set(signal, listener);
      return process;
    }) as any);
    mocks.worker.processOne.mockImplementationOnce(async () => {
      signals.get("SIGTERM")?.();
      return true;
    });

    await startProductionWorker(
      environment({
        PROOFLINE_WORKER_DB_POOL_SIZE: "6",
        PROOFLINE_VERIFIER_URL: "https://verifier.invalid",
      }),
    );

    expect([...signals.keys()]).toEqual(["SIGINT", "SIGTERM"]);
    expect(mocks.worker.processOne).toHaveBeenCalledOnce();
    expect(mocks.pool.end).toHaveBeenCalledOnce();
    expect(mocks.poolOptions.at(-1)).toMatchObject({ max: 6 });
    expect(mocks.createVerifier).toHaveBeenCalledWith({
      endpoint: "https://verifier.invalid",
      apiKey: "verifier-key",
    });
  });
});
