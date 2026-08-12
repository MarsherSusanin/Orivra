import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function runtime() {
  return import("../../scripts/mlp-product-compose-runtime.mjs");
}

test("029A recorded fixture exporter returns canonical bounded UTF-8 bytes", async () => {
  const module = await runtime();
  const bytes = await module.createRecordedProductFixture();
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 1024 * 1024);
  assert.deepEqual(Buffer.from(JSON.stringify(JSON.parse(Buffer.from(bytes).toString("utf8")))), Buffer.from(bytes));
});

test("029A product observation binds exact loopback origin and stopped worker", async () => {
  const module = await runtime();
  assert.deepEqual(module.createRecordedProductObservation({ fixtureSha256: `sha256:${"a".repeat(64)}` }), {
    fixtureFilename: "recorded-product-fixture.v1.json",
    fixtureSha256: `sha256:${"a".repeat(64)}`,
    mode: "checked-in-recorded-fixture",
    publicOrigin: "https://127.0.0.1",
    worker: "stopped",
    status: "passed",
  });
});

test("029A product observation rejects unexpected services, origin or fixture identity", async () => {
  const module = await runtime();
  for (const input of [
    { services: ["caddy", "web", "api", "postgres", "worker"] },
    { origin: "https://localhost" },
    { fixtureSha256: "sha256:abc" },
  ]) assert.throws(() => module.verifyRecordedProductObservation(input), /recorded product/i);
});

test("029A Compose gate uses production services, no pull/build and never starts worker", async () => {
  const source = await readFile(new URL("../../scripts/mlp-product-compose.mjs", import.meta.url), "utf8");
  assert.match(source, /compose/);
  assert.match(source, /--pull["',\s]+never/);
  assert.match(source, /--no-build/);
  assert.match(source, /caddy/);
  assert.match(source, /web/);
  assert.match(source, /api/);
  assert.match(source, /postgres/);
  assert.doesNotMatch(source, /["']worker["']/);
});

test("029A keeps the fixture as expected data and never imports or injects it", async () => {
  const source = await readFile(new URL("../../scripts/mlp-product-compose.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import-canonical-url-attack-recording|--recording|INSERT\s+INTO|psql/i);
  assert.doesNotMatch(source, /NODE_ENV["']?\s*:\s*["']test|test adapter/i);
});

test("029A proves exact public shell and template fixture through Caddy", async () => {
  const source = await readFile(new URL("../../scripts/mlp-product-compose.mjs", import.meta.url), "utf8");
  assert.match(source, /\/api\/v1\/templates/);
  assert.match(source, /\/api\/v1\/templates\/open-meteo-current-weather/);
  assert.match(source, /\/templates\/open-meteo-current-weather/);
  assert.match(source, /https:\/\/127\.0\.0\.1/);
});

test("029A product gate has exact scoped Compose and temporary cleanup", async () => {
  const source = await readFile(new URL("../../scripts/mlp-product-compose.mjs", import.meta.url), "utf8");
  assert.match(source, /down/);
  assert.match(source, /--volumes/);
  assert.match(source, /--remove-orphans/);
  assert.match(source, /com\.docker\.compose\.project/);
  assert.match(source, /recursive:\s*true/);
});

test("029A materializes a private canonical worker handoff for Compose interpolation", async () => {
  const source = await readFile(new URL("../../scripts/mlp-product-compose.mjs", import.meta.url), "utf8");
  assert.match(source, /canonicalSerializeSafeConsumerRegistry/);
  assert.match(source, /PROOFLINE_SAFE_CONSUMER_WORKER_HANDOFF_FILE:\s*paths\.safeConsumerWorkerHandoff/);
  assert.match(source, /safeConsumerWorkerHandoff[\s\S]*mode:\s*0o400/);
  assert.doesNotMatch(source, /PROOFLINE_SAFE_CONSUMER_ADDRESS/);
});

test("029A removes failed fixture and generated secrets even when Compose cleanup fails", async () => {
  const module = await runtime();
  assert.equal(typeof module.runRecordedProductLifecycle, "function");
  const parent = await mkdtemp(join(tmpdir(), "proofline-029a-product-cleanup-"));
  const temporaryDirectory = join(parent, "private-runtime");
  const fixtureOutput = join(parent, "recorded-product-fixture.v1.json");
  await mkdir(temporaryDirectory, { mode: 0o700 });
  await writeFile(join(temporaryDirectory, "generated-database-secret"), "private", { mode: 0o600 });
  await writeFile(fixtureOutput, "non-pass", { mode: 0o600 });
  const phases = [];
  const composeFailure = new Error("compose-down-failed");
  try {
    const error = await module.runRecordedProductLifecycle({
      execute: async () => { phases.push("execute"); },
      cleanupCompose: async () => { phases.push("compose"); throw composeFailure; },
      inspectResidue: async () => { phases.push("inspect"); return []; },
      removeTemporary: async () => { phases.push("temporary"); await rm(temporaryDirectory, { recursive: true }); },
      removeFailedFixture: async () => { phases.push("fixture"); await rm(fixtureOutput); },
    }).catch((cause) => cause);
    assert.equal(error, composeFailure);
    assert.deepEqual(phases, ["execute", "compose", "inspect", "temporary", "fixture"]);
    await assert.rejects(() => lstat(temporaryDirectory), { code: "ENOENT" });
    await assert.rejects(() => lstat(fixtureOutput), { code: "ENOENT" });
  } finally {
    await chmod(parent, 0o700).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});
