// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  exactTrustManifest,
  makeBundleInput,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import {
  canonicalSerializePreflightReport,
  canonicalSerializeProofBundle,
  createProofBundle,
} from "@proofline/domain";

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

let replayDirectory = "";
let replayBundlePath = "";
let replayPreflightReportPath = "";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL:
      "postgres://proofline_worker_login:worker-password@postgres:5432/proofline",
    PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"b".repeat(64)}`,
    PROOFLINE_VERIFIER_API_KEY: "verifier-key",
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
    PROOFLINE_SAFE_CONSUMER_ADDRESS:
      "0x5555555555555555555555555555555555555555",
    PROOFLINE_REPLAY_BUNDLE_PATH: replayBundlePath,
    PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH: replayPreflightReportPath,
    PROOFLINE_DEPLOYMENT_ID: `deployment_${"a".repeat(64)}`,
    PROOFLINE_RELEASE_TREE_SHA: "b".repeat(40),
    ...overrides,
  };
}

beforeAll(async () => {
  replayDirectory = await mkdtemp(join(tmpdir(), "proofline-slice005-replay-"));
  replayBundlePath = join(replayDirectory, "bundle.json");
  replayPreflightReportPath = join(replayDirectory, "preflight-report.json");
  const input = makeBundleInput();
  const manifest = {
    ...exactTrustManifest,
    submission: { ...exactTrustManifest.submission, mode: "replay" as const },
  };
  const events = input.events.map((event) =>
    event.type === "RUN_CREATED"
      ? { ...event, payload: { manifest } }
      : event,
  );
  const bundle = createProofBundle({ ...input, manifest, events });
  const accepted = bundle.events.find((event) => event.type === "PREFLIGHT_ACCEPTED");
  if (accepted?.type !== "PREFLIGHT_ACCEPTED") throw new Error("fixture invalid");
  const report = {
    ...structuredClone(validPreflightReport),
    runId: bundle.runId,
    canonicalUrl: accepted.payload.canonicalUrl,
    requestIdentitySha256: `sha256:${createHash("sha256")
      .update(Buffer.from(bundle.requestBytes.slice(2), "hex"))
      .digest("hex")}`,
    registrySnapshot: {
      ...structuredClone(validPreflightReport.registrySnapshot),
      chainId: bundle.network.chainId,
      blockNumber: bundle.network.blockNumber,
      registryAddress: bundle.network.registryAddress,
      resolvedContracts: {
        ...structuredClone(validPreflightReport.registrySnapshot.resolvedContracts),
        ...bundle.network.resolvedContracts,
      },
    },
    fee: {
      ...structuredClone(validPreflightReport.fee),
      quotedWei: accepted.payload.quotedFeeWei,
      capWei: bundle.manifest.submission.feeCapWei,
    },
  };
  await Promise.all([
    writeFile(replayBundlePath, canonicalSerializeProofBundle(bundle)),
    writeFile(
      replayPreflightReportPath,
      canonicalSerializePreflightReport(report),
    ),
  ]);
});

afterAll(async () => {
  if (replayDirectory) await rm(replayDirectory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolOptions.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function typedRuntimeConfig() {
  return Object.freeze({
    chainId: 114 as const,
    registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    verifierEndpoint: "https://fdc-verifiers-testnet.flare.network",
    rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    daEndpoint: "https://ctn2-data-availability.flare.network",
    receiptPollTimeoutMs: 25_000,
    daTimeoutMs: 15_000,
    databasePoolSize: 4,
    maxAttempts: 3,
    leaseHeartbeatMs: 2_500,
    relayerAccount: { address: "0x3333333333333333333333333333333333333333" },
    relayerPolicy: Object.freeze({
      globalFeeCapWei: 20_000n,
      balanceFloorWei: 1_000n,
      dailyProjectQuota: 4,
    }),
    safeConsumerAddress: "0x5555555555555555555555555555555555555555",
  });
}

const replayEvidence = Object.freeze({
  bundleCanonicalJson: '{"version":"1"}',
  bundleSha256: `sha256:${"a".repeat(64)}`,
  preflightReportCanonicalJson: '{"version":"1"}',
  preflightReportSha256: `sha256:${"b".repeat(64)}`,
});

describe("Slice 005 production worker configuration", () => {
  it("passes only immutable parsed policy and replay evidence to downstream ports", async () => {
    const runtimeConfig = typedRuntimeConfig();
    createProductionWorker({
      runtimeConfig,
      replayEvidence,
      pool: mocks.pool,
      verifier: { prepareRequest: vi.fn() },
      createPipelinePorts: mocks.createPipelinePorts as any,
    } as any);

    expect(mocks.createRepository).toHaveBeenCalledWith({
      pool: mocks.pool,
      relayerPolicy: runtimeConfig.relayerPolicy,
    });
    expect(mocks.createPipelinePorts).toHaveBeenCalledWith({
      runtimeConfig,
      verifier: expect.any(Object),
    });
    expect(mocks.createRunWorker).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 3, leaseHeartbeatMs: 2_500 }),
    );
    const composition = mocks.createHandlers.mock.calls.at(-1)?.[0] as any;
    await expect(composition.ports.loadReplayBundle()).resolves.toBe(
      replayEvidence.bundleCanonicalJson,
    );
    await expect(composition.ports.loadReplayPreflightReport()).resolves.toBe(
      replayEvidence.preflightReportCanonicalJson,
    );
    expect(composition.clock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("forwards a run-scoped persisted command to its production handler", async () => {
    const rawHandler = vi.fn().mockResolvedValue({ nextCommands: [] });
    mocks.createHandlers.mockReturnValueOnce({ RUN_PREFLIGHT: rawHandler });
    createProductionWorker({
      runtimeConfig: typedRuntimeConfig(),
      replayEvidence,
      pool: mocks.pool,
      verifier: { prepareRequest: vi.fn() },
      createRepository: mocks.createRepository as any,
      createPipelinePorts: mocks.createPipelinePorts as any,
      logger: { info: vi.fn(), error: vi.fn() },
    } as any);
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
      runtimeConfig: typedRuntimeConfig(),
      replayEvidence,
      pool: mocks.pool,
      verifier: { prepareRequest: vi.fn() },
      createRepository: mocks.createRepository as any,
      createPipelinePorts: mocks.createPipelinePorts as any,
    } as any);
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

  async function expectRedactedRuntimeConfigurationError(
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
      code: "WORKER_RUNTIME_CONFIGURATION_INVALID",
      message: "Worker runtime configuration is invalid",
    });
    const publicError = `${JSON.stringify(thrown)}\n${String((thrown as Error)?.message)}`;
    for (const marker of forbidden) expect(publicError).not.toContain(marker);
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

  it.each([
    ["safe consumer", { PROOFLINE_SAFE_CONSUMER_ADDRESS: "" }],
    ["replay bundle", { PROOFLINE_REPLAY_BUNDLE_PATH: "" }],
    ["replay report", { PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH: "" }],
    ["verifier endpoint", { PROOFLINE_VERIFIER_URL: "http://verifier.invalid" }],
    ["worker database role", {
      DATABASE_URL:
        "postgres://proofline_api_login:swapped-secret@postgres:5432/proofline",
    }],
  ])("rejects invalid %s before Pool, schema, heartbeat or claims", async (_label, override) => {
    vi.spyOn(process, "on").mockImplementation(
      ((signal: string, listener: () => void) => {
        if (signal === "SIGINT") listener();
        return process;
      }) as any,
    );
    await expectRedactedRuntimeConfigurationError(
      () => startProductionWorker(environment(override)),
      Object.values(override),
    );
    expectNoStartupEffects();
    expect(mocks.pool.end).not.toHaveBeenCalled();
  });

  it("rejects invalid relayer policy before creating Pool or temporary readiness authority", async () => {
    const privateMarkers = [
      "postgres://proofline_worker_login:worker-password@postgres:5432/proofline",
      "verifier-key",
      `0x${"b".repeat(64)}`,
      "-1",
    ];
    await expectRedactedRuntimeConfigurationError(
      () => startProductionWorker(environment({
        PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "-1",
      })),
      privateMarkers,
    );
    expectNoStartupEffects();
    expect(mocks.pool.end).not.toHaveBeenCalled();
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
