import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOST_RUNNER = "/opt/orivra/current/scripts/timeweb-production-host-command.mjs";
const RUN_ID = "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4";
const RUN_IDS = [
  "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5",
];
const OPEN_METEO = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_USD = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const sha = (digit) => `sha256:${digit.repeat(64)}`;
const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;

const images = [
  ["caddy", "ghcr.io/marshersusanin/orivra-caddy", "6"],
  ["web", "ghcr.io/marshersusanin/orivra-web", "7"],
  ["api", "ghcr.io/marshersusanin/orivra-api", "8"],
  ["worker", "ghcr.io/marshersusanin/orivra-worker", "9"],
  ["postgres-recovery", "ghcr.io/marshersusanin/orivra-postgres-recovery", "a"],
].map(([id, remoteRepository, digit]) => ({
  id, remoteRepository, remoteDigest: sha(digit),
  remoteReference: `${remoteRepository}@${sha(digit)}`,
}));

const expectedMappings = [
  ["pull-exact-digests", "pull-exact-digests", { images }],
  ["inspect-local-digests", "inspect-local-digests", { images }],
  ["start-postgres", "postgres", { images }],
  ["db-role-bootstrap", "db-role-bootstrap", { images }],
  ["migrator", "migrator", { images }],
  ["start-api", "start-api", { images }],
  ["safe-consumer-deployer", "safe-consumer-deployer", { images }],
  ["write-safe-consumer-registry", "write-safe-consumer-registry", {}],
  ["start-worker", "start-worker", { images }],
  ["start-web", "start-web", { images }],
  ["start-caddy-candidate", "start-caddy-candidate", { images }],
  ["readyz-real-heartbeat", "readyz-real-heartbeat", {}],
  ["timeweb-pitr-production", "timeweb-pitr-production", { runId: RUN_ID }],
  ["persisted-live-coston2", "persisted-live-coston2", {}],
];

async function load(path) {
  return import(`${path}?contract=${Date.now()}-${Math.random()}`).catch(() => ({}));
}

test("maps every internal pilot command to one canonical --command host envelope and keeps the install marker effect-free", async () => {
  const module = await load("../../scripts/timeweb-production-pilot-adapters.mjs");
  assert.equal(typeof module.createTimewebProductionHostCommandAdapter, "function");
  const invocations = [];
  const adapter = module.createTimewebProductionHostCommandAdapter({
    images, runId: RUN_ID,
    invoke: async (invocation) => {
      invocations.push(invocation);
      assert.equal(invocation.executable, "/usr/bin/node");
      assert.equal(invocation.arguments.length, 3);
      assert.deepEqual(invocation.arguments.slice(0, 2), [HOST_RUNNER, "--command"]);
      const encoded = invocation.arguments[2];
      assert.match(encoded, /^[A-Za-z0-9_-]+$/);
      const text = Buffer.from(encoded, "base64url").toString("utf8");
      const envelope = JSON.parse(text);
      assert.equal(text, canonicalJson(envelope));
      assert.deepEqual(Object.keys(envelope).sort(), ["id", "kind", "payload", "version"]);
      assert.equal(envelope.version, "1");
      assert.equal(envelope.kind, "timeweb-production-host-command");
      return { id: envelope.id, status: "passed" };
    },
  });
  assert.deepEqual(await adapter.run({
    id: "install-read-only-pull-credential", environment: "production",
    composeProject: "proofline-production-primary",
  }), { status: "passed", access: "read-only", hostEffect: false });
  assert.equal(invocations.length, 0);
  for (const [internalId, hostId, payload] of expectedMappings) {
    await adapter.run({ id: internalId, environment: "production", composeProject: "proofline-production-primary" });
    const encoded = invocations.at(-1).arguments[2];
    assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), {
      version: "1", kind: "timeweb-production-host-command", id: hostId, payload,
    });
  }
  assert.equal(invocations.length, expectedMappings.length);
  await assert.rejects(adapter.run({ id: "arbitrary", command: "id" }), /PRODUCTION_HOST_COMMAND|invalid/i);
});

test("normalizes the real nested Caddy host result while retaining post-effect rollback authority", async () => {
  const module = await load("../../scripts/timeweb-production-pilot-adapters.mjs");
  assert.equal(typeof module.normalizeTimewebCaddyActivationResult, "function");
  const hostResult = {
    id: "activate-caddy",
    status: "passed",
    cutover: {
      status: "passed",
      publicOrigin: "https://orivra.xyz",
      activatedAt: "2026-08-13T03:00:00Z",
    },
    external: {
      status: "passed",
      publicOrigin: "https://orivra.xyz",
      observedAt: "2026-08-13T03:00:01Z",
    },
  };
  assert.deepEqual(module.normalizeTimewebCaddyActivationResult(hostResult, {
    expectedPublicOrigin: "https://orivra.xyz",
  }), {
    status: "passed",
    publicOrigin: "https://orivra.xyz",
    activatedAt: "2026-08-13T03:00:00Z",
    effectApplied: true,
  });
  for (const invalid of [
    { ...hostResult, cutover: { ...hostResult.cutover, publicOrigin: "https://evil.invalid" } },
    { ...hostResult, cutover: { ...hostResult.cutover, activatedAt: "not-a-time" } },
    { ...hostResult, external: { ...hostResult.external, status: "failed" } },
  ]) {
    await assert.rejects(async () => module.normalizeTimewebCaddyActivationResult(invalid, {
      expectedPublicOrigin: "https://orivra.xyz",
    }), (error) => error?.cutoverApplied === true);
  }
  const source = await readFile(resolve(root, "scripts/timeweb-production-pilot-adapters.mjs"), "utf8");
  assert.match(source, /activateCaddy[\s\S]*normalizeTimewebCaddyActivationResult/);
});

test("exposes a concrete fresh-volume Timeweb base-backup and PITR entrypoint", async () => {
  const module = await load("../../scripts/timeweb-production-pitr.mjs");
  assert.equal(typeof module.runTimewebProductionPitr, "function");
  assert.equal(typeof module.runTimewebProductionPitrCli, "function");
  const calls = [];
  const result = await module.runTimewebProductionPitr({
    runId: RUN_ID,
    adapters: {
      createBaseBackup: async (input) => {
        calls.push(["backup", input]);
        return { status: "passed", baseBackupId: "base_20260812T030000Z", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 };
      },
      restoreFreshVolume: async (input) => {
        calls.push(["restore", input]);
        return { status: "passed", restoreVolumeId: `proofline-pitr-${RUN_ID}`, volumeWasFresh: true, restoreEvidenceSha256: sha("b") };
      },
    },
  });
  assert.deepEqual(calls.map(([phase]) => phase), ["backup", "restore"]);
  assert.deepEqual(calls[0][1], {
    provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru", region: "ru-1",
    bucket: "orivra-backet", pathStyle: true, runId: RUN_ID,
  });
  assert.equal(calls[1][1].productionVolumeReuse, false);
  assert.equal(calls[1][1].restoreVolumePolicy, "fresh-only");
  assert.deepEqual(result, {
    status: "passed", provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru",
    region: "ru-1", bucket: "orivra-backet", pathStyle: true,
    baseBackupId: "base_20260812T030000Z", restoreVolumeId: `proofline-pitr-${RUN_ID}`,
    volumeWasFresh: true, restoreEvidenceSha256: sha("b"), backupAgeSeconds: 60,
    archivePendingAgeSeconds: 30,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|token|private|access.?key/i);
});

test("exposes a concrete persisted two-run Coston2 observation entrypoint", async () => {
  const module = await load("../../scripts/timeweb-production-live-runs.mjs");
  assert.equal(typeof module.readTimewebProductionLiveRuns, "function");
  assert.equal(typeof module.runTimewebProductionLiveRunsCli, "function");
  const calls = [];
  const rows = [OPEN_METEO, ETH_USD].map((manifestSha256, index) => ({
    runId: RUN_IDS[index], manifestSha256, chainId: 114, stage: "completed", persisted: true,
  }));
  const result = await module.readTimewebProductionLiveRuns({
    queryPersistedRuns: async (input) => { calls.push(input); return rows; },
  });
  assert.deepEqual(calls, [{ chainId: 114, manifests: [OPEN_METEO, ETH_USD], requiredStage: "completed" }]);
  assert.deepEqual(result, {
    status: "passed", chainId: 114, runIds: RUN_IDS,
    manifests: [OPEN_METEO, ETH_USD], persisted: true,
  });
  await assert.rejects(module.readTimewebProductionLiveRuns({
    queryPersistedRuns: async () => rows.slice(0, 1),
  }), /TIMEWEB_PRODUCTION_LIVE_RUNS_INVALID|live runs/i);
  assert.doesNotMatch(JSON.stringify(result), /database.?url|password|secret|token|private/i);
});

test("exposes a concrete typed production canary observation entrypoint", async () => {
  const module = await load("../../scripts/timeweb-production-canary-observation.mjs");
  assert.equal(typeof module.observeTimewebProductionCanary, "function");
  assert.equal(typeof module.runTimewebProductionCanaryObservationCli, "function");
  const dueAt = "2026-08-12T04:00:00Z";
  const checks = {
    healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
    objectStore: { status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
    diskPressure: { status: "passed" }, hostedBrowserSmoke: { status: "passed" },
    liveCoston2: { status: "persisted", runIds: RUN_IDS },
    clock: { status: "synchronized", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 0 },
  };
  const result = await module.observeTimewebProductionCanary({
    id: "post-cutover-1h", dueAt,
    clock: { now: () => dueAt },
    observeChecks: async (input) => {
      assert.deepEqual(input, { id: "post-cutover-1h", dueAt, source: "production-host" });
      return checks;
    },
  });
  assert.deepEqual(result, {
    version: "2", kind: "production-canary-checkpoint", id: "post-cutover-1h",
    dueAt, observedAt: dueAt, status: "passed", checks,
  });
  await assert.rejects(module.observeTimewebProductionCanary({
    id: "post-cutover-1h", dueAt, clock: { now: () => dueAt },
    observeChecks: async () => ({ status: "passed" }),
  }), /TIMEWEB_PRODUCTION_CANARY_INVALID|canary/i);
  assert.doesNotMatch(JSON.stringify(result), /secret|token|private|credential/i);
});

test("the host default adapters invoke all three checked-in entrypoints rather than missing or caller-selected scripts", async () => {
  const [host, pitr, live, canary] = await Promise.all([
    readFile(resolve(root, "scripts/timeweb-production-host-command.mjs"), "utf8").catch(() => ""),
    readFile(resolve(root, "scripts/timeweb-production-pitr.mjs"), "utf8").catch(() => ""),
    readFile(resolve(root, "scripts/timeweb-production-live-runs.mjs"), "utf8").catch(() => ""),
    readFile(resolve(root, "scripts/timeweb-production-canary-observation.mjs"), "utf8").catch(() => ""),
  ]);
  for (const name of [
    "timeweb-production-pitr.mjs", "timeweb-production-live-runs.mjs",
    "timeweb-production-canary-observation.mjs",
  ]) assert.match(host, new RegExp(`/scripts/${name.replaceAll(".", "\\.")}`));
  assert.match(pitr, /runTimewebProductionPitrCli/);
  assert.match(live, /runTimewebProductionLiveRunsCli/);
  assert.match(canary, /runTimewebProductionCanaryObservationCli/);
  assert.doesNotMatch(`${pitr}\n${live}\n${canary}`, /console\.log\([^)]*(?:secret|token|private|credential)/i);
});
