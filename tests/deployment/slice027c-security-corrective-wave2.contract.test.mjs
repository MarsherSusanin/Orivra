import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function source(path) {
  return readFile(resolve(root, path), "utf8").catch(() => "");
}

async function optionalImport(path) {
  return import(`${pathToFileURL(resolve(root, path)).href}?contract=${Date.now()}`)
    .catch(() => ({}));
}

const SCOPED_ENVIRONMENT_NAMES = Object.freeze([
  "PROOFLINE_CADDY_IMAGE",
  "PROOFLINE_WEB_IMAGE",
  "PROOFLINE_API_IMAGE",
  "PROOFLINE_WORKER_IMAGE",
  "PROOFLINE_POSTGRES_IMAGE",
  "PROOFLINE_MINIO_IMAGE",
  "PROOFLINE_MINIO_CLIENT_IMAGE",
  "PROOFLINE_PUBLIC_ORIGIN",
  "PROOFLINE_DEPLOYMENT_ID",
  "PROOFLINE_RELEASE_TREE_SHA",
  "PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI",
  "PROOFLINE_RELAYER_BALANCE_FLOOR_WEI",
  "PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA",
  "PROOFLINE_SAFE_CONSUMER_ADDRESS",
  "PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE",
  "PROOFLINE_MIGRATOR_DATABASE_URL_FILE",
  "PROOFLINE_API_DATABASE_URL_FILE",
  "PROOFLINE_API_TOKEN_DIGEST_KEY_FILE",
  "PROOFLINE_WORKER_DATABASE_URL_FILE",
  "PROOFLINE_WORKER_REPLAY_BUNDLE_FILE",
  "PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE",
  "PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE",
  "PROOFLINE_POSTGRES_PASSWORD_FILE",
  "PROOFLINE_BACKUP_DATABASE_URL_FILE",
  "PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE",
  "PROOFLINE_BACKUP_EVIDENCE_FILE",
  "PROOFLINE_BACKUP_EVIDENCE_SHA256",
  "PROOFLINE_MINIO_ROOT_USER_FILE",
  "PROOFLINE_MINIO_ROOT_PASSWORD_FILE",
  "PROOFLINE_BACKUP_SLOT",
  "PROOFLINE_BACKUP_ENDPOINT",
  "PROOFLINE_BACKUP_REGION",
  "PROOFLINE_BACKUP_BUCKET",
  "PROOFLINE_RESTORE_BACKUP_ID",
  "PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256",
  "PROOFLINE_RECOVERY_TARGET_TIME",
  "PROOFLINE_RECOVERY_TARGET_TIMELINE",
  "PROOFLINE_BACKUP_SYSTEM_IDENTIFIER",
]);

const NEGATIVE_CHILD_ENVIRONMENT_NAMES = Object.freeze([
  "PROOFLINE_POSTGRES_IMAGE",
  "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE",
]);

const BASE_ENVIRONMENT = Object.freeze({
  PATH: "/usr/bin:/bin",
  DOCKER_CONFIG: "/proofline/qa/docker-config",
  HOME: "/proofline/qa/home",
  XDG_CONFIG_HOME: "/proofline/qa/xdg",
  TMPDIR: "/proofline/qa/tmp",
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
});

const AMBIENT_SENTINELS = Object.freeze({
  HOME: "/ambient/home",
  XDG_CONFIG_HOME: "/ambient/xdg",
  AWS_ACCESS_KEY_ID: "ambient-aws-id",
  AWS_SECRET_ACCESS_KEY: "ambient-aws-secret",
  AWS_SESSION_TOKEN: "ambient-aws-session",
  GH_TOKEN: "ambient-gh-token",
  GITHUB_TOKEN: "ambient-github-token",
  GHCR_TOKEN: "ambient-ghcr-token",
  DIGITALOCEAN_TOKEN: "ambient-do-token",
  SPACES_SECRET_ACCESS_KEY: "ambient-spaces-secret",
  NPM_TOKEN: "ambient-npm-token",
  NODE_AUTH_TOKEN: "ambient-node-token",
  PROOFLINE_COSTON2_PRIVATE_KEY: "ambient-relayer-key",
  PROOFLINE_VERIFIER_API_KEY: "ambient-verifier-key",
  HTTP_PROXY: "http://ambient-proxy.invalid",
  HTTPS_PROXY: "http://ambient-proxy.invalid",
  ALL_PROXY: "socks5://ambient-proxy.invalid",
  NO_PROXY: "*",
  EXTRA_API_KEY: "ambient-extra-api-key",
  EXTRA_PRIVATE_KEY: "ambient-extra-private-key",
  EXTRA_SECRET: "ambient-extra-secret",
  EXTRA_TOKEN: "ambient-extra-token",
});

function scopedEnvironment() {
  return Object.fromEntries(SCOPED_ENVIRONMENT_NAMES.map((name) => [
    name,
    name.endsWith("_FILE")
      ? `/proofline/qa/secrets/${name.toLowerCase()}`
      : `fixture-${name.toLowerCase()}`,
  ]));
}

function environmentInput(overrides = {}) {
  return {
    ambientEnvironment: {
      PATH: BASE_ENVIRONMENT.PATH,
      ...AMBIENT_SENTINELS,
    },
    scopedEnvironment: scopedEnvironment(),
    dockerConfigDirectory: BASE_ENVIRONMENT.DOCKER_CONFIG,
    homeDirectory: BASE_ENVIRONMENT.HOME,
    xdgConfigDirectory: BASE_ENVIRONMENT.XDG_CONFIG_HOME,
    temporaryDirectory: BASE_ENVIRONMENT.TMPDIR,
    ...overrides,
  };
}

const CLEAN = Object.freeze({
  containers: 0,
  networks: 0,
  volumes: 0,
  temporaryPaths: 0,
});

const DEFINITION = Object.freeze({
  id: "missing-wal-object",
  expectedFailureCode: "RECOVERY_MISSING_OBJECT",
});

const CHILD_FAILURE = Object.freeze({
  caseId: DEFINITION.id,
  exitCode: 64,
  stdout: "",
  stderr: `${JSON.stringify({
    version: "1",
    caseId: DEFINITION.id,
    status: "failed",
    failureCode: DEFINITION.expectedFailureCode,
  })}\n`,
});

function fixture() {
  return {
    caseId: DEFINITION.id,
    mutationApplied: true,
    mutationEvidenceSha256: `sha256:${"a".repeat(64)}`,
    childObservationJson: JSON.stringify({
      mutationApplied: true,
      sinkObserved: true,
      passEvidenceCount: 0,
      promotionCount: 0,
    }),
  };
}

function independentObservation(overrides = {}) {
  return {
    caseId: DEFINITION.id,
    observationSha256: `sha256:${"b".repeat(64)}`,
    mutationObserved: true,
    sinkObserved: true,
    passEvidenceCount: 0,
    promotionCount: 0,
    ...overrides,
  };
}

function expectBypass(error) {
  return error?.code === "RECOVERY_NEGATIVE_CONTROL_BYPASSED" &&
    error?.message === "Recovery negative control failed closed";
}

function expectNegativeTimeout(error) {
  return error?.code === "RECOVERY_NEGATIVE_TIMEOUT" &&
    error?.message === "Recovery negative control timed out";
}

function expectEnvironmentInvalid(error) {
  return error?.code === "RECOVERY_GATE_ENV_INVALID" &&
    error?.message === "Recovery gate environment is invalid";
}

function waitUntilAborted(signal, active, name) {
  active.add(name);
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      active.delete(name);
      reject(Object.assign(new Error("fixture phase aborted"), {
        code: "ABORT_ERR",
      }));
    }, { once: true });
  });
}

test("extracts an import-safe parent observer, environment boundary and async negative runtime", async () => {
  const [gate, core, runtime, negativeRuntime, child, environment, asyncChild] =
    await Promise.all([
      source("scripts/docker-recovery-gate.mjs"),
      source("scripts/docker-recovery-gate-core.mjs"),
      source("scripts/docker-recovery-gate-runtime.mjs"),
      source("scripts/docker-recovery-negative-runtime.mjs"),
      source("scripts/docker-recovery-negative-child.mjs"),
      source("scripts/recovery-gate-environment.mjs"),
      source("scripts/recovery-async-child.mjs"),
    ]);
  assert.match(gate, /docker-recovery-negative-runtime\.mjs/);
  assert.match(gate, /recovery-gate-environment\.mjs/);
  assert.match(negativeRuntime, /recovery-async-child\.mjs/);
  assert.match(negativeRuntime, /recovery-gate-environment\.mjs/);
  assert.match(child, /recovery-async-child\.mjs/);
  assert.match(child, /recovery-gate-environment\.mjs/);
  assert.match(runtime, /inspectRecoveryCase/);
  assert.match(environment, /createCredentialFreeRecoveryEnvironments/);
  assert.match(asyncChild, /runBoundedRecoveryChild/);
  assert.match(asyncChild, /\bspawn\s*\(/);
  assert.match(asyncChild, /detached\s*:\s*true/);
  assert.match(asyncChild, /process\.kill\s*\(\s*-/);
  assert.match(asyncChild, /SIGTERM/);
  assert.match(asyncChild, /SIGKILL/);
  assert.match(asyncChild, /maximumOutputBytes/);
  assert.doesNotMatch(asyncChild, /shell\s*:\s*true/);
  assert.match(core, /cleanupTimeoutMs/);
  assert.match(core, /RECOVERY_NEGATIVE_TIMEOUT/);
  assert.match(gate, /projectFinalizerTimeoutMs\s*=\s*30_000/);
  assert.doesNotMatch(gate, /function\s+createNegativeRuntime/);
  for (const [name, value] of [["runtime", runtime], ["negativeRuntime", negativeRuntime], ["child", child]]) {
    assert.doesNotMatch(value, /spawnSync|execSync|execFileSync|Atomics\.wait/, name);
  }
  for (const [name, value] of [["gate", gate], ["negativeRuntime", negativeRuntime], ["child", child]]) {
    assert.doesNotMatch(value, /\.\.\.process\.env|env\s*:\s*process\.env/, name);
  }
});

test("exports exact frozen recovery environment profiles", async () => {
  const module = await optionalImport("scripts/recovery-gate-environment.mjs");
  assert.deepEqual(module.RECOVERY_GATE_SCOPED_ENV_NAMES, SCOPED_ENVIRONMENT_NAMES);
  assert.deepEqual(
    module.RECOVERY_NEGATIVE_CHILD_ENV_NAMES,
    NEGATIVE_CHILD_ENVIRONMENT_NAMES,
  );
  assert.equal(Object.isFrozen(module.RECOVERY_GATE_SCOPED_ENV_NAMES), true);
  assert.equal(Object.isFrozen(module.RECOVERY_NEGATIVE_CHILD_ENV_NAMES), true);
});

test("strips ambient authority and gives the negative child only its exact scoped profile", async () => {
  const module = await optionalImport("scripts/recovery-gate-environment.mjs");
  const result = module.createCredentialFreeRecoveryEnvironments(environmentInput());
  const scoped = scopedEnvironment();
  assert.deepEqual(result.docker, { ...BASE_ENVIRONMENT, ...scoped });
  assert.deepEqual(result.negativeChild, {
    ...BASE_ENVIRONMENT,
    ...Object.fromEntries(NEGATIVE_CHILD_ENVIRONMENT_NAMES.map((name) => [
      name,
      scoped[name],
    ])),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.docker), true);
  assert.equal(Object.isFrozen(result.negativeChild), true);
  for (const sentinel of Object.values(AMBIENT_SENTINELS)) {
    assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel.replaceAll("*", "\\*")));
  }
});

test("rejects unknown scoped keys, direct secrets, empty values and NULs", async () => {
  const module = await optionalImport("scripts/recovery-gate-environment.mjs");
  for (const invalid of [
    { PROOFLINE_UNKNOWN: "fixture" },
    { AWS_ACCESS_KEY_ID: "fixture" },
    { PROOFLINE_BACKUP_ENCRYPTION_KEY: "fixture-direct-secret" },
    { PROOFLINE_BACKUP_SLOT: "" },
    { PROOFLINE_BACKUP_BUCKET: "fixture\0bucket" },
  ]) {
    assert.throws(() => module.createCredentialFreeRecoveryEnvironments(
      environmentInput({
        scopedEnvironment: { ...scopedEnvironment(), ...invalid },
      }),
    ), expectEnvironmentInvalid);
  }
});

test("rejects forged child observation claims when parent probes disagree", async () => {
  const [core, runtime] = await Promise.all([
    optionalImport("scripts/docker-recovery-gate-core.mjs"),
    optionalImport("scripts/docker-recovery-gate-runtime.mjs"),
  ]);
  let inspections = 0;
  let cleanups = 0;
  const orchestration = runtime.createDockerRecoveryOrchestration({
    async prepareCase() { return fixture(); },
    async executeRecoveryCase() {
      return {
        ...CHILD_FAILURE,
        stdout: `${fixture().childObservationJson}\n${CHILD_FAILURE.stderr}`,
        stderr: "",
      };
    },
    async inspectRecoveryCase() {
      inspections += 1;
      return independentObservation({ mutationObserved: false });
    },
    async cleanupCase(_id, signal) {
      assert.equal(signal instanceof AbortSignal, true);
      cleanups += 1;
      return CLEAN;
    },
  });
  await assert.rejects(core.runRecoveryNegativeControls({
    orchestration,
    caseTimeoutMs: 100,
    cleanupTimeoutMs: 100,
  }), expectBypass);
  assert.equal(inspections, 1);
  assert.equal(cleanups, 1);
});

test("accepts a legitimate failure only with exact independent parent evidence", async () => {
  const runtime = await optionalImport("scripts/docker-recovery-gate-runtime.mjs");
  const orchestration = runtime.createDockerRecoveryOrchestration({
    async prepareCase() { return fixture(); },
    async executeRecoveryCase() { return CHILD_FAILURE; },
    async inspectRecoveryCase() { return independentObservation(); },
    async cleanupCase(_id, signal) {
      assert.equal(signal instanceof AbortSignal, true);
      return CLEAN;
    },
  });
  const result = await orchestration.runCase(
    DEFINITION,
    new AbortController().signal,
  );
  assert.deepEqual(result, {
    caseId: DEFINITION.id,
    status: "failed",
    failureCode: DEFINITION.expectedFailureCode,
    childExitCode: 64,
    childOutputSha256: result.childOutputSha256,
    parentObservationSha256: `sha256:${"b".repeat(64)}`,
    parentMutationObserved: true,
    parentSinkObserved: true,
    parentPassEvidenceCount: 0,
    parentPromotionCount: 0,
  });
  assert.match(result.childOutputSha256, /^sha256:[a-f0-9]{64}$/);
});

test("production parent probes never read child-authored observation JSON", async () => {
  const [gate, negativeRuntime, child] = await Promise.all([
    source("scripts/docker-recovery-gate.mjs"),
    source("scripts/docker-recovery-negative-runtime.mjs"),
    source("scripts/docker-recovery-negative-child.mjs"),
  ]);
  assert.match(negativeRuntime, /inspectRecoveryCase/);
  assert.match(negativeRuntime, /inspectObjectMutation/);
  assert.match(negativeRuntime, /inspectRecoverySink/);
  assert.match(negativeRuntime, /inspectPassEvidence/);
  assert.match(negativeRuntime, /inspectPromotionState/);
  assert.match(negativeRuntime, /parentObservationSha256/);
  assert.match(negativeRuntime, /pg_is_in_recovery/);
  assert.match(negativeRuntime, /volume\s+inspect|volumeInspect/);
  assert.match(negativeRuntime, /(?:mc\s+(?:stat|cat)|inspectObject)/);
  assert.doesNotMatch(negativeRuntime, /observationPath|observation\.v1\.json/);
  assert.doesNotMatch(gate, /observationPath|observation\.v1\.json/);
  assert.doesNotMatch(child, /mutationApplied|sinkObserved|passEvidenceCount|promotionCount/);
});

for (const hungPhase of ["prepare", "execute", "inspect"]) {
  test(`normalizes a hung ${hungPhase} phase and leaves no fake runtime resources`, async () => {
    const [core, runtime] = await Promise.all([
      optionalImport("scripts/docker-recovery-gate-core.mjs"),
      optionalImport("scripts/docker-recovery-gate-runtime.mjs"),
    ]);
    const active = new Set();
    let cleaned = 0;
    const orchestration = runtime.createDockerRecoveryOrchestration({
      async prepareCase(_definition, signal) {
        if (hungPhase === "prepare") return waitUntilAborted(signal, active, "prepare");
        return fixture();
      },
      async executeRecoveryCase(_fixture, signal) {
        if (hungPhase === "execute") return waitUntilAborted(signal, active, "execute");
        return CHILD_FAILURE;
      },
      async inspectRecoveryCase(_fixture, _execution, signal) {
        if (hungPhase === "inspect") return waitUntilAborted(signal, active, "inspect");
        return independentObservation();
      },
      async cleanupCase(_id, signal) {
        assert.equal(signal instanceof AbortSignal, true);
        active.clear();
        cleaned += 1;
        return CLEAN;
      },
    });
    await assert.rejects(core.runRecoveryNegativeControls({
      orchestration,
      caseTimeoutMs: 10,
      cleanupTimeoutMs: 20,
    }), expectNegativeTimeout);
    assert.equal(cleaned, 1);
    assert.equal(active.size, 0);
  });
}

test("bounds a hung cleanup finalizer and leaves no fake runtime resources", async () => {
  const [core, runtime] = await Promise.all([
    optionalImport("scripts/docker-recovery-gate-core.mjs"),
    optionalImport("scripts/docker-recovery-gate-runtime.mjs"),
  ]);
  const active = new Set();
  const orchestration = runtime.createDockerRecoveryOrchestration({
    async prepareCase() { return fixture(); },
    async executeRecoveryCase() { return CHILD_FAILURE; },
    async inspectRecoveryCase() { return independentObservation(); },
    async cleanupCase(_id, signal) {
      return waitUntilAborted(signal, active, "cleanup");
    },
  });
  await assert.rejects(core.runRecoveryNegativeControls({
    orchestration,
    caseTimeoutMs: 100,
    cleanupTimeoutMs: 10,
  }), expectNegativeTimeout);
  assert.equal(active.size, 0);
});

test("runs a legitimate child with exact output through the async process seam", async () => {
  const module = await optionalImport("scripts/recovery-async-child.mjs");
  const result = await module.runBoundedRecoveryChild({
    executable: process.execPath,
    args: ["-e", 'process.stdout.write("proofline-child-ok")'],
    cwd: root,
    environment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeoutMs: 1_000,
    killGraceMs: 100,
    maximumOutputBytes: 1_024,
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, {
    exitCode: 0,
    signal: null,
    stdout: "proofline-child-ok",
    stderr: "",
    timedOut: false,
  });
});

test("kills a hung child process tree before returning a normalized timeout", async () => {
  const module = await optionalImport("scripts/recovery-async-child.mjs");
  const directory = await mkdtemp(join(tmpdir(), "proofline-027c-child-tree-"));
  const pidPath = join(directory, "pids.json");
  let pids = [];
  try {
    const script = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      'writeFileSync(process.argv[1], JSON.stringify([process.pid, child.pid]));',
      'setInterval(() => {}, 1000);',
    ].join("");
    await assert.rejects(module.runBoundedRecoveryChild({
      executable: process.execPath,
      args: ["-e", script, pidPath],
      cwd: root,
      environment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      timeoutMs: 1_000,
      killGraceMs: 100,
      maximumOutputBytes: 1_024,
      signal: new AbortController().signal,
    }), (error) => error?.code === "RECOVERY_CHILD_TIMEOUT" &&
      error?.message === "Recovery child process timed out");
    pids = JSON.parse(await readFile(pidPath, "utf8"));
    for (let attempt = 0; attempt < 80 && pids.some(isProcessAlive); attempt += 1) {
      await delay(25);
    }
    assert.deepEqual(pids.map(isProcessAlive), [false, false]);
  } finally {
    for (const pid of pids) {
      if (isProcessAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}
