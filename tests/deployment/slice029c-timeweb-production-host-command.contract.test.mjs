import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = resolve(root, "scripts/timeweb-production-host-command.mjs");
const source = await readFile(scriptPath, "utf8").catch(() => "");
const sha = (digit) => `sha256:${digit.repeat(64).slice(0, 64)}`;
const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
const encode = (value) => Buffer.from(canonicalJson(value), "utf8").toString("base64url");
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const command = (id, payload = {}) => encode({
  version: "1",
  kind: "timeweb-production-host-command",
  id,
  payload,
});

const CURRENT_ROOT = "/opt/orivra/current";
const SECRET_ROOT = "/opt/orivra/secrets";
const EVIDENCE_ROOT = "/opt/orivra/evidence";
const CANARY_STATE_ROOT = "/var/lib/orivra/production-canary";
const PROJECT = "proofline-production-primary";
const COMPOSE_FILES = [
  "/opt/orivra/current/compose.yaml",
  "/opt/orivra/current/deploy/compose.runtime.yaml",
  "/opt/orivra/current/deploy/compose.backup.yaml",
];
const REGISTRY_PATH = `${EVIDENCE_ROOT}/safe-consumer-registry.v1.json`;
const DEPLOYMENT_PATH = `${EVIDENCE_ROOT}/safe-consumer-deployment-evidence.v1.json`;
const WORKER_HANDOFF_PATH = "/opt/orivra/worker-evidence/safe-consumer-registry.v1.json";
const GHCR_TOKEN_PATH = `${SECRET_ROOT}/ghcr-pull-token`;
const PUBLIC_ORIGIN = "https://orivra.xyz";
const BROWSER_ACCEPTANCE_PATH = `${EVIDENCE_ROOT}/browser/hosted-browser-acceptance.v1.json`;
const BROWSER_ACCEPTANCE_SHA256_PATH = `${EVIDENCE_ROOT}/browser/hosted-browser-acceptance.v1.sha256`;
const BROWSER_ACCEPTANCE = Object.freeze({
  version: "1", kind: "hosted-browser-acceptance", status: "passed", publicOrigin: PUBLIC_ORIGIN,
  checks: {
    desktop: "passed", mobile: "passed", keyboard: "passed",
    axeSeriousCritical: 0, consoleErrors: 0, networkErrors: 0,
    reloadBackForward: "passed",
  },
});
const OPEN_METEO = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const ETH_USD = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const OPEN_METEO_RELAYER = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_USD_RELAYER = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const RUN_IDS = [
  "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5",
];
const images = [
  ["caddy", "ghcr.io/marshersusanin/orivra-caddy", "a"],
  ["web", "ghcr.io/marshersusanin/orivra-web", "b"],
  ["api", "ghcr.io/marshersusanin/orivra-api", "c"],
  ["worker", "ghcr.io/marshersusanin/orivra-worker", "d"],
  ["postgres-recovery", "ghcr.io/marshersusanin/orivra-postgres-recovery", "e"],
].map(([id, remoteRepository, digit]) => ({
  id,
  remoteRepository,
  remoteDigest: sha(digit),
  remoteReference: `${remoteRepository}@${sha(digit)}`,
}));
const imageEnvironment = {
  PROOFLINE_CADDY_IMAGE: images[0].remoteReference,
  PROOFLINE_WEB_IMAGE: images[1].remoteReference,
  PROOFLINE_API_IMAGE: images[2].remoteReference,
  PROOFLINE_WORKER_IMAGE: images[3].remoteReference,
  PROOFLINE_POSTGRES_IMAGE: images[4].remoteReference,
};
const publication = JSON.parse(await readFile(
  resolve(root, "tests/fixtures/slice029b-publication-evidence.v1.json"), "utf8",
));
const publicationBytes = Buffer.from(canonicalJson(publication), "utf8");
const objectStore = {
  version: "1", kind: "timeweb-s3-pilot-authority", provider: "timeweb-s3",
  endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet",
  pathStyle: true, authorityMode: "shared-pilot", credentialDelivery: "secret-files",
  qaProvider: "minio-only", swiftRuntime: false,
};
const target = {
  version: "2", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
  deploymentMode: "direct-pilot", deploymentId: "orivra-production-primary", composeProject: PROJECT,
  publicOrigin: PUBLIC_ORIGIN, dnsName: "orivra.xyz",
  sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("1") },
  ingress: [80, 443], objectStore,
};
const safeConsumers = {
  version: "1", kind: "safe-consumer-registry", chainId: 114,
  entries: [
    { templateId: "open-meteo-current-weather", revision: 1, manifestSha256: OPEN_METEO, consumerAddress: "0x1111111111111111111111111111111111111111" },
    { templateId: "eth-usd", revision: 1, manifestSha256: ETH_USD, consumerAddress: "0x2222222222222222222222222222222222222222" },
  ],
};
const safeConsumerDeployments = safeConsumers.entries.map((entry, index) => ({
  ...entry,
  contractName: index === 0 ? "OrivraOpenMeteoCurrentWeatherConsumer" : "OrivraEthUsdConsumer",
  compiledSourceSha256: sha(index === 0 ? "a" : "b"),
  bytecodeSha256: sha(index === 0 ? "c" : "d"),
  transactionHash: `0x${String(index + 3).repeat(64)}`,
  blockNumber: String(100 + index),
  runtimeCodeSha256: sha(index === 0 ? "e" : "f"),
}));
const safeConsumerDeploymentEvidence = {
  version: "1", kind: "safe-consumer-deployment-evidence", status: "passed", chainId: 114,
  compiler: { name: "solc", version: "0.8.36", importAuthority: "official-coston2-contract-registry" },
  relayer: {
    address: "0x3333333333333333333333333333333333333333",
    balanceBeforeWei: "1000000000000000000",
    requiredBalanceWei: "4000000000000000",
  },
  registrySha256: digest(Buffer.from(canonicalJson(safeConsumers), "utf8")),
  deployments: safeConsumerDeployments,
  completedAt: "2026-08-12T03:00:00Z",
};
const safeConsumerPair = {
  deploymentEvidence: {
    type: "regular", mode: 0o400,
    bytes: Buffer.from(canonicalJson(safeConsumerDeploymentEvidence), "utf8"),
  },
  registry: {
    type: "regular", mode: 0o400,
    bytes: Buffer.from(canonicalJson(safeConsumers), "utf8"),
  },
};
const productionEvidence = {
  version: "2", kind: "digitalocean-production-deployment-evidence",
  status: "passed", verification: "verified", productionClaim: true,
  producer: publication.producer,
  publicationEvidenceSha256: digest(publicationBytes),
  frozenReleaseManifestSha256: publication.frozenRelease.frozenReleaseManifestSha256,
  promotionAuthorizationSha256: sha("6"), preflightEvidenceSha256: sha("7"), target,
  run: { runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", completedAt: "2026-08-12T03:00:01Z" },
  pullCredential: { registry: "ghcr.io", access: "read-only" },
  images,
  topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
  database: { migrationManifestSha256: sha("8"), targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" } },
  objectStore, safeConsumers,
  checks: {
    exactDigestPull: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
    timewebPitr: { status: "passed", restoreEvidenceSha256: sha("9"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
    liveCoston2: { status: "persisted", runIds: RUN_IDS, manifests: [OPEN_METEO_RELAYER, ETH_USD_RELAYER] },
  },
  cutover: { status: "passed", publicOrigin: PUBLIC_ORIGIN, activatedAt: "2026-08-12T03:00:00Z", browserAcceptanceSha256: sha("b") },
};
const canaryCheckpoint = {
  version: "2", kind: "production-canary-checkpoint", id: "post-cutover-15m",
  dueAt: "2026-08-12T03:15:00Z", observedAt: "2026-08-12T03:15:00Z", status: "passed",
  checks: {
    healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
    objectStore: { status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
    diskPressure: { status: "passed" }, hostedBrowserSmoke: { status: "passed" },
    liveCoston2: { status: "persisted", runIds: RUN_IDS },
    clock: { status: "synchronized", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 0 },
  },
};

const ALLOWED_IDS = [
  "configure-firewall",
  "pull-exact-digests",
  "inspect-local-digests",
  "postgres",
  "db-role-bootstrap",
  "migrator",
  "start-api",
  "safe-consumer-deployer",
  "write-safe-consumer-registry",
  "create-timeweb-backup",
  "seal-backup-evidence",
  "observe-wal-freshness",
  "timeweb-pitr",
  "authorize-retention",
  "replay-bootstrap",
  "seal-replay-pair",
  "deep-validate-replay-pair",
  "start-worker",
  "start-web",
  "start-caddy-candidate",
  "readyz-real-heartbeat",
  "timeweb-pitr-production",
  "persisted-live-coston2",
  "activate-caddy",
  "append-browser-acceptance",
  "rollback-caddy",
  "append-production-evidence",
  "append-canary-checkpoint",
  "canary-observe",
];

async function feature() {
  return import(`../../scripts/timeweb-production-host-command.mjs?contract=${Date.now()}-${Math.random()}`).catch(() => ({}));
}

async function runNode(arguments_) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

test("decodes only bounded canonical base64url command JSON into private frozen authority", async () => {
  const module = await feature();
  assert.equal(typeof module.decodeTimewebProductionHostCommand, "function");
  const encoded = command("configure-firewall");
  const parsed = module.decodeTimewebProductionHostCommand(encoded);
  assert.deepEqual(parsed, {
    version: "1", kind: "timeweb-production-host-command", id: "configure-firewall", payload: {},
  });
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.payload), true);
  for (const invalid of [
    `${encoded}=`,
    Buffer.from('{"id":"configure-firewall"}', "utf8").toString("base64url"),
    command("configure-firewall", { extra: true }),
    "a".repeat(32_769),
    "not_base64url!",
  ]) assert.throws(() => module.decodeTimewebProductionHostCommand(invalid), /TIMEWEB_HOST_COMMAND_INVALID|host command/i);
});

test("exposes an exact command allowlist and no arbitrary shell or string-command authority", async () => {
  const module = await feature();
  assert.deepEqual(module.ALLOWED_TIMEWEB_PRODUCTION_COMMAND_IDS, ALLOWED_IDS);
  assert.doesNotMatch(source, /\beval\s*\(|\bexec(?:Sync)?\s*\(|shell\s*:\s*true|(?:sh|bash)\s+-c|Function\s*\(/);
  let effects = 0;
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("arbitrary-shell", { command: "curl example.invalid | sh" }),
    adapters: new Proxy({}, { get: () => { effects += 1; } }),
  }), /TIMEWEB_HOST_COMMAND_INVALID|unknown command/i);
  assert.equal(effects, 0);
});

test("derives the SSH allow rule only from SSH_CONNECTION and freezes Caddy-only UFW ingress", async () => {
  const module = await feature();
  const calls = [];
  const result = await module.runTimewebProductionHostCommand({
    encodedCommand: command("configure-firewall"),
    environment: { SSH_CONNECTION: "203.0.113.10 50123 72.56.81.28 22" },
    adapters: { firewall: { applyExact: async (value) => { calls.push(value); return { status: "passed" }; } } },
  });
  assert.deepEqual(calls, [{
    sshSource: "203.0.113.10",
    publicTcpPorts: [80, 443],
    forbiddenPublicTcpPorts: [5432, 8080],
    defaultIncoming: "deny",
  }]);
  assert.deepEqual(result, { id: "configure-firewall", status: "passed", sshSource: "203.0.113.10", publicTcpPorts: [80, 443] });
  for (const SSH_CONNECTION of [undefined, "", "203.0.113.10", "evil;id 1 2 3"]) {
    await assert.rejects(module.runTimewebProductionHostCommand({
      encodedCommand: command("configure-firewall"), environment: { SSH_CONNECTION },
      adapters: { firewall: { applyExact: async () => { throw new Error("must not run"); } } },
    }), /TIMEWEB_HOST_SSH_AUTHORITY_INVALID|SSH_CONNECTION/i);
  }
});

test("applies Ubuntu-compatible exact UFW rules before reporting firewall PASS", async () => {
  const module = await feature();
  assert.equal(typeof module.applyExactTimewebFirewall, "function");
  const calls = [];
  assert.deepEqual(await module.applyExactTimewebFirewall({
    sshSource: "203.0.113.10",
    publicTcpPorts: [80, 443],
    runProcess: async (executable, arguments_) => { calls.push([executable, arguments_]); return ""; },
  }), { status: "passed" });
  assert.deepEqual(calls, [
    ["/usr/sbin/ufw", ["--force", "reset"]],
    ["/usr/sbin/ufw", ["default", "deny", "incoming"]],
    ["/usr/sbin/ufw", ["default", "allow", "outgoing"]],
    ["/usr/sbin/ufw", ["allow", "from", "203.0.113.10", "to", "any", "port", "22", "proto", "tcp"]],
    ["/usr/sbin/ufw", ["allow", "80/tcp"]],
    ["/usr/sbin/ufw", ["allow", "443/tcp"]],
    ["/usr/sbin/ufw", ["--force", "enable"]],
  ]);
  assert.equal(calls.some(([, arguments_]) => arguments_.join(" ") === "allow 80 tcp"), false);
  assert.equal(calls.some(([, arguments_]) => arguments_.join(" ") === "allow 443 tcp"), false);
});

test("executes every nested current-symlink Node entrypoint with preserved main authority", async (t) => {
  const module = await feature();
  assert.equal(typeof module.createPreservedCurrentNodeArguments, "function");
  const temporary = await mkdtemp(`${tmpdir()}/orivra-nested-main-`);
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const current = resolve(temporary, "current");
  await symlink(root, current, "dir");
  const cases = [
    ["scripts/timeweb-production-live-runs.mjs", ["--invalid"]],
    ["scripts/timeweb-production-pitr.mjs", ["--invalid"]],
    ["scripts/timeweb-production-canary-observation.mjs", ["--invalid"]],
  ];
  for (const [relativePath, arguments_] of cases) {
    const productionPath = `/opt/orivra/current/${relativePath}`;
    assert.deepEqual(module.createPreservedCurrentNodeArguments(productionPath, arguments_), [
      "--preserve-symlinks-main", productionPath, ...arguments_,
    ]);
    const symlinkPath = resolve(current, relativePath);
    const result = await runNode(["--preserve-symlinks-main", symlinkPath, ...arguments_]);
    assert.notEqual(result.code, 0, relativePath);
    assert.equal(result.stdout, "", relativePath);
    assert.notEqual(result.stderr, "", relativePath);
  }
  for (const path of [
    resolve(root, "scripts/timeweb-production-live-runs.mjs"),
    "/opt/orivra/other/scripts/timeweb-production-pitr.mjs",
  ]) assert.throws(() => module.createPreservedCurrentNodeArguments(path, []), /TIMEWEB_HOST_NODE_ENTRY_INVALID|Node entry/i);
});

test("opens one read-only GHCR session, pulls exact five digests and independently inspects the same refs", async () => {
  const module = await feature();
  const events = [];
  const result = await module.runTimewebProductionHostCommand({
    encodedCommand: command("pull-exact-digests", { images }),
    adapters: { registry: {
      openReadOnly: async (input) => { events.push(["open", input]); return {
        pull: async (references) => events.push(["pull", references]),
        inspect: async (references) => { events.push(["inspect", references]); return images.map(({ id, remoteDigest }) => ({ id, remoteDigest })); },
        close: async () => events.push(["close"]),
      }; },
    } },
  });
  assert.deepEqual(events, [
    ["open", { registry: "ghcr.io", tokenFile: GHCR_TOKEN_PATH, access: "read-only" }],
    ["pull", images.map(({ remoteReference }) => remoteReference)],
    ["inspect", images.map(({ remoteReference }) => remoteReference)],
    ["close"],
  ]);
  assert.deepEqual(result, { id: "pull-exact-digests", status: "passed", images: images.map(({ id, remoteDigest }) => ({ id, remoteDigest })) });
  for (const invalid of [
    images.map((image, index) => index ? image : { ...image, remoteReference: `${image.remoteRepository}:latest` }),
    images.map((image, index) => index ? image : { ...image, remoteRepository: "ghcr.io/evil/other", remoteReference: `ghcr.io/evil/other@${image.remoteDigest}` }),
    [...images].reverse(),
  ]) await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("pull-exact-digests", { images: invalid }),
    adapters: { registry: { openReadOnly: async () => { throw new Error("must not run"); } } },
  }), /TIMEWEB_HOST_IMAGE_AUTHORITY_INVALID|image authority/i);
});

test("maps fixed database-first Compose phases without public Caddy cutover or caller-selected services", async () => {
  const module = await feature();
  const phases = [
    ["postgres", ["postgres"], { id: "postgres", status: "passed" }],
    ["db-role-bootstrap", ["db-role-bootstrap"], { id: "db-role-bootstrap", status: "passed" }],
    ["migrator", ["migrator"], {
      id: "migrator", status: "passed", migrationManifestSha256: sha("8"),
      targetVersion: 10, schemaVersion: 10,
    }],
    ["start-api", ["api"], { id: "start-api", status: "passed" }],
    ["start-worker", ["worker"], { id: "start-worker", status: "passed" }],
    ["start-web", ["web"], { id: "start-web", status: "passed" }],
    ["start-caddy-candidate", ["caddy"], { id: "start-caddy-candidate", status: "passed" }],
  ];
  const calls = [];
  for (const [id, services, expected] of phases) {
    const result = await module.runTimewebProductionHostCommand({
      encodedCommand: command(id, { images }),
      adapters: { compose: { runExactPhase: async (value) => {
        calls.push(value);
        return id === "migrator"
          ? { status: "passed", migrationManifestSha256: sha("8"), targetVersion: 10, schemaVersion: 10 }
          : { status: "passed" };
      } } },
    });
    assert.deepEqual(result, expected);
    assert.deepEqual(calls.at(-1), {
      project: PROJECT, currentRoot: CURRENT_ROOT, composeFiles: COMPOSE_FILES,
      phase: id, services, imageEnvironment, pullPolicy: "never",
      publicIngress: id === "start-caddy-candidate" ? "candidate-disabled" : "unchanged",
    });
  }
  assert.equal(calls.some(({ publicIngress }) => publicIngress === "active"), false);
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("migrator", { images }),
    adapters: { compose: { runExactPhase: async () => ({ status: "passed" }) } },
  }), /TIMEWEB_HOST_OBSERVATION_INVALID|migration/i);
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("start-api", { images, services: ["api", "worker"] }),
    adapters: { compose: { runExactPhase: async () => { throw new Error("must not run"); } } },
  }), /TIMEWEB_HOST_COMMAND_INVALID|services/i);
});

test("owns the fixed replay-bootstrap staging directory across setup, Compose, seal and cleanup", async () => {
  const module = await feature();
  assert.equal(typeof module.runOwnedReplayBootstrapStageLifecycle, "function");
  const stageRoot = "/opt/orivra/replay-bootstrap-stage";
  const events = [];
  const result = await module.runOwnedReplayBootstrapStageLifecycle({
    inspectStage: async (path) => { events.push(["inspect", path]); return "absent"; },
    createStage: async (input) => { events.push(["create", input]); return { status: "created" }; },
    runCompose: async (input) => { events.push(["compose", input]); return { status: "passed" }; },
    sealPair: async (input) => { events.push(["seal", input]); return { status: "passed" }; },
    deepValidatePair: async () => { events.push(["deep-validate"]); return { status: "passed" }; },
    removeOwnedStage: async (input) => { events.push(["remove", input]); return { status: "passed" }; },
  });
  assert.deepEqual(result, { status: "passed" });
  assert.deepEqual(events, [
    ["inspect", stageRoot],
    ["create", { path: stageRoot, type: "directory", mode: 0o700, uid: 1000, gid: 1000, noFollow: true, noReplace: true }],
    ["compose", { stageRoot, createHostPath: false }],
    ["seal", { stageRoot }],
    ["deep-validate"],
    ["remove", { path: stageRoot, noFollow: true, ownedOnly: true }],
  ]);

  for (const failingPhase of ["create", "compose", "seal", "deep-validate"]) {
    const failureEvents = [];
    await assert.rejects(module.runOwnedReplayBootstrapStageLifecycle({
      inspectStage: async () => "absent",
      createStage: async () => {
        failureEvents.push("create");
        if (failingPhase === "create") throw new Error("create failed");
        return { status: "created" };
      },
      runCompose: async () => { failureEvents.push("compose"); if (failingPhase === "compose") throw new Error("compose failed"); return { status: "passed" }; },
      sealPair: async () => { failureEvents.push("seal"); if (failingPhase === "seal") throw new Error("seal failed"); return { status: "passed" }; },
      deepValidatePair: async () => { failureEvents.push("deep-validate"); if (failingPhase === "deep-validate") throw new Error("deep validation failed"); return { status: "passed" }; },
      removeOwnedStage: async ({ path, noFollow, ownedOnly }) => { failureEvents.push(["remove", path, noFollow, ownedOnly]); return { status: "passed" }; },
    }), /TIMEWEB_HOST_REPLAY_STAGE_INVALID|failed/);
    if (failingPhase === "create") assert.equal(failureEvents.some(Array.isArray), false);
    else assert.deepEqual(failureEvents.at(-1), ["remove", stageRoot, true, true]);
  }

  for (const existing of [
    { type: "directory", mode: 0o700, uid: 1000, gid: 1000, empty: true },
    { type: "symlink", target: "/tmp/caller-owned" },
    { type: "directory", mode: 0o700, uid: 0, gid: 0, empty: false },
  ]) {
    let effects = 0;
    await assert.rejects(module.runOwnedReplayBootstrapStageLifecycle({
      inspectStage: async () => existing,
      createStage: async () => { effects += 1; },
      runCompose: async () => { effects += 1; },
      sealPair: async () => { effects += 1; },
      removeOwnedStage: async () => { effects += 1; },
    }), /TIMEWEB_HOST_REPLAY_STAGE_INVALID/);
    assert.equal(effects, 0);
  }
});

test("binds the owned replay stage into the real Compose environment without ambient or caller fallback", async () => {
  const module = await feature();
  assert.equal(typeof module.bindOwnedReplayBootstrapComposeEnvironment, "function");
  assert.equal(typeof module.bindFixedReplayBootstrapComposeInterpolationEnvironment, "function");
  const stageRoot = "/opt/orivra/replay-bootstrap-stage";
  const baseEnvironment = { PROOFLINE_PRODUCTION_RUN_ID: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4", PATH: "/usr/bin:/bin" };
  const interpolation = module.bindFixedReplayBootstrapComposeInterpolationEnvironment(baseEnvironment);
  assert.deepEqual(interpolation, {
    ...baseEnvironment,
    PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: stageRoot,
  });
  assert.equal(Object.isFrozen(interpolation), true);
  assert.throws(() => module.bindFixedReplayBootstrapComposeInterpolationEnvironment({
    ...baseEnvironment,
    PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: stageRoot,
  }), /TIMEWEB_HOST_REPLAY_STAGE_INVALID/);
  const bound = module.bindOwnedReplayBootstrapComposeEnvironment({
    runtimeEnvironment: baseEnvironment,
    stageRoot,
    createHostPath: false,
  });
  assert.deepEqual(bound, {
    ...baseEnvironment,
    PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: stageRoot,
  });
  assert.equal(Object.isFrozen(bound), true);
  for (const invalid of [
    { runtimeEnvironment: { ...baseEnvironment, PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: stageRoot }, stageRoot, createHostPath: false },
    { runtimeEnvironment: { ...baseEnvironment, PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: "/tmp/caller" }, stageRoot, createHostPath: false },
    { runtimeEnvironment: baseEnvironment, stageRoot: "/tmp/caller", createHostPath: false },
    { runtimeEnvironment: baseEnvironment, stageRoot, createHostPath: true },
  ]) assert.throws(() => module.bindOwnedReplayBootstrapComposeEnvironment(invalid), /TIMEWEB_HOST_REPLAY_STAGE_INVALID/);

  const [hostSource, composeSource, operatorSource, backupEvidenceSource, dailyBackupSource, productionWrapperSource] = await Promise.all([
    readFile(scriptPath, "utf8"),
    readFile(resolve(root, "deploy/compose.runtime.yaml"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-pilot-adapters.mjs"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-backup-evidence.mjs"), "utf8"),
    readFile(resolve(root, "scripts/run-timeweb-daily-backup.mjs"), "utf8"),
    readFile(resolve(root, "scripts/compose-production.mjs"), "utf8"),
  ]);
  const composeAdapter = hostSource.slice(hostSource.indexOf("compose: { async runExactPhase"), hostSource.indexOf("evidence: {"));
  assert.match(composeAdapter, /bindOwnedReplayBootstrapComposeEnvironment\s*\(/);
  assert.match(composeAdapter, /bindFixedReplayBootstrapComposeInterpolationEnvironment\s*\(/);
  assert.match(composeAdapter, /stageRoot/);
  assert.match(composeSource, /source:\s*\$\{PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT:\?PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT is required\}/);
  assert.doesNotMatch(composeSource, /PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT:-/);
  assert.doesNotMatch(operatorSource, /void\s+PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT/);
  assert.match(backupEvidenceSource, /bindFixedReplayBootstrapComposeInterpolationEnvironment\s*\(environment\)/);
  assert.match(dailyBackupSource, /bindFixedReplayBootstrapComposeInterpolationEnvironment\s*\(/);
  assert.match(productionWrapperSource, /bindFixedReplayBootstrapComposeInterpolationEnvironment\s*\(environment\)/);
  assert.match(productionWrapperSource, /env:\s*composeEnvironment/);
  assert.doesNotMatch(productionWrapperSource, /env:\s*environment/);

  const productionFullModelCallers = [
    "scripts/compose-production.mjs",
    "scripts/run-timeweb-daily-backup.mjs",
    "scripts/timeweb-production-backup-evidence.mjs",
    "scripts/timeweb-production-canary-observation.mjs",
    "scripts/timeweb-production-host-command.mjs",
    "scripts/timeweb-production-live-runs.mjs",
    "scripts/timeweb-production-pilot-backup.mjs",
    "scripts/timeweb-production-pitr.mjs",
  ];
  for (const path of productionFullModelCallers) {
    const source = await readFile(resolve(root, path), "utf8");
    assert.match(source, /bind(?:Fixed|Owned)ReplayBootstrapCompose(?:Interpolation)?Environment\s*\(/, path);
  }
});

test("strictly parses and cross-binds the canonical safe-consumer pair into the direct-runtime result envelope", async () => {
  const module = await feature();
  const states = [
    { deploymentEvidence: "absent", registry: "absent" },
    structuredClone(safeConsumerPair),
  ];
  const calls = [];
  const result = await module.runTimewebProductionHostCommand({
    encodedCommand: command("safe-consumer-deployer", { images }),
    adapters: {
      evidence: { inspectSafeConsumerPair: async (input) => { calls.push(["inspect", input]); return states.shift(); } },
      compose: { runExactPhase: async (input) => { calls.push(["compose", input]); return { status: "passed" }; } },
    },
  });
  assert.deepEqual(calls.map(([id]) => id), ["inspect", "compose", "inspect"]);
  assert.deepEqual(calls[0][1], { evidenceRoot: EVIDENCE_ROOT, deploymentEvidencePath: DEPLOYMENT_PATH, registryPath: REGISTRY_PATH });
  assert.deepEqual(result, {
    id: "safe-consumer-deployer", status: "passed",
    registry: safeConsumers, deployments: safeConsumerDeployments,
  });
  const seals = [];
  assert.deepEqual(await module.runTimewebProductionHostCommand({
    encodedCommand: command("write-safe-consumer-registry"),
    adapters: { evidence: {
      inspectSafeConsumerPair: async () => structuredClone(safeConsumerPair),
      sealCanonicalPair: async (input) => { seals.push(input); return { status: "passed" }; },
    } },
  }), {
    id: "write-safe-consumer-registry", status: "passed", path: REGISTRY_PATH,
    mode: 0o400, noReplace: true,
    registrySha256: digest(Buffer.from(canonicalJson(safeConsumers), "utf8")),
  });
  assert.deepEqual(seals, [{
    evidenceRoot: EVIDENCE_ROOT,
    deploymentEvidencePath: DEPLOYMENT_PATH,
    registryPath: REGISTRY_PATH,
    canonicalOwner: { uid: 0, gid: 0 },
    directoryMode: 0o700,
    fileMode: 0o400,
    noFollow: true,
    noReplace: true,
    workerHandoff: {
      path: WORKER_HANDOFF_PATH,
      owner: { uid: 1000, gid: 1000 },
      mode: 0o400,
      registrySha256: digest(Buffer.from(canonicalJson(safeConsumers), "utf8")),
    },
  }]);
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("write-safe-consumer-registry"),
    adapters: { evidence: {
      inspectSafeConsumerPair: async () => structuredClone(safeConsumerPair),
      sealCanonicalPair: async () => { throw new Error("worker handoff seal failed"); },
    } },
  }), /TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID|worker handoff seal failed/);
  for (const invalidStates of [
    [{ deploymentEvidence: "absent", registry: { type: "regular", mode: 0o400 } }],
    [{ deploymentEvidence: "absent", registry: "absent" }, { ...structuredClone(safeConsumerPair), deploymentEvidence: { ...safeConsumerPair.deploymentEvidence, mode: 0o600 } }],
    [{ deploymentEvidence: "absent", registry: "absent" }, { ...structuredClone(safeConsumerPair), registry: { ...safeConsumerPair.registry, type: "symlink" } }],
    [{ deploymentEvidence: "absent", registry: "absent" }, { ...structuredClone(safeConsumerPair), registry: { ...safeConsumerPair.registry, bytes: Buffer.from(JSON.stringify(safeConsumers, null, 2)) } }],
    [{ deploymentEvidence: "absent", registry: "absent" }, { ...structuredClone(safeConsumerPair), deploymentEvidence: { ...safeConsumerPair.deploymentEvidence, bytes: Buffer.from(canonicalJson({ ...safeConsumerDeploymentEvidence, registrySha256: sha("9") })) } }],
  ]) await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("safe-consumer-deployer", { images }),
    adapters: {
      evidence: { inspectSafeConsumerPair: async () => invalidStates.shift() },
      compose: { runExactPhase: async () => ({ status: "passed" }) },
    },
  }), /TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID|safe-consumer evidence/i);
});

test("seals one UID-1000 run-scoped staging pair into the root-private canonical evidence root", async () => {
  const module = await feature();
  const directory = await mkdtemp(`${tmpdir()}/orivra-029c-staging-seal-`);
  const canonicalRoot = resolve(directory, "canonical-evidence");
  const stagingRoot = resolve(directory, "deployer-staging");
  const runId = "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4";
  const runStage = resolve(stagingRoot, runId);
  const stagedDeployment = resolve(runStage, "safe-consumer-deployment-evidence.v1.json");
  const stagedRegistry = resolve(runStage, "safe-consumer-registry.v1.json");
  try {
    await mkdir(canonicalRoot, { mode: 0o700 });
    await mkdir(runStage, { recursive: true, mode: 0o700 });
    await writeFile(stagedDeployment, safeConsumerPair.deploymentEvidence.bytes, { mode: 0o400 });
    await writeFile(stagedRegistry, safeConsumerPair.registry.bytes, { mode: 0o400 });
    await chmod(stagedDeployment, 0o400);
    await chmod(stagedRegistry, 0o400);
    await chmod(canonicalRoot, 0o500);
    await assert.rejects(writeFile(resolve(canonicalRoot, "uid-1000-must-not-write"), "forbidden"), /EACCES|EPERM/);

    assert.equal(typeof module.sealSafeConsumerEvidenceFromStaging, "function");
    const stagingOwner = await lstat(runStage);
    const result = await module.sealSafeConsumerEvidenceFromStaging({
      stagingRoot,
      canonicalRoot,
      runId,
      expectedStagingOwner: { uid: stagingOwner.uid, gid: stagingOwner.gid },
      canonicalOwner: { uid: 0, gid: 0 },
      workerHandoffPath: WORKER_HANDOFF_PATH,
      maximumBytes: 1024 * 1024,
    });
    const canonicalDeployment = resolve(canonicalRoot, "safe-consumer-deployment-evidence.v1.json");
    const canonicalRegistry = resolve(canonicalRoot, "safe-consumer-registry.v1.json");
    assert.deepEqual(result, {
      status: "passed", runId, noReplace: true,
      deploymentEvidencePath: canonicalDeployment,
      registryPath: canonicalRegistry,
      registrySha256: digest(safeConsumerPair.registry.bytes),
      workerHandoffPath: WORKER_HANDOFF_PATH,
    });
    assert.equal((await lstat(canonicalRoot)).mode & 0o777, 0o700);
    assert.equal((await lstat(canonicalDeployment)).mode & 0o777, 0o400);
    assert.equal((await lstat(canonicalRegistry)).mode & 0o777, 0o400);
    assert.equal(await lstat(runStage).then(() => false, () => true), true);

    const compose = await readFile(resolve(root, "deploy/compose.runtime.yaml"), "utf8");
    assert.match(compose, /safe-consumer-deployer:[\s\S]*user:\s*["']1000:1000["']/);
    assert.match(compose, /PROOFLINE_SAFE_CONSUMER_DEPLOYER_STAGE_DIR/);
    assert.match(compose, /\/run\/proofline\/safe-consumer-stage/);
    assert.doesNotMatch(compose.match(/safe-consumer-deployer:[\s\S]*?(?=\n  [a-z][a-z0-9-]+:|\nnetworks:)/)?.[0] ?? "", /\/opt\/orivra\/evidence/);
  } finally {
    await chmod(canonicalRoot, 0o700).catch(() => undefined);
    await chmod(stagingRoot, 0o700).catch(() => undefined);
    await chmod(runStage, 0o700).catch(() => undefined);
    await chmod(stagedDeployment, 0o600).catch(() => undefined);
    await chmod(stagedRegistry, 0o600).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("reads the safe-consumer authority from bounded no-follow mode-0400 descriptors", async () => {
  const module = await feature();
  assert.equal(typeof module.readCanonicalSafeConsumerEvidencePair, "function");
  const directory = await mkdtemp(`${tmpdir()}/orivra-029c-host-pair-`);
  const deploymentEvidencePath = resolve(directory, "safe-consumer-deployment-evidence.v1.json");
  const registryPath = resolve(directory, "safe-consumer-registry.v1.json");
  try {
    await writeFile(deploymentEvidencePath, safeConsumerPair.deploymentEvidence.bytes, { mode: 0o400 });
    await writeFile(registryPath, safeConsumerPair.registry.bytes, { mode: 0o400 });
    await chmod(deploymentEvidencePath, 0o400);
    await chmod(registryPath, 0o400);
    assert.deepEqual(await module.readCanonicalSafeConsumerEvidencePair({
      deploymentEvidencePath, registryPath, maximumBytes: 1024 * 1024,
    }), { registry: safeConsumers, deployments: safeConsumerDeployments });
    await assert.rejects(module.readCanonicalSafeConsumerEvidencePair({
      deploymentEvidencePath, registryPath, maximumBytes: 32,
    }), /TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID|safe-consumer evidence/i);
    await chmod(registryPath, 0o600);
    await assert.rejects(module.readCanonicalSafeConsumerEvidencePair({
      deploymentEvidencePath, registryPath, maximumBytes: 1024 * 1024,
    }), /TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID|safe-consumer evidence/i);
    await rm(registryPath);
    await symlink(deploymentEvidencePath, registryPath);
    await assert.rejects(module.readCanonicalSafeConsumerEvidencePair({
      deploymentEvidencePath, registryPath, maximumBytes: 1024 * 1024,
    }), /TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID|safe-consumer evidence/i);
  } finally {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts readiness only with current real heartbeat and exactly two persisted live Coston2 runs", async () => {
  const module = await feature();
  const ready = await module.runTimewebProductionHostCommand({
    encodedCommand: command("readyz-real-heartbeat"),
    adapters: { observe: { readyzHeartbeat: async () => ({ status: "passed", readyz: { status: "passed" }, workerHeartbeat: { status: "current", deploymentId: "orivra-production-primary" } }) } },
  });
  assert.equal(ready.workerHeartbeat.status, "current");
  const live = await module.runTimewebProductionHostCommand({
    encodedCommand: command("persisted-live-coston2"),
    adapters: { observe: { persistedLiveCoston2: async () => ({ status: "passed", chainId: 114, runIds: RUN_IDS, manifests: [OPEN_METEO_RELAYER, ETH_USD_RELAYER], persisted: true }) } },
  });
  assert.deepEqual(live.runIds, RUN_IDS);
  for (const observation of [
    { status: "passed", readyz: { status: "passed" }, workerHeartbeat: { status: "stale" } },
    { status: "passed", chainId: 114, runIds: RUN_IDS.slice(0, 1), manifests: [OPEN_METEO_RELAYER], persisted: true },
  ]) await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command(observation.workerHeartbeat ? "readyz-real-heartbeat" : "persisted-live-coston2"),
    adapters: { observe: { readyzHeartbeat: async () => observation, persistedLiveCoston2: async () => observation } },
  }), /TIMEWEB_HOST_OBSERVATION_INVALID|observation/i);
});

test("runs Timeweb base backup plus PITR only into a fresh volume and returns strict restore evidence", async () => {
  const module = await feature();
  const calls = [];
  const observation = {
    status: "passed", provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru",
    region: "ru-1", bucket: "orivra-backet", pathStyle: true,
    baseBackupId: "base_20260812T030000Z", restoreVolumeId: "proofline-pitr-prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    volumeWasFresh: true, restoreEvidenceSha256: sha("8"), backupAgeSeconds: 60,
    archivePendingAgeSeconds: 30,
  };
  const result = await module.runTimewebProductionHostCommand({
    encodedCommand: command("timeweb-pitr-production", { runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4" }),
    adapters: { pitr: { baseBackupAndRestore: async (input) => { calls.push(input); return observation; } } },
  });
  assert.deepEqual(calls, [{
    endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet",
    pathStyle: true, restoreVolumePolicy: "fresh-only", productionVolumeReuse: false,
  }]);
  assert.deepEqual(result, { id: "timeweb-pitr-production", ...observation });
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("timeweb-pitr-production", { runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4" }),
    adapters: { pitr: { baseBackupAndRestore: async () => ({ ...observation, volumeWasFresh: false }) } },
  }), /TIMEWEB_HOST_PITR_INVALID|PITR observation/i);
});

test("keeps candidate Caddy private until one explicit activation and exact external HTTPS observation", async () => {
  const module = await feature();
  let activations = 0;
  await module.runTimewebProductionHostCommand({
    encodedCommand: command("start-caddy-candidate", { images }),
    adapters: { compose: { runExactPhase: async ({ publicIngress }) => { assert.equal(publicIngress, "candidate-disabled"); return { status: "passed" }; } } },
  });
  assert.equal(activations, 0);
  const result = await module.runTimewebProductionHostCommand({
    encodedCommand: command("activate-caddy", { publicOrigin: PUBLIC_ORIGIN }),
    adapters: { caddy: {
      inspectCandidate: async () => ({ status: "staged", publicIngress: false }),
      activate: async ({ publicOrigin }) => { activations += 1; return { status: "passed", publicOrigin, activatedAt: "2026-08-12T03:00:00Z" }; },
      observeExternalHttps: async ({ publicOrigin }) => ({ status: "passed", publicOrigin, observedAt: "2026-08-12T03:00:01Z" }),
    } },
  });
  assert.equal(activations, 1);
  assert.deepEqual(result.cutover, { status: "passed", publicOrigin: PUBLIC_ORIGIN, activatedAt: "2026-08-12T03:00:00Z" });
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("activate-caddy", { publicOrigin: PUBLIC_ORIGIN }),
    adapters: { caddy: { inspectCandidate: async () => ({ status: "missing" }), activate: async () => { throw new Error("must not run"); } } },
  }), /TIMEWEB_HOST_CADDY_CANDIDATE_INVALID|Caddy candidate/i);
});

test("rolls an exact active Caddy state back through one fixed adapter call with no caller arguments", async () => {
  const module = await feature();
  const calls = [];
  const state = {
    candidate: { status: "staged", publicIngress: false },
    active: { status: "active", publicOrigin: PUBLIC_ORIGIN },
  };
  const result = await module.runTimewebProductionHostCommand({
    encodedCommand: command("rollback-caddy"),
    adapters: { caddy: {
      inspectState: async () => state,
      rollbackExact: async (input) => { calls.push(input); return { status: "passed", publicOrigin: PUBLIC_ORIGIN }; },
    } },
  });
  assert.deepEqual(calls, [{ publicOrigin: PUBLIC_ORIGIN, candidateStatus: "staged", activeStatus: "active" }]);
  assert.deepEqual(result, { id: "rollback-caddy", status: "passed", publicOrigin: PUBLIC_ORIGIN });
  for (const invalid of [
    { candidate: { status: "missing" }, active: state.active },
    { candidate: state.candidate, active: { status: "inactive", publicOrigin: PUBLIC_ORIGIN } },
    { candidate: state.candidate, active: { status: "active", publicOrigin: "https://evil.invalid" } },
  ]) {
    let effects = 0;
    await assert.rejects(module.runTimewebProductionHostCommand({
      encodedCommand: command("rollback-caddy"),
      adapters: { caddy: { inspectState: async () => invalid, rollbackExact: async () => { effects += 1; } } },
    }), /TIMEWEB_HOST_CADDY_ROLLBACK_INVALID|Caddy rollback/i);
    assert.equal(effects, 0);
  }
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("rollback-caddy", { publicOrigin: "https://evil.invalid" }),
    adapters: { caddy: { inspectState: async () => state, rollbackExact: async () => { throw new Error("must not run"); } } },
  }), /TIMEWEB_HOST_COMMAND_INVALID|payload/i);
});

test("appends exact canonical browser acceptance to one fixed private pair with no path authority", async () => {
  const module = await feature();
  const canonicalBytes = Buffer.from(canonicalJson(BROWSER_ACCEPTANCE), "utf8");
  const sha256 = digest(canonicalBytes);
  const calls = [];
  const result = await module.runTimewebProductionHostCommand({
    encodedCommand: command("append-browser-acceptance", {
      canonicalBytesBase64url: canonicalBytes.toString("base64url"), sha256,
    }),
    adapters: { evidence: { appendCanonicalPairNoReplace: async (entry) => {
      calls.push(entry); return { status: "passed", sha256: entry.sha256 };
    } } },
  });
  assert.deepEqual(calls, [{
    path: BROWSER_ACCEPTANCE_PATH,
    checksumPath: BROWSER_ACCEPTANCE_SHA256_PATH,
    bytes: canonicalBytes,
    sha256,
    mode: 0o400,
    noReplace: true,
  }]);
  assert.deepEqual(result, { id: "append-browser-acceptance", status: "passed", sha256 });

  let effects = 0;
  for (const invalid of [
    { value: { ...BROWSER_ACCEPTANCE, publicOrigin: "https://evil.invalid" } },
    { value: BROWSER_ACCEPTANCE, sha256: sha("0") },
    { value: BROWSER_ACCEPTANCE, pretty: true },
    { value: BROWSER_ACCEPTANCE, extraPayload: { path: "/tmp/browser.json" } },
  ]) {
    const bytes = Buffer.from(invalid.pretty ? JSON.stringify(invalid.value, null, 2) : canonicalJson(invalid.value), "utf8");
    await assert.rejects(module.runTimewebProductionHostCommand({
      encodedCommand: command("append-browser-acceptance", {
        canonicalBytesBase64url: bytes.toString("base64url"),
        sha256: invalid.sha256 ?? digest(bytes),
        ...(invalid.extraPayload ?? {}),
      }),
      adapters: { evidence: { appendCanonicalPairNoReplace: async () => { effects += 1; } } },
    }), /TIMEWEB_HOST_(?:COMMAND|EVIDENCE)_INVALID|canonical|browser/i);
  }
  assert.equal(effects, 0);
});

test("appends canonical evidence/checkpoints only to fixed mode-0400 no-replace paths", async () => {
  const module = await feature();
  const calls = [];
  for (const [id, value, expectedPath, expectedChecksumPath] of [
    ["append-production-evidence", productionEvidence, `${EVIDENCE_ROOT}/production-deployment-evidence.v2.json`, `${EVIDENCE_ROOT}/production-deployment-evidence.v2.sha256`],
    ["append-canary-checkpoint", canaryCheckpoint, `${CANARY_STATE_ROOT}/checkpoints/01-post-cutover-15m.json`, undefined],
  ]) {
    const canonicalBytes = Buffer.from(canonicalJson(value), "utf8");
    const sha256 = digest(canonicalBytes);
    const result = await module.runTimewebProductionHostCommand({
      encodedCommand: command(id, { canonicalBytesBase64url: canonicalBytes.toString("base64url"), sha256 }),
      adapters: { evidence: {
        appendNoReplace: async (entry) => { calls.push(entry); return { status: "passed", sha256: entry.sha256 }; },
        appendCanonicalPairNoReplace: async (entry) => { calls.push(entry); return { status: "passed", sha256: entry.sha256 }; },
      } },
    });
    assert.deepEqual(calls.at(-1), {
      path: expectedPath,
      ...(expectedChecksumPath ? { checksumPath: expectedChecksumPath } : {}),
      bytes: canonicalBytes,
      sha256,
      mode: 0o400,
      noReplace: true,
    });
    assert.equal(result.status, "passed");
  }
  const noncanonical = Buffer.from(JSON.stringify(productionEvidence, null, 2), "utf8");
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("append-production-evidence", { canonicalBytesBase64url: noncanonical.toString("base64url"), sha256: digest(noncanonical) }),
    adapters: { evidence: { appendNoReplace: async () => { throw new Error("must not run"); } } },
  }), /TIMEWEB_HOST_EVIDENCE_INVALID|canonical evidence/i);
});

test("validates typed canary observation and emits only bounded redacted CLI failure", async () => {
  const module = await feature();
  assert.deepEqual(await module.runTimewebProductionHostCommand({
    encodedCommand: command("canary-observe", { id: canaryCheckpoint.id, dueAt: canaryCheckpoint.dueAt }),
    adapters: { canary: { observe: async () => canaryCheckpoint } },
  }), canaryCheckpoint);
  await assert.rejects(module.runTimewebProductionHostCommand({
    encodedCommand: command("canary-observe", { id: canaryCheckpoint.id, dueAt: canaryCheckpoint.dueAt }),
    adapters: { canary: { observe: async () => ({ ...canaryCheckpoint, checks: { ...canaryCheckpoint.checks, workerHeartbeat: { status: "stale" } } }) } },
  }), /TIMEWEB_HOST_CANARY_INVALID|canary observation/i);

  assert.equal(typeof module.runTimewebProductionHostCommandCli, "function");
  const stderr = [];
  const stdout = [];
  const encodedCommand = command("configure-firewall");
  await assert.rejects(module.runTimewebProductionHostCommandCli({
    argv: ["--command", encodedCommand],
    environment: { SSH_CONNECTION: "203.0.113.10 50123 72.56.81.28 22", GH_TOKEN: "sentinel-secret" },
    stdout: { write: (value) => stdout.push(String(value)) },
    stderr: { write: (value) => stderr.push(String(value)) },
    timeoutMs: 25_000,
    runCommand: async () => { throw new Error("sentinel-secret from /opt/orivra/secrets/ghcr-pull-token"); },
  }), /TIMEWEB_PRODUCTION_HOST_COMMAND_FAILED/);
  assert.deepEqual(stdout, []);
  assert.equal(stderr.join(""), `${canonicalJson({ status: "failed", code: "TIMEWEB_PRODUCTION_HOST_COMMAND_FAILED" })}\n`);
  assert.doesNotMatch(stderr.join(""), /sentinel-secret|ghcr-pull-token|eyJ|private|token/i);
  assert.match(source, /25_000|25000/);
});
