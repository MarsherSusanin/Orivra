import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function source(path) {
  return readFile(resolve(root, path), "utf8").catch(() => "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("exposes separate static, controlled-prefetch and real Docker gates", async () => {
  const packageJson = JSON.parse(await source("package.json"));
  assert.equal(
    packageJson.scripts?.["test:docker:static"],
    "node --test tests/deployment/*.contract.test.mjs",
  );
  assert.equal(packageJson.scripts?.["docker:prefetch"], "node scripts/docker-prefetch.mjs");
  assert.equal(packageJson.scripts?.["test:docker"], "node scripts/docker-gate.mjs");
});

test("prefetches and validates only the three exact locked official identities", async () => {
  const script = await source("scripts/docker-prefetch.mjs");
  assert.notEqual(script, "", "scripts/docker-prefetch.mjs must exist");
  assert.match(script, /docker\/base-images\.json/);
  assert.match(script, /linux\/amd64/);
  assert.match(script, /buildx["',\s]+imagetools["',\s]+inspect|manifest["',\s]+inspect/i);
  assert.match(script, /sha256:/);
  assert.match(script, /node|caddy|postgres/);
  assert.doesNotMatch(script, /docker["',\s]+login|ghcr|credential|PROOFLINE_.*(?:TOKEN|KEY)/i);
  assert.doesNotMatch(script, /latest|:\s*22\b|:\s*2\.10\b|:\s*17\b/);
});

test("builds every fresh Linux/amd64 target and repeats with no network or pull", async () => {
  const script = await source("scripts/docker-build.mjs");
  assert.notEqual(script, "", "scripts/docker-build.mjs must exist");
  for (const target of ["web", "api", "worker"]) {
    assert.match(script, new RegExp(`["']--target["'][\\s\\S]{0,80}["']${target}["']`));
  }
  assert.match(script, /docker\/caddy\.Dockerfile/);
  assert.match(script, /linux\/amd64/);
  assert.match(script, /--network["',\s]+none/);
  assert.match(script, /--pull["',\s]+false|pull_policy|pull["',\s]+never/i);
  assert.match(script, /npm[^\n]{0,120}offline|NPM_CONFIG_OFFLINE|--offline/i);
  assert.doesNotMatch(script, /docker["',\s]+pull|buildx["',\s]+imagetools|https?:\/\//i);
});

test("runs only the bounded loopback Caddy/Web/PostgreSQL/API smoke", async () => {
  const script = await source("scripts/docker-smoke.mjs");
  assert.notEqual(script, "", "scripts/docker-smoke.mjs must exist");
  assert.match(script, /mkdtemp/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /PROOFLINE_QA_HTTP_PORT/);
  assert.match(script, /--pull["',\s]+never/);
  assert.match(script, /--no-build/);
  assert.match(script, /["']caddy["'][\s\S]{0,80}["']web["'][\s\S]{0,80}["']postgres["'][\s\S]{0,80}["']api["']/);
  assert.doesNotMatch(script, /["']worker["'][\s,\]]*\)?\s*(?:;|\n)/, "QA up target must not include worker");
  for (const path of [
    "/",
    "/templates/open-meteo-current-weather",
    "/api/v1/templates",
    "/api/v1/templates?unexpected=1",
    "/api/api/v1/templates",
    "/api/not-a-route",
    "/assets/missing.js",
  ]) {
    assert.match(script, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(script, /docker["',\s]+inspect|compose["',\s]+ps/i);
  assert.match(script, /docker\.sock|HostPort|NetworkSettings|Mounts/);
  assert.doesNotMatch(script, /healthz|readyz|live Coston2|deployed|hosted/i);
});

test("binds cleanup to one validated project and removes only its temporary resources", async () => {
  const [gate, smoke] = await Promise.all([
    source("scripts/docker-gate.mjs"),
    source("scripts/docker-smoke.mjs"),
  ]);
  assert.match(gate, /docker-build\.mjs/);
  assert.match(gate, /docker-smoke\.mjs/);
  assert.match(smoke, /proofline-027a-[a-z0-9]/i);
  assert.match(smoke, /--project-name|-p/);
  assert.match(smoke, /down/);
  assert.match(smoke, /--volumes/);
  assert.match(smoke, /--remove-orphans/);
  assert.match(smoke, /rm\(/);
  assert.doesNotMatch(smoke, /docker["',\s]+system["',\s]+prune|docker["',\s]+volume["',\s]+prune|rm\s+-rf\s+(?:~|\/)/i);
});

test("keeps protected Sites and dependency-lock bytes unchanged", async () => {
  const expected = {
    ".openai/hosting.json": "d532abb65cf9ae20634b464d954cb4a08a0de9f3cd3cdf7f9c3ec8948826d947",
    "worker/index.js": "ed70aece7c28dae1af8445b33cc855289fce753e4207cfa43a2aafcd6c42156c",
    "scripts/prepare-sites-build.mjs": "b6a6adaa4fab3234676116dd1c9cb6611275ab9d92dd26f5bf402393e3744bf6",
    "tests/sites-worker.test.mjs": "96af7b48906c6460c793356d7b6952f7d5026dbf5a502bec0d9297ff04201c26",
    "package-lock.json": "5e5b73de922c84ce1f619b936b1b47160bab0f613f1824cefbbcdabe14912ccc",
  };
  for (const [path, digest] of Object.entries(expected)) {
    assert.equal(sha256(await readFile(resolve(root, path))), digest, `${path} changed`);
  }
});

test("documents that 027B and 027C gates cannot be fabricated by the 027A smoke", async () => {
  const [adr, slice, runbook] = await Promise.all([
    source("docs/adr/0035-credential-free-container-runtime-boundary.md"),
    source("docs/slices/027a-credential-free-container-runtime.md"),
    source("docs/runbook.md"),
  ]);
  const documentation = `${adr}\n${slice}\n${runbook}`;
  for (const pattern of [
    /027B[\s\S]{0,240}migration/i,
    /027B[\s\S]{0,320}\/healthz[\s\S]{0,120}\/readyz/i,
    /command[- ]lease heartbeat[\s\S]{0,180}not[\s\S]{0,120}deployment/i,
    /027C[\s\S]{0,240}WAL[\s\S]{0,160}base backup/i,
    /pg_dump[\s\S]{0,180}not[\s\S]{0,120}PITR/i,
    /Droplet snapshot|Droplet backup/i,
    /smoke[\s\S]{0,240}(?:no|never|not)[\s\S]{0,100}readiness/i,
  ]) {
    assert.match(documentation, pattern);
  }
});
