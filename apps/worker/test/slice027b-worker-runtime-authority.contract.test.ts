// @vitest-environment node

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
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

type Environment = Record<string, string | undefined>;
type RuntimeModule = {
  parseWorkerRuntimeConfig?: (environment: Environment) => any;
  loadWorkerReplayEvidence?: (config: any) => Promise<any>;
};

const temporaryDirectories: string[] = [];
const PRIVATE_KEY = `0x${"3".repeat(64)}`;
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

async function runtimeModule(): Promise<RuntimeModule> {
  const path = pathToFileURL(fileURLToPath(
    new URL("../src/worker-runtime-configuration.ts", import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

function environment(overrides: Environment = {}): Environment {
  return {
    DATABASE_URL:
      "postgres://proofline_worker_login:worker-password@postgres:5432/proofline",
    PROOFLINE_VERIFIER_API_KEY: "verifier-key",
    PROOFLINE_COSTON2_PRIVATE_KEY: PRIVATE_KEY,
    PROOFLINE_DEPLOYMENT_ID: `deployment_${"a".repeat(64)}`,
    PROOFLINE_RELEASE_TREE_SHA: "b".repeat(40),
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000000000000000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
    PROOFLINE_SAFE_CONSUMER_ADDRESS:
      "0x5555555555555555555555555555555555555555",
    PROOFLINE_REPLAY_BUNDLE_PATH: "/run/proofline/replay/bundle.json",
    PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH:
      "/run/proofline/replay/preflight-report.json",
    ...overrides,
  };
}

function replaySource() {
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
  return createProofBundle({ ...input, manifest, events });
}

function boundReport(source: ReturnType<typeof replaySource>) {
  const accepted = source.events.find((event) => event.type === "PREFLIGHT_ACCEPTED");
  if (accepted?.type !== "PREFLIGHT_ACCEPTED") throw new Error("fixture invalid");
  return {
    ...structuredClone(validPreflightReport),
    runId: source.runId,
    canonicalUrl: accepted.payload.canonicalUrl,
    requestIdentitySha256: `sha256:${createHash("sha256")
      .update(Buffer.from(source.requestBytes.slice(2), "hex"))
      .digest("hex")}`,
    registrySnapshot: {
      ...structuredClone(validPreflightReport.registrySnapshot),
      chainId: source.network.chainId,
      blockNumber: source.network.blockNumber,
      registryAddress: source.network.registryAddress,
      resolvedContracts: {
        ...structuredClone(validPreflightReport.registrySnapshot.resolvedContracts),
        FdcHub: source.network.resolvedContracts.FdcHub,
        FdcRequestFeeConfigurations:
          source.network.resolvedContracts.FdcRequestFeeConfigurations,
        FdcVerification: source.network.resolvedContracts.FdcVerification,
        Relay: source.network.resolvedContracts.Relay,
      },
    },
    fee: {
      ...structuredClone(validPreflightReport.fee),
      quotedWei: accepted.payload.quotedFeeWei,
      capWei: source.manifest.submission.feeCapWei,
    },
  };
}

async function replayFiles(input: {
  bundle?: string | Uint8Array;
  report?: string | Uint8Array;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027b-worker-runtime-"));
  temporaryDirectories.push(directory);
  const bundlePath = join(directory, "bundle.json");
  const reportPath = join(directory, "preflight-report.json");
  const source = replaySource();
  const report = boundReport(source);
  const bundleCanonicalJson = canonicalSerializeProofBundle(source);
  const preflightReportCanonicalJson = canonicalSerializePreflightReport(report);
  await writeFile(bundlePath, input.bundle ?? bundleCanonicalJson);
  await writeFile(reportPath, input.report ?? preflightReportCanonicalJson);
  return {
    bundlePath,
    reportPath,
    source,
    report,
    bundleCanonicalJson,
    preflightReportCanonicalJson,
  };
}

async function expectConfigurationFailure(
  operation: () => unknown | Promise<unknown>,
  forbidden: readonly string[] = [],
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
  const exposed = `${JSON.stringify(thrown)}\n${String((thrown as Error)?.message)}`;
  for (const marker of forbidden) expect(exposed).not.toContain(marker);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Slice 027B worker runtime configuration authority", () => {
  it("parses one immutable typed configuration with fixed Coston2 authority and no raw key", async () => {
    const module = await runtimeModule();
    expect(module.parseWorkerRuntimeConfig).toBeTypeOf("function");
    const config = module.parseWorkerRuntimeConfig!(environment());

    expect(config).toMatchObject({
      chainId: 114,
      registryAddress: REGISTRY,
      verifierEndpoint: "https://fdc-verifiers-testnet.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
      daEndpoint: "https://ctn2-data-availability.flare.network",
      receiptPollTimeoutMs: 25_000,
      daTimeoutMs: 15_000,
      databasePoolSize: 4,
      maxAttempts: 8,
      leaseHeartbeatMs: 10_000,
      relayerPolicy: {
        globalFeeCapWei: 20_000_000_000_000_000n,
        balanceFloorWei: 1_000n,
        dailyProjectQuota: 4,
      },
      safeConsumerAddress: "0x5555555555555555555555555555555555555555",
    });
    expect(config.relayerAccount?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(JSON.stringify(config)).not.toContain(PRIVATE_KEY);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.relayerPolicy)).toBe(true);
  });

  it.each([
    ["database", { DATABASE_URL: "" }],
    ["verifier key", { PROOFLINE_VERIFIER_API_KEY: "" }],
    ["private key", { PROOFLINE_COSTON2_PRIVATE_KEY: "" }],
    ["deployment", { PROOFLINE_DEPLOYMENT_ID: "deployment_bad" }],
    ["tree", { PROOFLINE_RELEASE_TREE_SHA: "B".repeat(40) }],
    ["global cap", { PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "01" }],
    ["balance floor", { PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "-1" }],
    ["quota", { PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "0" }],
    ["zero safe consumer", {
      PROOFLINE_SAFE_CONSUMER_ADDRESS:
        "0x0000000000000000000000000000000000000000",
    }],
    ["relative bundle", { PROOFLINE_REPLAY_BUNDLE_PATH: "bundle.json" }],
    ["relative report", {
      PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH: "preflight-report.json",
    }],
  ])("rejects malformed required %s before authority", async (_label, override) => {
    const module = await runtimeModule();
    expect(module.parseWorkerRuntimeConfig).toBeTypeOf("function");
    await expectConfigurationFailure(
      () => module.parseWorkerRuntimeConfig!(environment(override)),
      Object.values(override),
    );
  });

  it.each([
    ["verifier HTTP", { PROOFLINE_VERIFIER_URL: "http://verifier.example" }],
    ["verifier path", { PROOFLINE_VERIFIER_URL: "https://verifier.example/api" }],
    ["RPC userinfo", { PROOFLINE_COSTON2_RPC_URL: "https://user@rpc.example/rpc" }],
    ["RPC query", { PROOFLINE_COSTON2_RPC_URL: "https://rpc.example/rpc?key=x" }],
    ["DA fragment", { PROOFLINE_COSTON2_DA_URL: "https://da.example/#private" }],
    ["DA port", { PROOFLINE_COSTON2_DA_URL: "https://da.example:8443" }],
  ])("rejects noncanonical optional endpoint: %s", async (_label, override) => {
    const module = await runtimeModule();
    expect(module.parseWorkerRuntimeConfig).toBeTypeOf("function");
    await expectConfigurationFailure(
      () => module.parseWorkerRuntimeConfig!(environment(override)),
      Object.values(override),
    );
  });

  it.each([
    ["receipt timeout", { PROOFLINE_RECEIPT_POLL_TIMEOUT_MS: "30001" }],
    ["DA timeout", { PROOFLINE_DA_TIMEOUT_MS: "0" }],
    ["pool size", { PROOFLINE_WORKER_DB_POOL_SIZE: "33" }],
    ["attempts", { PROOFLINE_WORKER_MAX_ATTEMPTS: "101" }],
    ["lease heartbeat low", { PROOFLINE_WORKER_LEASE_HEARTBEAT_MS: "999" }],
    ["lease heartbeat high", { PROOFLINE_WORKER_LEASE_HEARTBEAT_MS: "29001" }],
  ])("rejects out-of-range optional bound: %s", async (_label, override) => {
    const module = await runtimeModule();
    expect(module.parseWorkerRuntimeConfig).toBeTypeOf("function");
    await expectConfigurationFailure(
      () => module.parseWorkerRuntimeConfig!(environment(override)),
      Object.values(override),
    );
  });

  it("opens, validates and caches one exactly bound replay pair before authority", async () => {
    const fixture = await replayFiles();
    const module = await runtimeModule();
    expect(module.parseWorkerRuntimeConfig).toBeTypeOf("function");
    expect(module.loadWorkerReplayEvidence).toBeTypeOf("function");
    const config = module.parseWorkerRuntimeConfig!(environment({
      PROOFLINE_REPLAY_BUNDLE_PATH: fixture.bundlePath,
      PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH: fixture.reportPath,
    }));
    const evidence = await module.loadWorkerReplayEvidence!(config);

    expect(evidence).toEqual({
      bundleCanonicalJson: fixture.bundleCanonicalJson,
      bundleSha256: `sha256:${createHash("sha256")
        .update(fixture.bundleCanonicalJson)
        .digest("hex")}`,
      preflightReportCanonicalJson: fixture.preflightReportCanonicalJson,
      preflightReportSha256: `sha256:${createHash("sha256")
        .update(fixture.preflightReportCanonicalJson)
        .digest("hex")}`,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it.each([
    ["empty bundle", async () => replayFiles({ bundle: "" })],
    ["invalid bundle UTF-8", async () => replayFiles({ bundle: Uint8Array.of(0xff) })],
    ["bundle boundary plus one", async () =>
      replayFiles({ bundle: "x".repeat(2_200_001) })],
    ["report boundary plus one", async () =>
      replayFiles({ report: "x".repeat(65_537) })],
    ["noncanonical bundle", async () => {
      const fixture = await replayFiles();
      await writeFile(fixture.bundlePath, `${fixture.bundleCanonicalJson}\n`);
      return fixture;
    }],
    ["checksum mismatch", async () => {
      const fixture = await replayFiles();
      const changed = {
        ...JSON.parse(fixture.bundleCanonicalJson),
        checksum: `sha256:${"0".repeat(64)}`,
      };
      await writeFile(fixture.bundlePath, JSON.stringify(changed));
      return fixture;
    }],
    ["nonterminal bundle", async () => {
      const fixture = await replayFiles();
      const input = makeBundleInput();
      const source = createProofBundle({ ...input, events: input.events.slice(0, 2) });
      await writeFile(fixture.bundlePath, canonicalSerializeProofBundle(source));
      return fixture;
    }],
    ["mismatched report", async () => {
      const fixture = await replayFiles();
      const changed = { ...fixture.report, canonicalUrl: "https://api.example.com/other" };
      await writeFile(
        fixture.reportPath,
        canonicalSerializePreflightReport(changed),
      );
      return fixture;
    }],
  ])("rejects invalid replay evidence before Pool or network: %s", async (_label, makeFixture) => {
    const fixture = await makeFixture();
    const module = await runtimeModule();
    expect(module.parseWorkerRuntimeConfig).toBeTypeOf("function");
    expect(module.loadWorkerReplayEvidence).toBeTypeOf("function");
    const fetch = vi.spyOn(globalThis, "fetch");
    const config = module.parseWorkerRuntimeConfig!(environment({
      PROOFLINE_REPLAY_BUNDLE_PATH: fixture.bundlePath,
      PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH: fixture.reportPath,
    }));
    await expectConfigurationFailure(
      () => module.loadWorkerReplayEvidence!(config),
      [fixture.bundlePath, fixture.reportPath],
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects directories and symlinks with bounded non-following opens", async () => {
    const fixture = await replayFiles();
    const directory = join(dirname(fixture.bundlePath), "directory");
    await mkdir(directory);
    const link = join(dirname(fixture.reportPath), "bundle-link");
    await symlink(fixture.bundlePath, link);
    const module = await runtimeModule();
    expect(module.parseWorkerRuntimeConfig).toBeTypeOf("function");
    expect(module.loadWorkerReplayEvidence).toBeTypeOf("function");
    const missing = join(dirname(fixture.bundlePath), "missing-bundle.json");
    for (const bundlePath of [directory, link, missing]) {
      const config = module.parseWorkerRuntimeConfig!(environment({
        PROOFLINE_REPLAY_BUNDLE_PATH: bundlePath,
        PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH: fixture.reportPath,
      }));
      await expectConfigurationFailure(
        () => module.loadWorkerReplayEvidence!(config),
        [bundlePath],
      );
    }
  });

  it("confines environment and filesystem reads to pre-authority configuration loading", async () => {
    const [moduleSource, bootstrap, liveRuntime] = await Promise.all([
      readFile(new URL("../src/worker-runtime-configuration.ts", import.meta.url), "utf8")
        .catch(() => ""),
      readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/live-runtime.ts", import.meta.url), "utf8"),
    ]);
    expect(moduleSource).not.toBe("");
    expect(moduleSource).toMatch(/parseWorkerRuntimeConfig/);
    expect(moduleSource).toMatch(/loadWorkerReplayEvidence/);
    expect(moduleSource).toMatch(/O_RDONLY/);
    expect(moduleSource).toMatch(/O_NOFOLLOW/);
    expect(moduleSource).toMatch(/O_NONBLOCK/);

    const start = bootstrap.slice(bootstrap.indexOf("export async function startProductionWorker"));
    const parse = start.indexOf("parseWorkerRuntimeConfig");
    const load = start.indexOf("loadWorkerReplayEvidence");
    const pool = start.indexOf("new Pool");
    const schema = start.indexOf("verifyDeploymentSchema");
    const heartbeat = start.indexOf("heartbeatStore.start");
    expect(parse).toBeGreaterThanOrEqual(0);
    expect(load).toBeGreaterThan(parse);
    expect(pool).toBeGreaterThan(load);
    expect(schema).toBeGreaterThan(pool);
    expect(heartbeat).toBeGreaterThan(schema);

    const workerFactory = bootstrap.slice(
      bootstrap.indexOf("export function createProductionWorker"),
      bootstrap.indexOf("export async function runWorkerLoop"),
    );
    expect(workerFactory).not.toMatch(/Environment|required\(|readFile\(/);
    const portsFactory = liveRuntime.slice(
      liveRuntime.indexOf("export function createLiveCoston2PipelinePorts"),
    );
    expect(portsFactory).not.toMatch(/LiveEnvironment|required\(environment|readFile\(/);
  });
});
