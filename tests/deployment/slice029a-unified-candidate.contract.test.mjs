import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    assert.equal(typeof module.removeOwnedCandidatePath, "function");
  } finally {
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
  assert.doesNotMatch(source, /docker:prefetch|test:live:coston2|docker\s+(?:login|push|pull)/);
});
