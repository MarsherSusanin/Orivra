import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const expectedGateIds = [
  "typecheck", "unit", "core-coverage", "backend-coverage", "web-coverage",
  "postgres", "solidity", "e2e", "build", "sites", "action-artifact",
  "docker-static", "docker-images", "docker-runtime", "docker-recovery",
  "release-freeze", "product-compose",
];

async function orchestration() {
  return import("../../scripts/mlp-candidate-orchestration.mjs");
}

test("029A package command exposes one terminal candidate freeze", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts?.["release:candidate"], "node scripts/mlp-candidate-freeze.mjs");
});

test("029A freezes the exact ordered full-matrix command inventory", async () => {
  const module = await orchestration();
  const commands = module.createCredentialFreeCandidateCommands();
  assert.deepEqual(commands.map(({ id }) => id), expectedGateIds);
  assert.equal(new Set(commands.map(({ id }) => id)).size, expectedGateIds.length);
  for (const command of commands) {
    assert.equal(command.executable, "npm");
    assert.ok(Array.isArray(command.arguments));
    assert.ok(command.arguments.length > 0);
  }
});

test("029A command inventory includes real PostgreSQL and excludes live/network authority", async () => {
  const module = await orchestration();
  const serialized = JSON.stringify(module.createCredentialFreeCandidateCommands());
  assert.match(serialized, /PROOFLINE_TESTCONTAINERS/);
  assert.match(serialized, /test:postgres/);
  assert.doesNotMatch(serialized, /test:live:coston2|docker:prefetch|login|push|pull|imagetools/);
});

test("029A gives only the recovery gate a private caller-owned evidence root", async () => {
  const module = await orchestration();
  const recoveryEvidenceOutput = "/private/tmp/proofline-029a/recovery-evidence";
  const commands = module.createCredentialFreeCandidateCommands({ recoveryEvidenceOutput });
  const recovery = commands.find(({ id }) => id === "docker-recovery");
  assert.deepEqual(recovery?.environment, {
    PROOFLINE_RECOVERY_EVIDENCE_OUTPUT_DIR: recoveryEvidenceOutput,
  });
  for (const command of commands.filter(({ id }) => id !== "docker-recovery" && id !== "postgres")) {
    assert.deepEqual(command.environment, {});
  }
  const source = await readFile(new URL("../../scripts/mlp-candidate-freeze.mjs", import.meta.url), "utf8");
  assert.match(source, /recoveryEvidenceOutput:\s*paths\.recoveryEvidence/);
});

test("029A child environment is minimal, private and strips ambient credentials", async () => {
  const module = await orchestration();
  const environment = module.createCredentialFreeCandidateEnvironment({
    ambientEnvironment: {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/example",
      SSH_AUTH_SOCK: "/tmp/agent",
      AWS_ACCESS_KEY_ID: "aws",
      GITHUB_TOKEN: "gh",
      GH_TOKEN: "gh2",
      DOCKER_CONFIG: "/tmp/auth",
      DOCKER_HOST: "tcp://remote.invalid:2376",
      HTTPS_PROXY: "https://proxy.invalid",
      PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE: "/tmp/key",
    },
    homeDirectory: "/private/tmp/home",
    dockerConfigDirectory: "/private/tmp/docker",
    temporaryDirectory: "/private/tmp/tmp",
  });
  assert.deepEqual(Object.keys(environment).sort(), [
    "CI", "DOCKER_CONFIG", "HOME", "LANG", "LC_ALL", "NODE_ENV", "PATH",
    "PROOFLINE_TESTCONTAINERS", "TMPDIR", "TZ", "XDG_CONFIG_HOME",
  ]);
  assert.equal(environment.PROOFLINE_TESTCONTAINERS, "1");
  assert.equal(JSON.stringify(environment).includes("remote.invalid"), false);
  assert.equal(JSON.stringify(environment).includes("aws"), false);
  assert.equal(JSON.stringify(environment).includes("gh"), false);
});

test("029A exposes Compose only through one verified local plugin in its private no-auth config", async () => {
  const module = await orchestration();
  assert.deepEqual(module.CANDIDATE_COMPOSE_PLUGIN_PATHS, [
    "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose",
    "/usr/local/lib/docker/cli-plugins/docker-compose",
    "/usr/libexec/docker/cli-plugins/docker-compose",
    "/usr/lib/docker/cli-plugins/docker-compose",
    "/opt/homebrew/lib/docker/cli-plugins/docker-compose",
  ]);
  const parent = await mkdtemp(join(tmpdir(), "proofline-029a-compose-plugin-"));
  try {
    const dockerConfig = join(parent, "docker-config");
    const plugin = join(parent, "docker-compose");
    await mkdir(dockerConfig, { mode: 0o700 });
    await writeFile(plugin, "verified local compose plugin", { mode: 0o555 });
    const resolved = await module.materializeCandidateComposePlugin({
      dockerConfigDirectory: dockerConfig,
      candidatePaths: [join(parent, "missing"), plugin],
    });
    const installed = join(dockerConfig, "cli-plugins/docker-compose");
    const canonicalPlugin = await realpath(plugin);
    assert.equal(resolved, canonicalPlugin);
    assert.equal((await lstat(installed)).isSymbolicLink(), true);
    assert.equal(await realpath(installed), canonicalPlugin);
    assert.equal((await lstat(plugin)).mode & 0o777, 0o555);
    await assert.rejects(() => module.materializeCandidateComposePlugin({
      dockerConfigDirectory: dockerConfig,
      candidatePaths: [join(parent, "missing")],
    }), /Compose plugin is unavailable/);
  } finally {
    await chmod(parent, 0o700).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});

test("029A exposes BuildKit only through one verified local Buildx plugin in the same no-auth config", async () => {
  const module = await orchestration();
  assert.deepEqual(module.CANDIDATE_BUILDX_PLUGIN_PATHS, [
    "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx",
    "/usr/local/lib/docker/cli-plugins/docker-buildx",
    "/usr/libexec/docker/cli-plugins/docker-buildx",
    "/usr/lib/docker/cli-plugins/docker-buildx",
    "/opt/homebrew/lib/docker/cli-plugins/docker-buildx",
  ]);
  const parent = await mkdtemp(join(tmpdir(), "proofline-029a-buildx-plugin-"));
  try {
    const dockerConfig = join(parent, "docker-config");
    const plugin = join(parent, "docker-buildx");
    await mkdir(dockerConfig, { mode: 0o700 });
    await writeFile(plugin, "verified local buildx plugin", { mode: 0o555 });
    const resolved = await module.materializeCandidateBuildxPlugin({
      dockerConfigDirectory: dockerConfig,
      candidatePaths: [join(parent, "missing"), plugin],
    });
    const installed = join(dockerConfig, "cli-plugins/docker-buildx");
    const canonicalPlugin = await realpath(plugin);
    assert.equal(resolved, canonicalPlugin);
    assert.equal((await lstat(installed)).isSymbolicLink(), true);
    assert.equal(await realpath(installed), canonicalPlugin);
    assert.equal((await lstat(plugin)).mode & 0o777, 0o555);
    await assert.rejects(() => module.materializeCandidateBuildxPlugin({
      dockerConfigDirectory: dockerConfig,
      candidatePaths: [join(parent, "missing")],
    }), /Buildx plugin is unavailable/);
  } finally {
    await chmod(parent, 0o700).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});

test("029A materializes verified WAL-G at the exact retained offline-build context", async () => {
  const module = await orchestration();
  const parent = await mkdtemp(join(tmpdir(), "proofline-029a-wal-g-context-"));
  try {
    const capturedContext = join(parent, "captured");
    const prefetchRoot = join(parent, "docker/.prefetch");
    const receiptBytes = Buffer.from('{"binarySha256":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","binarySize":8,"version":"1"}');
    await mkdir(capturedContext, { mode: 0o700 });
    await mkdir(join(parent, "docker"), { mode: 0o700 });
    await writeFile(join(capturedContext, "wal-g"), "verified", { mode: 0o400 });
    await chmod(capturedContext, 0o500);
    const releaseRoot = await module.materializeCandidateWalGPrefetch({
      capturedContextRoot: capturedContext,
      prefetchRoot,
      receiptBytes,
    });
    assert.equal(releaseRoot, join(prefetchRoot, "wal_g_release"));
    assert.deepEqual(await readdir(prefetchRoot), ["wal_g_release"]);
    assert.deepEqual((await readdir(releaseRoot)).sort(), ["receipt.v1.json", "wal-g"]);
    assert.equal(await readFile(join(releaseRoot, "wal-g"), "utf8"), "verified");
    assert.deepEqual(await readFile(join(releaseRoot, "receipt.v1.json")), receiptBytes);
    assert.equal((await lstat(join(releaseRoot, "wal-g"))).mode & 0o777, 0o555);
    assert.equal((await lstat(join(releaseRoot, "receipt.v1.json"))).mode & 0o777, 0o444);
    await assert.rejects(() => lstat(join(prefetchRoot, "wal-g")), { code: "ENOENT" });
    await assert.rejects(() => lstat(join(prefetchRoot, "receipt.v1.json")), { code: "ENOENT" });
  } finally {
    await chmod(parent, 0o700).catch(() => undefined);
    await chmod(join(parent, "captured"), 0o700).catch(() => undefined);
    await chmod(join(parent, "captured/wal-g"), 0o600).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});

test("029A runs gates serially, records only fixed PASS ids and fails fast", async () => {
  const module = await orchestration();
  const order = [];
  const result = await module.runCredentialFreeCandidateMatrix({
    commands: [{ id: "one" }, { id: "two" }, { id: "three" }],
    runCommand: async ({ id }) => {
      order.push(id);
      if (id === "two") throw new Error("boom");
    },
  }).catch((cause) => cause);
  assert.deepEqual(order, ["one", "two"]);
  assert.match(result.message, /candidate matrix failed/i);
  assert.equal(JSON.stringify(result).includes("boom"), false);
});

test("029A publishes only after matrix, release, product, cleanup and final identity", async () => {
  const module = await orchestration();
  const order = [];
  const result = await module.runCredentialFreeCandidateLifecycle({
    verifyInputs: async () => order.push("inputs"),
    runMatrix: async () => order.push("matrix"),
    freezeRelease: async () => order.push("release"),
    runProduct: async () => order.push("product"),
    finalizeResources: async () => order.push("cleanup"),
    verifyFinalSource: async () => order.push("identity"),
    publish: async () => { order.push("publish"); return "passed"; },
    discard: async () => order.push("discard"),
  });
  assert.equal(result, "passed");
  assert.deepEqual(order, ["inputs", "matrix", "release", "product", "cleanup", "identity", "publish"]);
});

test("029A failure leaves no PASS and discards owned stage without masking the cause", async () => {
  const module = await orchestration();
  for (const phase of ["inputs", "matrix", "release", "product", "cleanup", "identity", "publish"]) {
    const order = [];
    const hooks = Object.fromEntries([
      "inputs", "matrix", "release", "product", "cleanup", "identity", "publish",
    ].map((name) => [name, async () => {
      order.push(name);
      if (name === phase) throw new Error(`failure-${name}`);
    }]));
    await assert.rejects(() => module.runCredentialFreeCandidateLifecycle({
      verifyInputs: hooks.inputs,
      runMatrix: hooks.matrix,
      freezeRelease: hooks.release,
      runProduct: hooks.product,
      finalizeResources: hooks.cleanup,
      verifyFinalSource: hooks.identity,
      publish: hooks.publish,
      discard: async () => order.push("discard"),
    }), new RegExp(`failure-${phase}`));
    assert.equal(order.includes("discard"), true);
    assert.equal(order.includes("publish") && phase !== "publish", false);
  }
});

test("029A safe cleanup unlinks symlinks without chmod or traversal", async () => {
  const module = await orchestration();
  const parent = await mkdtemp(join(tmpdir(), "proofline-029a-cleanup-"));
  try {
    const owned = join(parent, "owned");
    const external = join(parent, "external.txt");
    await mkdir(join(owned, "nested"), { recursive: true, mode: 0o700 });
    await writeFile(join(owned, "nested", "owned.txt"), "owned", { mode: 0o400 });
    await writeFile(external, "external", { mode: 0o400 });
    await symlink(external, join(owned, "external-link"));
    await chmod(owned, 0o500);
    await module.removeOwnedCandidatePath(owned);
    await assert.rejects(() => lstat(owned), { code: "ENOENT" });
    assert.equal(await readFile(external, "utf8"), "external");
    assert.equal((await lstat(external)).mode & 0o777, 0o400);
  } finally {
    await chmod(parent, 0o700).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});

test("029A CLI source contains final identity, exact output modes and no prefetch/network command", async () => {
  const source = await readFile(new URL("../../scripts/mlp-candidate-freeze.mjs", import.meta.url), "utf8");
  assert.match(source, /verifyReleaseSourceForPublication|verifyFinalSource/);
  assert.match(source, /0o700/);
  assert.match(source, /0o500/);
  assert.match(source, /0o400/);
  assert.match(source, /frozen-release-manifest\.v1\.json/);
  assert.match(source, /credential-free-mlp-candidate\.v1\.json/);
  assert.match(source, /recorded-product-fixture\.v1\.json/);
  assert.match(source, /materializeCandidateComposePlugin/);
  assert.doesNotMatch(source, /docker:prefetch|test:live:coston2|docker\s+(?:login|push|pull)/);
});
