import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OPEN_METEO = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_USD = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const MANIFESTS = [OPEN_METEO, ETH_USD];
const RUN_IDS = [
  "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5",
];
const PRODUCTION_RUN_ID = "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4";
const PUBLIC_ORIGIN = "https://orivra.xyz";
const PROJECT = "proofline-production-primary";
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;

async function moduleOrEmpty(path) {
  return import(path).catch(() => ({}));
}

test("the production live default executes one worker-owned API persistence gate for exactly two manifests", async () => {
  const [hostModule, workerModule, packageJson, dockerfile] = await Promise.all([
    moduleOrEmpty("../../scripts/timeweb-production-live-runs.mjs"),
    moduleOrEmpty("../../apps/worker/src/production-live-gate-runtime.mjs"),
    readFile(resolve(root, "apps/worker/package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "docker/Dockerfile"), "utf8"),
  ]);
  assert.equal(typeof hostModule.createDefaultTimewebProductionLiveRunsAdapter, "function");
  assert.equal(typeof workerModule.runProductionPersistedLiveGate, "function");

  const workerCalls = [];
  const projectToken = "opaque-project-token-never-evidence";
  const workerResult = await workerModule.runProductionPersistedLiveGate({
    productionRunId: PRODUCTION_RUN_ID,
    manifestSha256s: MANIFESTS,
    chainId: 114,
    signer: {
      address: "0x3333333333333333333333333333333333333333",
      signSiweMessage: async (message) => {
        workerCalls.push(["sign", message]);
        return "0x" + "9".repeat(130);
      },
    },
    api: {
      requestSiweChallenge: async (input) => {
        workerCalls.push(["challenge", input]);
        return { challengeId: "siwe_01K2Q4P6R8T0V2X4Z6B8D0F2H4", message: "orivra.xyz wants you to sign in with your Ethereum account" };
      },
      verifySiweSession: async (input) => {
        workerCalls.push(["verify", input]);
        return { sessionId: "session_01K2Q4P6R8T0V2X4Z6B8D0F2H4" };
      },
      createProject: async (input) => {
        workerCalls.push(["project", { ...input, projectToken: undefined }]);
        return { projectId: "project_01K2Q4P6R8T0V2X4Z6B8D0F2H4", projectToken };
      },
      submitPersistedRun: async (input) => {
        workerCalls.push(["submit", { ...input, projectToken: "redacted" }]);
        return { runId: RUN_IDS[MANIFESTS.indexOf(input.manifestSha256)] };
      },
      readPersistedRun: async ({ runId }) => {
        workerCalls.push(["read", runId]);
        return { runId, stage: "completed", manifestSha256: MANIFESTS[RUN_IDS.indexOf(runId)], persisted: true };
      },
    },
  });
  assert.deepEqual(workerCalls.map(([id]) => id), [
    "challenge", "sign", "verify", "project", "submit", "read", "submit", "read",
  ]);
  assert.deepEqual(workerResult, {
    status: "passed", chainId: 114, runIds: RUN_IDS, manifests: MANIFESTS, persisted: true,
  });
  assert.doesNotMatch(canonicalJson(workerResult), /opaque-project-token|signature|private|secret/i);

  const commands = [];
  const defaultAdapter = hostModule.createDefaultTimewebProductionLiveRunsAdapter({
    runCommand: async (command) => {
      commands.push(command);
      return { status: 0, stdout: `${canonicalJson(workerResult)}\n`, stderr: "" };
    },
  });
  assert.deepEqual(await defaultAdapter({ productionRunId: PRODUCTION_RUN_ID }), workerResult);
  assert.deepEqual(commands, [{
    file: "docker",
    args: [
      "compose", "--project-name", PROJECT,
      "--file", "/opt/orivra/current/compose.yaml",
      "--file", "/opt/orivra/current/deploy/compose.runtime.yaml",
      "exec", "-T", "worker", "node",
      "/app/apps/worker/dist/production-live-gate.js", "--run-id", PRODUCTION_RUN_ID,
    ],
    environment: { PATH: "/usr/bin:/bin" },
    timeoutMs: 1_800_000,
  }]);
  assert.doesNotMatch(canonicalJson(commands), /projectToken|privateKey|verifierKey|signature/i);
  assert.match(packageJson.scripts?.["build:production-live-gate"] ?? "",
    /^esbuild src\/production-live-gate-entry\.ts\b[\s\S]*--platform=node\b[\s\S]*--target=node22\b[\s\S]*--outfile=dist\/production-live-gate\.js$/);
  assert.doesNotMatch(packageJson.scripts?.["build:production-live-gate"] ?? "", /NODE_ENV|test-adapter/i);
  assert.match(dockerfile, /COPY scripts\/production-relayer-manifest-authority\.mjs \.\/scripts\/production-relayer-manifest-authority\.mjs/);
  assert.match(dockerfile, /apps\/worker\/dist\/production-live-gate\.js/);
  const workerSource = await readFile(resolve(root, "apps/worker/src/production-live-gate-runtime.mjs"), "utf8").catch(() => "");
  assert.doesNotMatch(workerSource, /live-runtime|new Pool|DATABASE_URL|privateKey\s*:/);
});

test("the Timeweb PITR default restores one selected encrypted backup into a fresh scoped volume and always cleans it", async () => {
  const module = await moduleOrEmpty("../../scripts/timeweb-production-pitr.mjs");
  assert.equal(typeof module.runDefaultTimewebProductionPitr, "function");
  const calls = [];
  const phaseResult = (input) => {
    if (input.phase === "create-base-backup") return { status: "passed", backupId: "base_20260812T030000Z" };
    if (input.phase === "switch-wal-after-backup") return {
      status: "passed", switchedWalSegment: "00000001000000000000000B",
    };
    if (input.phase === "observe-switched-wal-archived") return {
      status: "passed", switchedWalSegment: "00000001000000000000000B",
      archivedAt: "2026-08-12T03:00:30Z", archivePendingAgeSeconds: 30,
      source: "postgres-archive-status",
    };
    if (input.phase === "select-backup") return {
      status: "passed", backupId: "base_20260812T030000Z", encrypted: true,
      backupCompletedAt: "2026-08-12T03:00:00Z", lastArchivedAt: "2026-08-12T03:00:30Z",
      systemIdentifier: "7532076200787175519", timeline: 1,
    };
    if (input.phase === "create-fresh-volume") return { status: "passed", volumeId: `proofline-pitr-${PRODUCTION_RUN_ID}`, wasAbsent: true };
    if (input.phase === "restore-selected-backup") return { status: "passed", backupId: "base_20260812T030000Z", volumeId: `proofline-pitr-${PRODUCTION_RUN_ID}` };
    if (input.phase === "verify-restored-database") return { status: "passed", restoreEvidenceSha256: sha256("restore-evidence"), schemaVersion: 10 };
    if (input.phase === "remove-fresh-volume") return { status: "passed", removed: true };
    throw new Error("unexpected phase");
  };
  const runner = async (input) => { calls.push(input); return phaseResult(input); };
  assert.deepEqual(await module.runDefaultTimewebProductionPitr({
    productionRunId: PRODUCTION_RUN_ID,
    runner,
    clock: { now: () => "2026-08-12T03:01:00Z" },
  }), {
    status: "passed", provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru",
    region: "ru-1", bucket: "orivra-backet", pathStyle: true,
    baseBackupId: "base_20260812T030000Z", restoreVolumeId: `proofline-pitr-${PRODUCTION_RUN_ID}`,
    volumeWasFresh: true, restoreEvidenceSha256: sha256("restore-evidence"),
    backupAgeSeconds: 60, archivePendingAgeSeconds: 30,
  });
  assert.deepEqual(calls.map(({ phase }) => phase), [
    "create-base-backup", "switch-wal-after-backup", "observe-switched-wal-archived",
    "select-backup", "create-fresh-volume", "restore-selected-backup",
    "verify-restored-database", "remove-fresh-volume",
  ]);
  for (const archivedObservation of [
    { status: "passed", switchedWalSegment: "00000001000000000000000B", archivePendingAgeSeconds: 61, source: "postgres-archive-status" },
    { status: "passed", switchedWalSegment: "00000001000000000000000B", archivePendingAgeSeconds: 0, source: "synthetic" },
    undefined,
  ]) {
    await assert.rejects(module.runDefaultTimewebProductionPitr({
      productionRunId: PRODUCTION_RUN_ID,
      runner: async (input) => input.phase === "observe-switched-wal-archived"
        ? archivedObservation
        : phaseResult(input),
      clock: { now: () => "2026-08-12T03:01:00Z" },
    }), /TIMEWEB_PRODUCTION_PITR_FAILED|archive freshness|archive observation/i);
  }
  calls.length = 0;
  await assert.rejects(module.runDefaultTimewebProductionPitr({
    productionRunId: PRODUCTION_RUN_ID,
    runner: async (input) => {
      calls.push(input);
      if (input.phase === "verify-restored-database") throw new Error("restore verification failed");
      return phaseResult(input);
    },
    clock: { now: () => "2026-08-12T03:01:00Z" },
  }), /TIMEWEB_PRODUCTION_PITR_FAILED|restore verification failed/);
  assert.equal(calls.at(-1).phase, "remove-fresh-volume");
  const recoveryCompose = await readFile(resolve(root, "deploy/compose.production-recovery.yaml"), "utf8").catch(() => "");
  assert.match(recoveryCompose, /pitr-restore:/);
  assert.match(recoveryCompose, /profiles:\s*\[["']production-recovery["']\]/);
  const pitrSource = await readFile(resolve(root, "scripts/timeweb-production-pitr.mjs"), "utf8");
  assert.doesNotMatch(pitrSource, /PROOFLINE_RECOVERY_TARGET_TIMELINE:\s*["']latest["']/);
  assert.doesNotMatch(pitrSource, /\],\s*1024\s*\*\s*1024,\s*environment\)\)\.trim\(\)/);
  assert.match(pitrSource, /switchProductionWal\(environment\)[\s\S]*observeProductionWalArchived\(switched, environment\)/);
  assert.doesNotMatch(recoveryCompose, /ports:|docker\.sock|MINIO|localhost:9000/i);
});

test("the canary default derives every PASS field from real due host observations", async () => {
  const module = await moduleOrEmpty("../../scripts/timeweb-production-canary-observation.mjs");
  assert.equal(typeof module.observeTimewebProductionCanary, "function");
  const calls = [];
  const observation = await module.observeTimewebProductionCanary({
    id: "post-cutover-15m",
    dueAt: "2026-08-12T03:15:00Z",
    publicOrigin: PUBLIC_ORIGIN,
    clock: {
      readSynchronizedHostTime: async () => ({ now: "2026-08-12T03:15:01Z", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 1 }),
    },
    adapters: {
      externalHttps: async (input) => { calls.push(["external", input]); return { status: "passed", rootHtml: true, sameOriginApi: true }; },
      internalHealth: async () => { calls.push(["internal"]); return { healthz: { status: "passed" }, readyz: { status: "passed", schemaVersion: 10 }, workerHeartbeat: { status: "current" } }; },
      diskPressure: async () => { calls.push(["disk"]); return { status: "passed" }; },
      timewebBackup: async () => { calls.push(["timeweb"]); return { status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 }; },
      persistedLiveRuns: async () => { calls.push(["live"]); return { status: "persisted", runIds: RUN_IDS, manifests: MANIFESTS }; },
      hostedBrowserAcceptance: async () => { calls.push(["browser"]); return {
        status: "passed", publicOrigin: PUBLIC_ORIGIN,
        artifactSha256: sha256(Buffer.from("canonical-hosted-browser-acceptance", "utf8")),
      }; },
    },
  });
  assert.deepEqual(calls.map(([id]) => id), ["external", "internal", "disk", "timeweb", "live", "browser"]);
  assert.deepEqual(observation, {
    version: "2", kind: "production-canary-checkpoint", id: "post-cutover-15m",
    dueAt: "2026-08-12T03:15:00Z", observedAt: "2026-08-12T03:15:01Z", status: "passed",
    checks: {
      healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
      objectStore: { status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
      diskPressure: { status: "passed" }, hostedBrowserSmoke: { status: "passed" },
      liveCoston2: { status: "persisted", runIds: RUN_IDS },
      clock: { status: "synchronized", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 1 },
    },
  });
  await assert.rejects(module.observeTimewebProductionCanary({
    id: "post-cutover-15m",
    dueAt: "2026-08-12T03:15:00Z",
    publicOrigin: PUBLIC_ORIGIN,
    clock: {
      readSynchronizedHostTime: async () => ({ now: "2026-08-12T03:15:01Z", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 1 }),
    },
    adapters: {
      externalHttps: async () => ({ status: "passed", rootHtml: true, sameOriginApi: true }),
      internalHealth: async () => ({ healthz: { status: "passed" }, readyz: { status: "passed", schemaVersion: 10 }, workerHeartbeat: { status: "current" } }),
      diskPressure: async () => ({ status: "passed" }),
      timewebBackup: async () => ({ status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 61 }),
      persistedLiveRuns: async () => ({ status: "persisted", runIds: RUN_IDS, manifests: MANIFESTS }),
      hostedBrowserAcceptance: async () => ({ status: "passed", publicOrigin: PUBLIC_ORIGIN, artifactSha256: sha256(Buffer.from("canonical-hosted-browser-acceptance", "utf8")) }),
    },
  }), /TIMEWEB_PRODUCTION_CANARY_INVALID|archive freshness/i);
  await assert.rejects(module.observeTimewebProductionCanary({
    id: "post-cutover-15m", dueAt: "2026-08-12T03:15:00Z", publicOrigin: PUBLIC_ORIGIN,
    clock: { readSynchronizedHostTime: async () => ({ now: "2026-08-12T03:15:01Z", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 1 }) },
    adapters: {
      externalHttps: async () => ({ status: "passed", rootHtml: true, sameOriginApi: true }),
      internalHealth: async () => ({ healthz: { status: "passed" }, readyz: { status: "passed", schemaVersion: 10 }, workerHeartbeat: { status: "current" } }),
      diskPressure: async () => ({ status: "passed" }),
      timewebBackup: async () => ({ status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 }),
      persistedLiveRuns: async () => ({ status: "persisted", runIds: RUN_IDS, manifests: MANIFESTS }),
      hostedBrowserAcceptance: async () => ({ status: "passed", publicOrigin: "https://evil.invalid", artifactSha256: "sha256:" + "0".repeat(64) }),
    },
  }), /TIMEWEB_PRODUCTION_CANARY_INVALID|browser acceptance/i);
  let effects = 0;
  await assert.rejects(module.observeTimewebProductionCanary({
    id: "post-cutover-15m", dueAt: "2026-08-12T03:15:00Z", publicOrigin: PUBLIC_ORIGIN,
    clock: { readSynchronizedHostTime: async () => ({ now: "2026-08-12T03:14:59Z", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 0 }) },
    adapters: new Proxy({}, { get: () => async () => { effects += 1; } }),
  }), /TIMEWEB_PRODUCTION_CANARY_NOT_DUE|host clock/i);
  assert.equal(effects, 0);
});

test("the cutover observation consumes exact pre-deployment live runs without reading deployment evidence", async () => {
  const module = await moduleOrEmpty("../../scripts/timeweb-production-canary-observation.mjs");
  const browserAcceptance = {
    status: "passed", publicOrigin: PUBLIC_ORIGIN,
    artifactSha256: sha256(Buffer.from("canonical-hosted-browser-acceptance", "utf8")),
  };
  const forbiddenReads = [];
  const observation = await module.observeTimewebProductionCanary({
    id: "cutover", dueAt: "2026-08-12T03:00:00Z", publicOrigin: PUBLIC_ORIGIN,
    persistedLiveRuns: { status: "persisted", runIds: RUN_IDS, manifests: MANIFESTS },
    browserAcceptance,
    clock: { readSynchronizedHostTime: async () => ({ now: "2026-08-12T03:00:01Z", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 1 }) },
    adapters: {
      externalHttps: async () => ({ status: "passed", rootHtml: true, sameOriginApi: true }),
      internalHealth: async () => ({ healthz: { status: "passed" }, readyz: { status: "passed", schemaVersion: 10 }, workerHeartbeat: { status: "current" } }),
      diskPressure: async () => ({ status: "passed" }),
      timewebBackup: async () => ({ status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 }),
      persistedLiveRuns: async () => { forbiddenReads.push("deployment-evidence"); throw new Error("circular read"); },
      hostedBrowserAcceptance: async () => { forbiddenReads.push("browser-reread"); throw new Error("must use supplied artifact"); },
    },
  });
  assert.equal(observation.id, "cutover");
  assert.deepEqual(observation.checks.liveCoston2.runIds, RUN_IDS);
  assert.deepEqual(forbiddenReads, []);
  await assert.rejects(module.observeTimewebProductionCanary({
    id: "cutover", dueAt: "2026-08-12T03:00:00Z", publicOrigin: PUBLIC_ORIGIN,
    persistedLiveRuns: { status: "persisted", runIds: RUN_IDS.slice(0, 1), manifests: MANIFESTS.slice(0, 1) },
    browserAcceptance,
    clock: { readSynchronizedHostTime: async () => ({ now: "2026-08-12T03:00:01Z", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 1 }) },
    adapters: {},
  }), /TIMEWEB_PRODUCTION_CANARY_INVALID|live runs/i);
});
