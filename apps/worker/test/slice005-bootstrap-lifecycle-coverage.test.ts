// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => {
  const databaseResult = () => ({
    rowCount: 1,
    rows: [{
      schema_version: 10,
      checksum_count: 10,
      checksum_match: true,
      worker_state: "ready",
    }],
  });
  const client = {
    query: vi.fn(async () => databaseResult()),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async () => databaseResult()),
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };
  return {
    pool,
    client,
    poolOptions: [] as unknown[],
    Pool: vi.fn(function (this: unknown, options: unknown) {
      mocks.poolOptions.push(options);
      return pool;
    }),
    createVerifier: vi.fn(() => ({ prepareRequest: vi.fn() })),
    createRepository: vi.fn(() => ({ claimNextCommand: vi.fn() })),
    createPipelinePorts: vi.fn(() => ({ kind: "live" })),
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
    PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"b".repeat(64)}`,
    PROOFLINE_VERIFIER_API_KEY: "verifier-key",
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
    PROOFLINE_DEPLOYMENT_ID: `deployment_${"a".repeat(64)}`,
    PROOFLINE_RELEASE_TREE_SHA: "b".repeat(40),
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

  it("loads configured replay evidence files and supplies a working default clock", async () => {
    const replayFixture = resolve("packages/contracts/test/fixtures.ts");
    createProductionWorker({
      environment: environment({
        PROOFLINE_REPLAY_BUNDLE_PATH: replayFixture,
        PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH: replayFixture,
      }),
      pool: mocks.pool,
      verifier: { prepareRequest: vi.fn() },
      createRepository: mocks.createRepository as any,
      createPipelinePorts: mocks.createPipelinePorts as any,
    });

    const composition = mocks.createHandlers.mock.calls.at(-1)?.[0] as any;
    await expect(composition.ports.loadReplayBundle()).resolves.toContain(
      "validManifest",
    );
    await expect(
      composition.ports.loadReplayPreflightReport(),
    ).resolves.toContain("validPreflightReport");
    expect(composition.clock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("forwards a run-scoped persisted command to its production handler", async () => {
    const rawHandler = vi.fn().mockResolvedValue({ nextCommands: [] });
    mocks.createHandlers.mockReturnValueOnce({ RUN_PREFLIGHT: rawHandler });
    createProductionWorker({
      environment: environment(),
      pool: mocks.pool,
      verifier: { prepareRequest: vi.fn() },
      createRepository: mocks.createRepository as any,
      createPipelinePorts: mocks.createPipelinePorts as any,
      logger: { info: vi.fn(), error: vi.fn() },
    });
    const workerInput = mocks.createRunWorker.mock.calls.at(-1)?.[0] as any;
    const command = {
      id: "command-preflight",
      kind: "RUN_PREFLIGHT",
      runId: "run-1",
      payload: {},
    };

    await expect(workerInput.handlers.RUN_PREFLIGHT(command)).resolves.toEqual({
      nextCommands: [],
    });
    expect(rawHandler).toHaveBeenCalledWith(command);
  });

  it("uses structured JSON for the default production logger", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createProductionWorker({
      environment: environment(),
      pool: mocks.pool,
      verifier: { prepareRequest: vi.fn() },
      createRepository: mocks.createRepository as any,
      createPipelinePorts: mocks.createPipelinePorts as any,
    });
    const logger = (mocks.createRunWorker.mock.calls.at(-1)?.[0] as any).logger;

    logger.info({ event: "WORKER_READY" });
    logger.error({ event: "WORKER_FAILED", code: "SAFE_CODE" });
    expect(consoleInfo).toHaveBeenCalledWith('{"event":"WORKER_READY"}');
    expect(consoleError).toHaveBeenCalledWith(
      '{"event":"WORKER_FAILED","code":"SAFE_CODE"}',
    );
  });
});

describe("Slice 005 production worker process lifecycle", () => {
  async function expectRedactedDeploymentConfigurationError(
    operation: () => Promise<void>,
    forbidden: readonly string[],
  ) {
    let thrown: unknown;
    try {
      await operation();
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toMatchObject({
      code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
      message: "Deployment secret configuration is invalid",
    });
    const publicError = `${JSON.stringify(thrown)}\n${String((thrown as Error).message)}`;
    for (const marker of forbidden) expect(publicError).not.toContain(marker);
  }

  function expectNoStartupEffects() {
    expect(mocks.Pool).not.toHaveBeenCalled();
    expect(mocks.createVerifier).not.toHaveBeenCalled();
    expect(mocks.createPipelinePorts).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.createHandlers).not.toHaveBeenCalled();
    expect(mocks.createRunWorker).not.toHaveBeenCalled();
    expect(mocks.worker.processOne).not.toHaveBeenCalled();
    expect(mocks.pool.query).not.toHaveBeenCalled();
    expect(mocks.pool.connect).not.toHaveBeenCalled();
    expect(mocks.client.query).not.toHaveBeenCalled();
    expect(mocks.client.release).not.toHaveBeenCalled();
  }

  it("fails before side effects when the default process environment lacks DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PROOFLINE_VERIFIER_API_KEY", "never-echo-verifier");
    vi.stubEnv("PROOFLINE_COSTON2_PRIVATE_KEY", "never-echo-private");

    await expectRedactedDeploymentConfigurationError(
      () => startProductionWorker(),
      ["DATABASE_URL", "never-echo-verifier", "never-echo-private"],
    );
    expectNoStartupEffects();
  });

  it.each([
    ["verifier API key", {
      PROOFLINE_VERIFIER_API_KEY: "",
      PROOFLINE_COSTON2_PRIVATE_KEY: "never-echo-private",
    }, ["PROOFLINE_VERIFIER_API_KEY", "never-echo-private"]],
    ["Coston2 private key", {
      PROOFLINE_VERIFIER_API_KEY: "never-echo-verifier",
      PROOFLINE_COSTON2_PRIVATE_KEY: "",
    }, ["PROOFLINE_COSTON2_PRIVATE_KEY", "never-echo-verifier"]],
  ] as const)(
    "resolves all deployment secrets before startup when the %s is absent",
    async (_label, overrides, forbidden) => {
      if (_label === "Coston2 private key") {
        vi.spyOn(process, "on").mockImplementation(
          ((signal: string, listener: () => void) => {
            if (signal === "SIGTERM") listener();
            return process;
          }) as any,
        );
      }
      await expectRedactedDeploymentConfigurationError(
        () => startProductionWorker(environment({
          DATABASE_URL: "postgres://never-echo-database.invalid/db",
          ...overrides,
        })),
        ["never-echo-database", ...forbidden],
      );
      expectNoStartupEffects();
    },
  );

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
    const databaseSql = [
      ...mocks.pool.query.mock.calls,
      ...mocks.client.query.mock.calls,
    ].map(([sql]) => String(sql)).join("\n");
    expect(databaseSql).toMatch(/migration_checksums/);
    expect(databaseSql).toMatch(/deployment_worker_heartbeats/);
    expect(databaseSql).toMatch(/INSERT/i);
    expect(databaseSql).toMatch(/stopped_at/i);
    expect(mocks.client.release.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
