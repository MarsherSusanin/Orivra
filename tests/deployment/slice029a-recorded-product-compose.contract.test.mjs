import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    mode: "runtime-verified-recorded-fixture",
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

test("029A imports the fixture through the least-privilege production importer", async () => {
  const source = await readFile(new URL("../../scripts/mlp-product-compose.mjs", import.meta.url), "utf8");
  assert.match(source, /import-canonical-url-attack-recording\.js/);
  assert.match(source, /recording_importer_database_url/);
  assert.match(source, /proofline_recording_importer_login/);
  assert.doesNotMatch(source, /NODE_ENV["']?\s*:\s*["']test/);
});

test("029A proves exact public summary and recording download through Caddy", async () => {
  const source = await readFile(new URL("../../scripts/mlp-product-compose.mjs", import.meta.url), "utf8");
  assert.match(source, /\/api\/v1\/demo\/canonical-url\/summary/);
  assert.match(source, /\/api\/v1\/demo\/canonical-url\/recording/);
  assert.match(source, /recordingSha256/);
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
