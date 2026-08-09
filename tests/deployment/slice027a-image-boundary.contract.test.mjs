import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const paths = {
  lock: "docker/base-images.json",
  appDockerfile: "docker/Dockerfile",
  caddyDockerfile: "docker/caddy.Dockerfile",
  webServer: "docker/web-server.mjs",
  dockerignore: ".dockerignore",
  gitignore: ".gitignore",
};

async function source(path) {
  return readFile(resolve(root, path), "utf8").catch(() => "");
}

const expectedLock = {
  version: "1",
  platform: "linux/amd64",
  images: {
    node: {
      repository: "node",
      tag: "22.14.0-bookworm-slim",
      indexDigest: "sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b",
      linuxAmd64Digest: "sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de",
    },
    caddy: {
      repository: "caddy",
      tag: "2.10.2-alpine",
      indexDigest: "sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d",
      linuxAmd64Digest: "sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83",
    },
    postgres: {
      repository: "postgres",
      tag: "17.6-alpine",
      indexDigest: "sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94",
      linuxAmd64Digest: "sha256:747d5ed1fdeeb124b880fbe3d7c6557d2c4064ae41d6b6297d417882effce4be",
    },
  },
};

test("locks the exact official index and Linux/amd64 base-image identities", async () => {
  const raw = await source(paths.lock);
  assert.notEqual(raw, "", `${paths.lock} must exist`);
  assert.deepEqual(JSON.parse(raw), expectedLock);
});

test("uses only exact Linux/amd64 manifest digests in application FROM lines", async () => {
  const dockerfile = await source(paths.appDockerfile);
  assert.notEqual(dockerfile, "", `${paths.appDockerfile} must exist`);
  const fromLines = dockerfile.split("\n").filter((line) => /^FROM\s/i.test(line));
  assert.ok(fromLines.length >= 4, "multi-target Dockerfile must have explicit build/runtime stages");
  for (const line of fromLines) {
    assert.match(line, /^FROM --platform=linux\/amd64 node@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de\b/i);
    assert.doesNotMatch(line, /22(?:\b|:)|latest|bookworm-slim@sha256:1c18/i);
  }
});

test("provides exactly the Web, API and worker final application targets", async () => {
  const dockerfile = await source(paths.appDockerfile);
  const targets = [...dockerfile.matchAll(/^FROM\s+[^\n]+\s+AS\s+(web|api|worker)\s*$/gim)]
    .map((match) => match[1]).sort();
  assert.deepEqual(targets, ["api", "web", "worker"]);
  assert.match(dockerfile, /USER\s+(?:node|[1-9][0-9]*)/i);
  assert.doesNotMatch(dockerfile, /USER\s+root\b/i);
});

test("builds fresh artifacts without copying host dist, node_modules, Git or Sites runtime", async () => {
  const dockerfile = await source(paths.appDockerfile);
  assert.match(dockerfile, /npm\s+ci/i);
  assert.match(dockerfile, /package-lock\.json/);
  assert.doesNotMatch(dockerfile, /COPY\s+(?:\.\/)?(?:dist|node_modules|\.git)(?:\s|\/)/i);
  assert.doesNotMatch(dockerfile, /worker\/index\.js|\.openai\/hosting\.json|dist\/server\/index\.js/);
  assert.doesNotMatch(
    dockerfile,
    /^RUN\s+npm\s+run\s+build\s*(?:&&|$)/m,
    "Docker Web build must not invoke the root Sites wrapper",
  );
});

test("ships Web as only fresh client bytes plus the dependency-free static server", async () => {
  const [dockerfile, server] = await Promise.all([
    source(paths.appDockerfile),
    source(paths.webServer),
  ]);
  assert.match(dockerfile, /FROM[^\n]+AS\s+web[\s\S]*COPY[^\n]+dist\/client/i);
  assert.match(dockerfile, /web-server\.mjs/);
  assert.notEqual(server, "", `${paths.webServer} must exist`);
  assert.match(server, /node:http/);
  assert.match(server, /GET|HEAD/);
  assert.match(server, /404/);
  assert.match(server, /index\.html/);
  assert.doesNotMatch(server, /from\s+["'](?!node:)|require\s*\(/);
  assert.doesNotMatch(server, /\bfetch\s*\(|https?:\/\//i);
});

test("ships the API server and isolated importer authority with exact migration and Solidity inputs", async () => {
  const dockerfile = await source(paths.appDockerfile);
  for (const required of [
    "apps/api/dist/server.js",
    "apps/api/dist/import-canonical-url-attack-recording.js",
    "apps/api/db/migrations",
    "contracts/CanonicalSafeWeb2JsonConsumer.sol",
    "contracts/CanonicalVulnerableWeb2JsonConsumer.sol",
    "contracts/ProoflineUrlInvariant.sol",
  ]) {
    assert.match(dockerfile, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const apiStage = dockerfile.slice(dockerfile.search(/FROM[^\n]+AS\s+api/i));
  assert.match(apiStage, /CMD\s*\[\s*["']node["']\s*,\s*["'][^"']*server\.js["']/i);
  assert.doesNotMatch(apiStage.match(/CMD[^\n]*/i)?.[0] ?? "", /import-canonical/);
});

test("ships worker external pg and solc runtime without an HTTP port", async () => {
  const dockerfile = await source(paths.appDockerfile);
  const workerStage = dockerfile.slice(dockerfile.search(/FROM[^\n]+AS\s+worker/i));
  assert.match(workerStage, /apps\/worker\/dist\/worker\.js/);
  assert.match(workerStage, /(?:node_modules|npm)[\s\S]*(?:pg|solc)/i);
  assert.match(workerStage, /CMD\s*\[\s*["']node["']\s*,\s*["'][^"']*worker\.js["']/i);
  assert.doesNotMatch(workerStage, /EXPOSE|healthz|readyz/i);
});

test("pins the custom non-root Caddy image to the exact Linux/amd64 manifest", async () => {
  const dockerfile = await source(paths.caddyDockerfile);
  assert.match(
    dockerfile,
    /^FROM --platform=linux\/amd64 caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83\b/m,
  );
  assert.match(dockerfile, /USER\s+(?:caddy|[1-9][0-9]*)/i);
  assert.doesNotMatch(dockerfile, /latest|2\.10(?:\s|$)|USER\s+root/i);
});

test("excludes local artifacts, environment files and secret material from Git and Docker contexts", async () => {
  const [dockerignore, gitignore] = await Promise.all([
    source(paths.dockerignore),
    source(paths.gitignore),
  ]);
  for (const pattern of [".git", "node_modules", "dist", "coverage", ".env", "*.log"]) {
    assert.match(dockerignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/?$`, "m"));
  }
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});

test("never bakes deployment secrets, dummy credentials or a production test adapter", async () => {
  const aggregate = [
    await source(paths.appDockerfile),
    await source(paths.caddyDockerfile),
  ].join("\n");
  assert.doesNotMatch(
    aggregate,
    /(?:ARG|ENV|COPY)[^\n]*(?:DATABASE_URL|TOKEN_DIGEST_KEY|VERIFIER_API_KEY|COSTON2_PRIVATE_KEY|project_|share_)/i,
  );
  assert.doesNotMatch(aggregate, /dummy|fixture|test-system|synthetic/i);
  assert.doesNotMatch(aggregate, /\/var\/run\/docker\.sock|\/run\/docker\.sock/);
});
