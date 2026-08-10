import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const NEGATIVE_PROJECT = "proofline-027c-negative-fixture";
const POSITIVE_PROJECT = "proofline-027c-positive-fixture";
const PROBE_INPUT = Object.freeze({
  version: "1",
  caseId: "missing-wal-object",
  projectName: NEGATIVE_PROJECT,
  serviceName: "pitr-postgres",
  containerName: `${NEGATIVE_PROJECT}-pitr-postgres`,
  objectTarget:
    "recovery/proofline-recovery-qa/proofline/v1/qa/7532076200787175519/" +
    "wal_005/00000001000000000000000A.lz4",
  restoreVolume: `${NEGATIVE_PROJECT}_restore`,
  passEvidencePath: "/proofline/negative-fixture/PASS.json",
});

const EXPECTED_PROBE_IDENTITY = Object.freeze({
  ...PROBE_INPUT,
  identitySha256: sha256(Buffer.from(JSON.stringify(PROBE_INPUT), "utf8")),
});

function expectProbeBindingInvalid(error) {
  return error?.code === "RECOVERY_NEGATIVE_PROBE_BINDING_INVALID" &&
    error?.message === "Recovery negative probe binding is invalid";
}

function expectProjectFinalizerTimeout(error) {
  return error?.code === "RECOVERY_PROJECT_FINALIZER_TIMEOUT" &&
    error?.message === "Recovery project finalizer timed out";
}

test("extracts exact parent-probe, lifecycle and environment authority boundaries", async () => {
  const [gate, gateRuntime, negativeRuntime, observer, lifecycle, environment] =
    await Promise.all([
      source("scripts/docker-recovery-gate.mjs"),
      source("scripts/docker-recovery-gate-runtime.mjs"),
      source("scripts/docker-recovery-negative-runtime.mjs"),
      source("scripts/recovery-negative-parent-observer.mjs"),
      source("scripts/recovery-gate-lifecycle.mjs"),
      source("scripts/recovery-gate-environment.mjs"),
    ]);
  assert.match(gate, /recovery-gate-lifecycle\.mjs/);
  assert.match(negativeRuntime, /recovery-negative-parent-observer\.mjs/);
  assert.match(gateRuntime, /inspectRecoveryCase\s*\(\s*fixture\s*,\s*signal\s*\)/);
  assert.match(observer, /createRecoveryNegativeProbeIdentity/);
  assert.match(observer, /createRecoveryNegativeParentObserver/);
  assert.match(negativeRuntime, /identity\.projectName/);
  assert.match(negativeRuntime, /identity\.serviceName/);
  assert.match(negativeRuntime, /identity\.containerName/);
  assert.match(negativeRuntime, /identity\.objectTarget/);
  assert.match(lifecycle, /finalizeRecoveryGate/);
  assert.match(lifecycle, /finally/);
  assert.match(lifecycle, /rm\s*\(/);
  assert.doesNotMatch(observer, /execution|childExit|childOutput|stdout|stderr|State\.Status/);
  assert.doesNotMatch(negativeRuntime, /inspectRecoveryCase\s*\([^)]*execution/);
  assert.doesNotMatch(gate, /process\.env\.DOCKER_HOST/);
  assert.match(environment, /RECOVERY_GATE_ENV_INVALID|ENVIRONMENT_ERROR_CODE/);
});

test("exports a frozen canonical negative-case probe identity", async () => {
  const module = await optionalImport("scripts/recovery-negative-parent-observer.mjs");
  const identity = module.createRecoveryNegativeProbeIdentity(PROBE_INPUT);
  assert.deepEqual(identity, EXPECTED_PROBE_IDENTITY);
  assert.equal(Object.isFrozen(identity), true);
});

test("rejects a cross-project forged fixture before any parent probe", async () => {
  const module = await optionalImport("scripts/recovery-negative-parent-observer.mjs");
  const negativeIdentity = module.createRecoveryNegativeProbeIdentity(PROBE_INPUT);
  const calls = [];
  const observer = module.createRecoveryNegativeParentObserver({
    identity: negativeIdentity,
    async inspectMutation() { calls.push("mutation"); return true; },
    async inspectSink() { calls.push("sink"); return true; },
    async countPassEvidence() { calls.push("pass"); return 0; },
    async countPromotions() { calls.push("promotion"); return 0; },
  });
  const forgedIdentityDigests = [
    {
      ...PROBE_INPUT,
      projectName: POSITIVE_PROJECT,
      containerName: `${POSITIVE_PROJECT}-pitr-postgres`,
      restoreVolume: `${POSITIVE_PROJECT}_restore`,
    },
    { ...PROBE_INPUT, serviceName: "unrelated-service" },
    { ...PROBE_INPUT, containerName: `${POSITIVE_PROJECT}-pitr-postgres` },
    { ...PROBE_INPUT, objectTarget: `${PROBE_INPUT.objectTarget}.unrelated` },
  ].map((input) => sha256(Buffer.from(JSON.stringify(input), "utf8")));
  for (const forgedIdentitySha256 of forgedIdentityDigests) {
    await assert.rejects(observer.inspectCase({
      fixture: {
        caseId: PROBE_INPUT.caseId,
        probeIdentitySha256: forgedIdentitySha256,
      },
      signal: new AbortController().signal,
    }), expectProbeBindingInvalid);
  }
  assert.deepEqual(calls, []);
});

test("derives accepted evidence only from four independent exact-bound parent probes", async () => {
  const module = await optionalImport("scripts/recovery-negative-parent-observer.mjs");
  const identity = module.createRecoveryNegativeProbeIdentity(PROBE_INPUT);
  const calls = [];
  function observe(name, value) {
    return async (observedIdentity, signal) => {
      assert.deepEqual(observedIdentity, EXPECTED_PROBE_IDENTITY);
      assert.equal(signal instanceof AbortSignal, true);
      calls.push(name);
      return value;
    };
  }
  const observer = module.createRecoveryNegativeParentObserver({
    identity,
    inspectMutation: observe("mutation", true),
    inspectSink: observe("sink", true),
    countPassEvidence: observe("pass", 0),
    countPromotions: observe("promotion", 0),
  });
  const result = await observer.inspectCase({
    fixture: {
      caseId: PROBE_INPUT.caseId,
      probeIdentitySha256: identity.identitySha256,
    },
    signal: new AbortController().signal,
  });
  assert.deepEqual(calls, ["mutation", "sink", "pass", "promotion"]);
  assert.deepEqual(result, {
    caseId: PROBE_INPUT.caseId,
    observationSha256: result.observationSha256,
    mutationObserved: true,
    sinkObserved: true,
    passEvidenceCount: 0,
    promotionCount: 0,
  });
  assert.match(result.observationSha256, /^sha256:[a-f0-9]{64}$/);
});

test("uses an isolated no-auth local-default Docker environment for recovery", async () => {
  const module = await optionalImport("scripts/recovery-gate-environment.mjs");
  const scopedNames = module.RECOVERY_GATE_SCOPED_ENV_NAMES;
  const scopedEnvironment = Object.fromEntries(scopedNames.map((name) => [
    name,
    name.endsWith("_FILE")
      ? `/proofline/qa/secrets/${name.toLowerCase()}`
      : `fixture-${name.toLowerCase()}`,
  ]));
  const input = {
    ambientEnvironment: { PATH: "/usr/bin:/bin" },
    scopedEnvironment,
    dockerConfigDirectory: "/proofline/qa/docker-config",
    homeDirectory: "/proofline/qa/home",
    xdgConfigDirectory: "/proofline/qa/xdg",
    temporaryDirectory: "/proofline/qa/tmp",
  };
  const forbiddenEntries = [
    ["DOCKER_HOST", "tcp://ambient-docker.invalid:2376"],
    ["DOCKER_CONTEXT", "ambient-context"],
    ["DOCKER_TLS_VERIFY", "1"],
    ["DOCKER_CERT_PATH", "/ambient/certs"],
    ["DOCKER_CONFIG", "/ambient/docker-config"],
    ["DOCKER_AUTH_CONFIG", "ambient-auth"],
    ["REGISTRY_AUTH_FILE", "/ambient/registry-auth.json"],
    ["SSH_AUTH_SOCK", "/ambient/ssh-agent.sock"],
    ["SSH_AGENT_PID", "4242"],
    ["BUILDKIT_HOST", "tcp://ambient-buildkit.invalid:1234"],
    ["BUILDX_CONFIG", "/ambient/buildx"],
  ];
  for (const [name, value] of forbiddenEntries) {
    assert.throws(() => module.createCredentialFreeRecoveryEnvironments({
      ...input,
      ambientEnvironment: { ...input.ambientEnvironment, [name]: value },
    }), (error) => error?.code === "RECOVERY_GATE_ENV_INVALID" &&
      error?.message === "Recovery gate environment is invalid", name);
  }
  for (const dockerHost of [
    "tcp://ambient-docker.invalid:2376",
    "ssh://ambient-docker.invalid",
    "https://ambient-docker.invalid",
    "unix:///ambient/docker.sock?context=forged",
  ]) {
    assert.throws(() => module.createCredentialFreeRecoveryEnvironments({
      ...input,
      dockerHost,
    }), (error) => error?.code === "RECOVERY_GATE_ENV_INVALID" &&
      error?.message === "Recovery gate environment is invalid", dockerHost);
  }
  const result = module.createCredentialFreeRecoveryEnvironments(input);
  const forbidden = forbiddenEntries
    .map(([name]) => name)
    .filter((name) => name !== "DOCKER_CONFIG");
  for (const profile of [result.docker, result.negativeChild]) {
    for (const name of forbidden) assert.equal(profile[name], undefined, name);
    assert.equal(profile.DOCKER_CONFIG, "/proofline/qa/docker-config");
    assert.equal(profile.HOME, "/proofline/qa/home");
    assert.equal(profile.XDG_CONFIG_HOME, "/proofline/qa/xdg");
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

async function terminateFixtureProcesses(pids) {
  for (const pid of pids) {
    if (!isProcessAlive(pid)) continue;
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  for (let attempt = 0; attempt < 40 && pids.some(isProcessAlive); attempt += 1) {
    await delay(25);
  }
}

for (let repetition = 1; repetition <= 12; repetition += 1) {
  test(`does not settle before a TERM-resistant process group is reaped (${repetition}/12)`, {
    timeout: 4_000,
  }, async () => {
    const module = await optionalImport("scripts/recovery-async-child.mjs");
    assert.equal(typeof module.runBoundedRecoveryChild, "function");
    const directory = await mkdtemp(join(tmpdir(), "proofline-027c-reap-wave3-"));
    const pidPath = join(directory, "pids.json");
    let pids = [];
    try {
      const descendant = [
        'process.on("SIGTERM", () => undefined);',
        "setInterval(() => undefined, 1000);",
      ].join("");
      const parent = [
        'const { spawn } = require("node:child_process");',
        'const { writeFileSync } = require("node:fs");',
        'process.on("SIGTERM", () => undefined);',
        `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });`,
        "writeFileSync(process.argv[1], JSON.stringify([process.pid, child.pid]));",
        "setInterval(() => undefined, 1000);",
      ].join("");
      await assert.rejects(module.runBoundedRecoveryChild({
        executable: process.execPath,
        args: ["-e", parent, pidPath],
        cwd: root,
        environment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        timeoutMs: 150,
        killGraceMs: 30,
        maximumOutputBytes: 1_024,
        signal: new AbortController().signal,
      }), (error) => error?.code === "RECOVERY_CHILD_TIMEOUT" &&
        error?.message === "Recovery child process timed out");
      pids = JSON.parse(await readFile(pidPath, "utf8"));
      assert.deepEqual(
        pids.map(isProcessAlive),
        [false, false],
        "timeout promise may settle only after the whole process group closes",
      );
    } finally {
      await terminateFixtureProcesses(pids);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("removes temporary secrets after a rejecting project finalizer and preserves its failure", async () => {
  const module = await optionalImport("scripts/recovery-gate-lifecycle.mjs");
  const directory = await mkdtemp(join(tmpdir(), "proofline-027c-finalizer-reject-"));
  const secret = join(directory, "backup-encryption-key");
  const expected = Object.assign(new Error("fixture finalizer rejected"), {
    code: "RECOVERY_PROJECT_CLEANUP_FAILED",
  });
  await writeFile(secret, "fixture-secret", { mode: 0o600 });
  try {
    await assert.rejects(module.finalizeRecoveryGate({
      temporaryDirectory: directory,
      finalizerTimeoutMs: 100,
      async finalizeProject(signal) {
        assert.equal(signal instanceof AbortSignal, true);
        throw expected;
      },
      async removeTemporaryDirectory(path) {
        await rm(path, { recursive: true, force: true });
      },
    }), (error) => error === expected);
    await assert.rejects(access(directory), (error) => error?.code === "ENOENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes temporary secrets after a project-finalizer timeout", async () => {
  const module = await optionalImport("scripts/recovery-gate-lifecycle.mjs");
  const directory = await mkdtemp(join(tmpdir(), "proofline-027c-finalizer-timeout-"));
  await writeFile(join(directory, "minio-root-password"), "fixture-secret", {
    mode: 0o600,
  });
  try {
    await assert.rejects(module.finalizeRecoveryGate({
      temporaryDirectory: directory,
      finalizerTimeoutMs: 10,
      finalizeProject(signal) {
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("fixture aborted")), {
            once: true,
          });
        });
      },
      async removeTemporaryDirectory(path) {
        await rm(path, { recursive: true, force: true });
      },
    }), expectProjectFinalizerTimeout);
    await assert.rejects(access(directory), (error) => error?.code === "ENOENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const PREFETCH_CHILD_ENV_NAMES = Object.freeze([
  "DOCKER_CONFIG",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
]);

const PREFETCH_SENTINELS = Object.freeze({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: "/ambient/tmp",
  LANG: "ambient_LANG",
  LC_ALL: "ambient_LC_ALL",
  TZ: "ambient/TZ",
  DOCKER_HOST: "tcp://ambient-docker.invalid:2376",
  DOCKER_CONTEXT: "ambient-context",
  DOCKER_TLS_VERIFY: "1",
  DOCKER_CERT_PATH: "/ambient/docker-certs",
  DOCKER_AUTH_CONFIG: "ambient-docker-auth",
  REGISTRY_AUTH_FILE: "/ambient/registry-auth.json",
  SSH_AUTH_SOCK: "/ambient/ssh-agent.sock",
  SSH_AGENT_PID: "4242",
  BUILDKIT_HOST: "tcp://ambient-buildkit.invalid:1234",
  BUILDX_CONFIG: "/ambient/buildx",
  HTTP_PROXY: "http://ambient-proxy.invalid",
  HTTPS_PROXY: "http://ambient-proxy.invalid",
  ALL_PROXY: "socks5://ambient-proxy.invalid",
  NO_PROXY: "*",
  AWS_ACCESS_KEY_ID: "ambient-aws-id",
  AWS_SECRET_ACCESS_KEY: "ambient-aws-secret",
  GITHUB_TOKEN: "ambient-github-token",
  GH_TOKEN: "ambient-gh-token",
  GHCR_TOKEN: "ambient-ghcr-token",
  DIGITALOCEAN_TOKEN: "ambient-do-token",
  PROOFLINE_COSTON2_PRIVATE_KEY: "ambient-private-key",
  PROOFLINE_VERIFIER_API_KEY: "ambient-api-key",
  EXTRA_TOKEN: "ambient-token",
  EXTRA_SECRET: "ambient-secret",
});

const PREFETCH_IMAGE = Object.freeze({
  repository: "node",
  tag: "22.14.0-bookworm-slim",
  indexDigest: `sha256:${"a".repeat(64)}`,
  linuxAmd64Digest: `sha256:${"b".repeat(64)}`,
});

const PREFETCH_LOCK = Object.freeze({
  version: "1",
  platform: "linux/amd64",
  images: Object.fromEntries([
    "node", "caddy", "postgres", "postgresRecovery", "minio", "minioClient",
  ].map((name) => [name, {
    ...PREFETCH_IMAGE,
    repository: `fixture/${name.toLowerCase()}`,
  }])),
});

async function fakePrefetchDocker(directory) {
  const executable = join(directory, "docker-prefetch-fake");
  const log = join(directory, "children.jsonl");
  const output = `${PREFETCH_IMAGE.indexDigest}\n${PREFETCH_IMAGE.linuxAmd64Digest}\n`;
  const script = `#!${process.execPath}
import { appendFileSync, readFileSync, statSync } from "node:fs";
let configJson = null;
try { configJson = readFileSync(process.env.DOCKER_CONFIG + "/config.json", "utf8").trim(); } catch {}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  args: process.argv.slice(2),
  environment: Object.fromEntries(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))),
  configJson,
  dockerConfigMode: statSync(process.env.DOCKER_CONFIG).mode & 0o777,
}) + "\\n");
if (process.argv[2] === "buildx") process.stdout.write(${JSON.stringify(output)});
`;
  await writeFile(executable, script, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { executable, log };
}

async function prefetchPhaseRecord(phase) {
  const directory = await mkdtemp(join(tmpdir(), `proofline-027c-prefetch-${phase}-`));
  try {
    const module = await optionalImport("scripts/docker-prefetch-orchestration.mjs");
    const fake = await fakePrefetchDocker(directory);
    await module.runDockerPrefetch({
      dockerExecutable: fake.executable,
      environment: PREFETCH_SENTINELS,
      root,
      lock: PREFETCH_LOCK,
    });
    const records = (await readFile(fake.log, "utf8"))
      .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const record = records.find(({ args }) => {
      if (phase === "inspect") return args[0] === "buildx";
      return args[0] === phase;
    });
    assert.ok(record, `${phase} child must execute through the fake runtime`);
    const suppliedEnvironment = { ...record.environment };
    delete suppliedEnvironment.__CF_USER_TEXT_ENCODING;
    assert.deepEqual(Object.keys(suppliedEnvironment), PREFETCH_CHILD_ENV_NAMES);
    assert.equal(record.environment.PATH, PREFETCH_SENTINELS.PATH);
    assert.equal(record.environment.LANG, "C");
    assert.equal(record.environment.LC_ALL, "C");
    assert.equal(record.environment.TZ, "UTC");
    assert.equal(record.dockerConfigMode, 0o700);
    assert.equal(record.configJson, '{"auths":{}}');
    for (const name of ["DOCKER_CONFIG", "HOME", "XDG_CONFIG_HOME", "TMPDIR"]) {
      assert.notEqual(record.environment[name], PREFETCH_SENTINELS[name], name);
      assert.match(record.environment[name], /proofline-docker-cli-/);
    }
    await assert.rejects(access(record.environment.DOCKER_CONFIG), (error) =>
      error?.code === "ENOENT");
    return record;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("exports the exact minimal prefetch child environment inventory", async () => {
  const module = await optionalImport("scripts/docker-prefetch-orchestration.mjs");
  assert.deepEqual(module.PREFETCH_CHILD_ENV_NAMES, PREFETCH_CHILD_ENV_NAMES);
  assert.equal(Object.isFrozen(module.PREFETCH_CHILD_ENV_NAMES), true);
  const environment = module.createCredentialFreePrefetchEnvironment({
    ambientEnvironment: PREFETCH_SENTINELS,
    dockerConfigDirectory: "/proofline/prefetch/docker-config",
    homeDirectory: "/proofline/prefetch/home",
    xdgConfigDirectory: "/proofline/prefetch/xdg",
    temporaryDirectory: "/proofline/prefetch/tmp",
  });
  assert.deepEqual(environment, {
    DOCKER_CONFIG: "/proofline/prefetch/docker-config",
    HOME: "/proofline/prefetch/home",
    LANG: "C",
    LC_ALL: "C",
    PATH: PREFETCH_SENTINELS.PATH,
    TMPDIR: "/proofline/prefetch/tmp",
    TZ: "UTC",
    XDG_CONFIG_HOME: "/proofline/prefetch/xdg",
  });
  assert.equal(Object.isFrozen(environment), true);
});

for (const phase of ["inspect", "pull", "build"]) {
  test(`strips ambient authority from the fake prefetch ${phase} child`, async () => {
    const record = await prefetchPhaseRecord(phase);
    const serialized = JSON.stringify(record.environment);
    for (const sentinel of Object.values(PREFETCH_SENTINELS)) {
      if (sentinel === PREFETCH_SENTINELS.PATH) continue;
      assert.equal(serialized.includes(sentinel), false, sentinel);
    }
  });
}
