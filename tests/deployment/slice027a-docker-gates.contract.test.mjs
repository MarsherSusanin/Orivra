import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function source(path) {
  return readFile(resolve(root, path), "utf8").catch(() => "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const lockedImages = Object.freeze([
  {
    name: "node",
    repository: "node",
    tag: "22.14.0-bookworm-slim",
    indexDigest: "sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b",
    linuxAmd64Digest: "sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de",
  },
  {
    name: "caddy",
    repository: "caddy",
    tag: "2.10.2-alpine",
    indexDigest: "sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d",
    linuxAmd64Digest: "sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83",
  },
  {
    name: "postgres",
    repository: "postgres",
    tag: "17.6-alpine",
    indexDigest: "sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94",
    linuxAmd64Digest: "sha256:747d5ed1fdeeb124b880fbe3d7c6557d2c4064ae41d6b6297d417882effce4be",
  },
  {
    name: "postgresRecovery",
    repository: "postgres",
    tag: "17.6-bookworm",
    indexDigest: "sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3",
    linuxAmd64Digest: "sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3",
  },
  {
    name: "minio",
    repository: "minio/minio",
    tag: "RELEASE.2025-09-07T16-13-09Z",
    indexDigest: "sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e",
    linuxAmd64Digest: "sha256:a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2",
  },
  {
    name: "minioClient",
    repository: "minio/mc",
    tag: "RELEASE.2025-08-13T08-35-41Z",
    indexDigest: "sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727",
    linuxAmd64Digest: "sha256:eb4ea9884b77704230e2423e9004d2fa738dc272876b9cc41a297d29443b8780",
  },
]);

const lockedImageLock = Object.freeze({
  version: "1",
  platform: "linux/amd64",
  images: Object.fromEntries(lockedImages.map(({ name, ...image }) => [name, image])),
});

const lockedDigestOutput = lockedImages.flatMap(({ indexDigest, linuxAmd64Digest }) => [
  indexDigest,
  linuxAmd64Digest,
]).join("\\n");

async function importOptional(path) {
  return import(`${pathToFileURL(resolve(root, path)).href}?contract=${Date.now()}`)
    .catch(() => ({}));
}

async function fakeDocker(directory, { fail = false } = {}) {
  const executable = join(directory, fail ? "docker-fail" : "docker-ok");
  const log = join(directory, fail ? "docker-fail.jsonl" : "docker-ok.jsonl");
  const script = `#!/usr/bin/env node
import { appendFileSync, readFileSync, statSync } from "node:fs";
const configuration = process.env.DOCKER_CONFIG;
let configJson = null;
let configMode = null;
try {
  configJson = readFileSync(configuration + "/config.json", "utf8").trim();
  configMode = statSync(configuration).mode & 0o777;
} catch {}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  args: process.argv.slice(2),
  dockerConfig: configuration,
  dockerAuthConfig: process.env.DOCKER_AUTH_CONFIG,
  registryAuthFile: process.env.REGISTRY_AUTH_FILE,
  home: process.env.HOME,
  xdgConfigHome: process.env.XDG_CONFIG_HOME,
  dockerHost: process.env.DOCKER_HOST,
  dockerContext: process.env.DOCKER_CONTEXT,
  ghcrToken: process.env.GHCR_TOKEN,
  npmToken: process.env.NPM_TOKEN,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  verifierKey: process.env.PROOFLINE_VERIFIER_API_KEY,
  replayBootstrapStageRoot: process.env.PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT,
  configJson,
  configMode,
}) + "\\n");
if (process.argv[2] === "buildx") process.stdout.write(${JSON.stringify(lockedDigestOutput)});
if (${JSON.stringify(fail)}) process.exit(41);
`;
  await writeFile(executable, script);
  await chmod(executable, 0o700);
  return { executable, log };
}

async function readJsonLines(path) {
  const value = await readFile(path, "utf8");
  return value.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function ambientDockerEnvironment(directory) {
  const home = join(directory, "sentinel-home");
  const dockerConfig = join(directory, "sentinel-docker-config");
  const xdgConfigHome = join(directory, "sentinel-xdg-config");
  await mkdir(join(home, ".docker"), { recursive: true });
  await mkdir(dockerConfig, { recursive: true });
  await mkdir(xdgConfigHome, { recursive: true });
  const sentinel = JSON.stringify({
    auths: { "registry.invalid": { auth: "sentinel-auth" } },
    credsStore: "sentinel-helper",
  });
  await writeFile(join(home, ".docker", "config.json"), sentinel);
  await writeFile(join(dockerConfig, "config.json"), sentinel);
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfigHome,
    DOCKER_CONFIG: dockerConfig,
    DOCKER_AUTH_CONFIG: sentinel,
    REGISTRY_AUTH_FILE: join(directory, "sentinel-registry-auth.json"),
    DOCKER_HOST: "tcp://ambient-docker.invalid:2376",
    DOCKER_CONTEXT: "sentinel-context",
    GHCR_TOKEN: "sentinel-ghcr-token",
    NPM_TOKEN: "sentinel-npm-token",
    AWS_SECRET_ACCESS_KEY: "sentinel-aws-secret",
    PROOFLINE_VERIFIER_API_KEY: "sentinel-verifier-key",
  };
}

test("exposes separate static, controlled-prefetch and real Docker gates", async () => {
  const packageJson = JSON.parse(await source("package.json"));
  assert.equal(
    packageJson.scripts?.["test:docker:static"],
    "node --test --test-concurrency=1 tests/deployment/*.contract.test.mjs",
  );
  assert.equal(packageJson.scripts?.["docker:prefetch"], "node scripts/docker-prefetch.mjs");
  assert.equal(packageJson.scripts?.["test:docker"], "node scripts/docker-gate.mjs");
  assert.equal(packageJson.scripts?.["compose:production"], "node scripts/compose-production.mjs");
});

test("prefetches and validates only the six exact locked official identities", async () => {
  const script = await source("scripts/docker-prefetch.mjs");
  const lock = JSON.parse(await source("docker/base-images.json"));
  assert.notEqual(script, "", "scripts/docker-prefetch.mjs must exist");
  assert.deepEqual(lock, lockedImageLock);
  assert.match(script, /docker\/base-images\.json/);
  assert.match(script, /linux\/amd64/);
  assert.match(script, /buildx["',\s]+imagetools["',\s]+inspect|manifest["',\s]+inspect/i);
  assert.match(script, /sha256:/);
  for (const { name } of lockedImages) assert.match(script, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(script, /docker["',\s]+login|ghcr|credential|PROOFLINE_.*(?:TOKEN|KEY)/i);
  assert.doesNotMatch(script, /latest|:\s*22\b|:\s*2\.10\b|:\s*17\b/);
});

test("isolates every registry-capable prefetch child from ambient Docker credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027a-prefetch-contract-"));
  try {
    const orchestration = await importOptional("scripts/docker-prefetch-orchestration.mjs");
    assert.equal(
      typeof orchestration.runDockerPrefetch,
      "function",
      "prefetch must expose pure injectable orchestration",
    );
    const fake = await fakeDocker(directory);
    const environment = await ambientDockerEnvironment(directory);
    await orchestration.runDockerPrefetch({
      dockerExecutable: fake.executable,
      environment,
      lock: lockedImageLock,
    });

    const records = await readJsonLines(fake.log);
    const inspections = records.filter(({ args }) =>
      args[0] === "buildx" && args[1] === "imagetools" && args[2] === "inspect");
    assert.deepEqual(
      inspections.map(({ args }) => args[3]),
      lockedImages.map(({ repository, tag }) => `${repository}:${tag}`),
    );
    const pulls = records.filter(({ args }) => args[0] === "pull");
    assert.deepEqual(
      pulls.map(({ args }) => args),
      lockedImages.map(({ repository, linuxAmd64Digest }) => [
        "pull",
        "--platform",
        "linux/amd64",
        `${repository}@${linuxAmd64Digest}`,
      ]),
    );
    const networkChildren = records.filter(({ args }) =>
      args[0] === "pull" || args[0] === "build" ||
      (args[0] === "buildx" && args[1] === "imagetools"));
    assert.equal(networkChildren.length, 13, "six inspect, six pull and one dependency-build calls must be observed");
    const isolatedConfigs = new Set();
    for (const child of networkChildren) {
      isolatedConfigs.add(child.dockerConfig);
      assert.notEqual(child.dockerConfig, environment.DOCKER_CONFIG);
      assert.equal(child.configMode, 0o700);
      assert.equal(child.configJson, '{"auths":{}}');
      assert.equal(child.dockerAuthConfig, undefined);
      assert.equal(child.registryAuthFile, undefined);
      assert.notEqual(child.home, environment.HOME);
      assert.notEqual(child.xdgConfigHome, environment.XDG_CONFIG_HOME);
      assert.equal(child.dockerHost, undefined);
      assert.equal(child.dockerContext, undefined);
      assert.equal(child.ghcrToken, undefined);
      assert.equal(child.npmToken, undefined);
      assert.equal(child.awsSecretAccessKey, undefined);
      assert.equal(child.verifierKey, undefined);
    }
    assert.equal(isolatedConfigs.size, 1, "one invocation owns one fresh Docker CLI config");
    await assert.rejects(access([...isolatedConfigs][0]), "temporary Docker CLI config must be removed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes the isolated Docker CLI configuration when prefetch fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027a-prefetch-failure-"));
  try {
    const orchestration = await importOptional("scripts/docker-prefetch-orchestration.mjs");
    assert.equal(typeof orchestration.runDockerPrefetch, "function");
    const fake = await fakeDocker(directory, { fail: true });
    const environment = await ambientDockerEnvironment(directory);
    await assert.rejects(orchestration.runDockerPrefetch({
      dockerExecutable: fake.executable,
      environment,
      lock: lockedImageLock,
    }));
    const records = await readJsonLines(fake.log);
    assert.ok(records[0]?.dockerConfig);
    await assert.rejects(access(records[0].dockerConfig));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validates immutable production image references before any Compose effect", async () => {
  const productionCompose = await importOptional("scripts/compose-production.mjs");
  assert.equal(typeof productionCompose.validateProductionImageReference, "function");
  assert.equal(typeof productionCompose.runProductionCompose, "function");
  const digest = "a".repeat(64);
  for (const valid of [
    `proofline/web@sha256:${digest}`,
    `registry.example/proofline/web@sha256:${digest}`,
    `registry.example:5000/team/proofline.web@sha256:${digest}`,
  ]) {
    assert.equal(productionCompose.validateProductionImageReference(valid), valid);
  }
  for (const invalid of [
    "proofline/web:latest",
    "proofline/web:027a-qa",
    `Proofline/web@sha256:${digest}`,
    `proofline/web@sha256:${"a".repeat(63)}`,
    `proofline/web@sha256:${"A".repeat(64)}`,
    `proofline/web@sha256:${digest}extra`,
    `https://registry.example/proofline/web@sha256:${digest}`,
    `proofline//web@sha256:${digest}`,
    ` proofline/web@sha256:${digest}`,
  ]) {
    assert.throws(() => productionCompose.validateProductionImageReference(invalid));
  }

  const directory = await mkdtemp(join(tmpdir(), "proofline-027a-compose-policy-"));
  try {
    const fake = await fakeDocker(directory);
    const baseEnvironment = {
      PATH: process.env.PATH,
      PROOFLINE_CADDY_IMAGE: `proofline/caddy@sha256:${digest}`,
      PROOFLINE_WEB_IMAGE: `proofline/web@sha256:${digest}`,
      PROOFLINE_PUBLIC_ORIGIN: "https://proofline.example",
    };
    await productionCompose.runProductionCompose({
      composeArguments: ["config", "--services"],
      dockerExecutable: fake.executable,
      environment: baseEnvironment,
      runtime: false,
    });
    let records = await readJsonLines(fake.log);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].args.slice(0, 3), ["compose", "--file", "compose.yaml"]);
    assert.ok(!records[0].args.includes("deploy/compose.runtime.yaml"));

    const beforeInvalid = records.length;
    await assert.rejects(productionCompose.runProductionCompose({
      composeArguments: ["config"],
      dockerExecutable: fake.executable,
      environment: { ...baseEnvironment, PROOFLINE_WEB_IMAGE: "proofline/web:latest" },
      runtime: false,
    }));
    await assert.rejects(productionCompose.runProductionCompose({
      composeArguments: ["config"],
      dockerExecutable: fake.executable,
      environment: {
        ...baseEnvironment,
        PROOFLINE_API_IMAGE: "proofline/api:latest",
        PROOFLINE_WORKER_IMAGE: `proofline/worker@sha256:${digest}`,
      },
      runtime: true,
    }));
    await assert.rejects(productionCompose.runProductionCompose({
      composeArguments: ["--file", "deploy/compose.qa.yaml", "config"],
      dockerExecutable: fake.executable,
      environment: baseEnvironment,
      runtime: false,
    }));
    records = await readJsonLines(fake.log);
    assert.equal(records.length, beforeInvalid, "invalid production input must fail before Docker");

    await productionCompose.runProductionCompose({
      composeArguments: ["config"],
      dockerExecutable: fake.executable,
      environment: {
        ...baseEnvironment,
        PROOFLINE_API_IMAGE: `proofline/api@sha256:${digest}`,
        PROOFLINE_WORKER_IMAGE: `proofline/worker@sha256:${digest}`,
      },
      runtime: true,
    });
    records = await readJsonLines(fake.log);
    assert.ok(records.at(-1).args.includes("deploy/compose.runtime.yaml"));
    assert.equal(records.at(-1).replayBootstrapStageRoot, "/opt/orivra/replay-bootstrap-stage");

    const beforeCallerReplayAuthority = records.length;
    await assert.rejects(productionCompose.runProductionCompose({
      composeArguments: ["config"],
      dockerExecutable: fake.executable,
      environment: {
        ...baseEnvironment,
        PROOFLINE_API_IMAGE: `proofline/api@sha256:${digest}`,
        PROOFLINE_WORKER_IMAGE: `proofline/worker@sha256:${digest}`,
        PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: "/tmp/caller-selected",
      },
      runtime: true,
    }), /TIMEWEB_HOST_REPLAY_STAGE_INVALID/);
    records = await readJsonLines(fake.log);
    assert.equal(records.length, beforeCallerReplayAuthority, "caller replay-stage authority must fail before Docker");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("runs only the bounded exact-origin HTTPS Caddy/Web/PostgreSQL/API smoke", async () => {
  const script = await source("scripts/docker-smoke.mjs");
  assert.notEqual(script, "", "scripts/docker-smoke.mjs must exist");
  assert.match(script, /mkdtemp/);
  assert.match(script, /runQaSmokeLifecycle/);
  assert.match(script, /replay-bootstrap-stage/);
  assert.match(script, /PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT:\s*replayBootstrapStageRoot/);
  assert.match(script, /assertExactTlsPortAvailable/);
  assert.match(script, /PROOFLINE_PUBLIC_ORIGIN/);
  assert.match(script, /https:\/\/127\.0\.0\.1/);
  assert.doesNotMatch(script, /https:\/\/proofline\.invalid|http:\/\/127\.0\.0\.1/);
  assert.doesNotMatch(script, /randomLoopbackPort|PROOFLINE_QA_HTTP_PORT/);
  assert.match(
    script,
    /listen\(443,\s*["']127\.0\.0\.1["']/,
    "QA must fail closed before Compose when exact loopback TLS port 443 is unavailable",
  );
  assert.doesNotMatch(script, /(?:EADDRINUSE|EACCES)[\s\S]{0,120}(?:skip|return|pass)/i);
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
    "/api/v1/auth/wallet/challenges",
    "/assets/missing.js",
  ]) {
    assert.match(script, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(script, /docker["',\s]+inspect|compose["',\s]+ps/i);
  assert.match(script, /docker\.sock/);
  assert.match(script, /HostIp/);
  assert.match(script, /HostPort/);
  assert.match(script, /NetworkSettings/);
  assert.match(script, /Mounts/);
  assert.match(script, /requestLedger/);
  assert.match(script, /forbiddenHosts/);
  assert.match(script, /Access-Control-Request-Method/);
  assert.match(script, /Access-Control-Allow-Origin/);
  assert.match(script, /\bOPTIONS\b/);
  assert.match(script, /\bVary\b/);
  assert.match(script, /hostile/i);
  assert.match(
    script,
    /(?:allowed[\s\S]{0,320}(?:status[^\n]{0,80}204|===?\s*204)|(?:status[^\n]{0,80}204|===?\s*204)[\s\S]{0,320}allowed)/i,
    "exact-origin preflight must require 204",
  );
  assert.match(
    script,
    /(?:Access-Control-Allow-Origin[\s\S]{0,240}PROOFLINE_PUBLIC_ORIGIN|PROOFLINE_PUBLIC_ORIGIN[\s\S]{0,240}Access-Control-Allow-Origin)/,
    "allowed preflight must echo only the single public origin",
  );
  assert.match(
    script,
    /hostile[\s\S]{0,480}(?:denied|reject|Access-Control-Allow-Origin)/i,
    "hostile preflight must be denied without ACAO",
  );
  assert.match(
    script,
    /(?:HostIp[\s\S]{0,240}127\.0\.0\.1|127\.0\.0\.1[\s\S]{0,240}HostIp)/,
    "live inspection must bind Caddy to loopback",
  );
  assert.match(
    script,
    /(?:HostPort[\s\S]{0,240}["']443["']|["']443["'][\s\S]{0,240}HostPort)/,
    "live inspection must bind exact default HTTPS port 443",
  );
  assert.match(
    script,
    /(?:requestLedger[\s\S]{0,480}forbiddenHosts|forbiddenHosts[\s\S]{0,480}requestLedger)/,
    "forbidden-host checks must consume the runner ledger",
  );
  for (const host of [
    "api.open-meteo.com",
    "api.coinbase.com",
    "fdc-verifiers-testnet.flare.network",
    "coston2-api.flare.network",
  ]) {
    assert.match(script, new RegExp(host.replaceAll(".", "\\.")));
  }
  assert.match(script, /worker[\s\S]{0,160}(?:not start|absent|must not|unexpected)/i);
  assert.doesNotMatch(
    script,
    /PROOFLINE_(?:VERIFIER_API_KEY|COSTON2_PRIVATE_KEY|COSTON2_RPC_URL)/,
  );
  assert.doesNotMatch(script, /signMessage|personal_sign|eth_sign|wallet\.connect/i);
  assert.doesNotMatch(script, /healthz|readyz|live Coston2|deployed|hosted/i);
});

test("removes the QA temporary directory when secret setup fails before Compose", async () => {
  const orchestration = await importOptional("scripts/docker-smoke-orchestration.mjs");
  assert.equal(typeof orchestration.runQaSmokeLifecycle, "function");
  const directory = "/tmp/proofline-027a-setup-failure-sentinel";
  const setupFailure = new Error("injected secret write failure");
  const removed = [];
  let smokeCalls = 0;

  await assert.rejects(
    orchestration.runQaSmokeLifecycle({
      createTemporaryDirectory: async () => directory,
      prepareTemporaryDirectory: async (received) => {
        assert.equal(received, directory);
        throw setupFailure;
      },
      runSmoke: async () => {
        smokeCalls += 1;
      },
      removeTemporaryDirectory: async (received) => {
        removed.push(received);
      },
    }),
    (cause) => cause === setupFailure,
  );
  assert.equal(smokeCalls, 0, "Compose smoke must not start after secret setup fails");
  assert.deepEqual(removed, [directory]);
});

test("removes the QA temporary directory after success and after a smoke failure", async () => {
  const orchestration = await importOptional("scripts/docker-smoke-orchestration.mjs");
  assert.equal(typeof orchestration.runQaSmokeLifecycle, "function");
  const removed = [];
  const run = async (name, runSmoke) => orchestration.runQaSmokeLifecycle({
    createTemporaryDirectory: async () => `/tmp/${name}`,
    prepareTemporaryDirectory: async (directory) => ({ directory, prepared: true }),
    runSmoke,
    removeTemporaryDirectory: async (directory) => {
      removed.push(directory);
    },
  });

  assert.equal(await run("proofline-027a-success", async ({ directory, prepared }) => {
    assert.equal(directory, "/tmp/proofline-027a-success");
    assert.equal(prepared, true);
    return "complete";
  }), "complete");
  const smokeFailure = new Error("injected pre-compose failure");
  await assert.rejects(
    run("proofline-027a-smoke-failure", async () => { throw smokeFailure; }),
    (cause) => cause === smokeFailure,
  );
  assert.deepEqual(removed, [
    "/tmp/proofline-027a-success",
    "/tmp/proofline-027a-smoke-failure",
  ]);
});

test("attempts exact TLS port-probe removal after success and ambiguous Docker failure", async () => {
  const orchestration = await importOptional("scripts/docker-smoke-orchestration.mjs");
  assert.equal(typeof orchestration.assertExactTlsPortAvailable, "function");
  const eacces = Object.assign(new Error("privileged bind denied"), { code: "EACCES" });
  const removed = [];
  await orchestration.assertExactTlsPortAvailable({
    bindExactTlsPort: async () => { throw eacces; },
    startDockerReservation: async () => undefined,
    removeDockerReservation: async () => { removed.push("success"); },
  });

  const ambiguousFailure = new Error("Docker CLI lost the daemon response");
  await assert.rejects(
    orchestration.assertExactTlsPortAvailable({
      bindExactTlsPort: async () => { throw eacces; },
      startDockerReservation: async () => { throw ambiguousFailure; },
      removeDockerReservation: async () => {
        removed.push("failure");
        throw Object.assign(new Error("reservation already absent"), { code: "ENOENT" });
      },
    }),
    (cause) => cause === ambiguousFailure,
  );
  assert.deepEqual(removed, ["success", "failure"]);

  let dockerCalls = 0;
  const occupied = Object.assign(new Error("port occupied"), { code: "EADDRINUSE" });
  await assert.rejects(
    orchestration.assertExactTlsPortAvailable({
      bindExactTlsPort: async () => { throw occupied; },
      startDockerReservation: async () => { dockerCalls += 1; },
      removeDockerReservation: async () => { dockerCalls += 1; },
    }),
    (cause) => cause === occupied,
  );
  assert.equal(dockerCalls, 0, "only EACCES may use the Docker port reservation fallback");
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

test("keeps protected Sites bytes unchanged and permits only the frozen 029D browser dependency lock", async () => {
  const protectedSites = {
    ".openai/hosting.json": "d532abb65cf9ae20634b464d954cb4a08a0de9f3cd3cdf7f9c3ec8948826d947",
    "worker/index.js": "ed70aece7c28dae1af8445b33cc855289fce753e4207cfa43a2aafcd6c42156c",
    "scripts/prepare-sites-build.mjs": "b6a6adaa4fab3234676116dd1c9cb6611275ab9d92dd26f5bf402393e3744bf6",
    "tests/sites-worker.test.mjs": "96af7b48906c6460c793356d7b6952f7d5026dbf5a502bec0d9297ff04201c26",
  };
  for (const [path, digest] of Object.entries(protectedSites)) {
    assert.equal(sha256(await readFile(resolve(root, path))), digest, `${path} changed`);
  }
  const [packageText, lockBytes] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "package-lock.json")),
  ]);
  const packageJson = JSON.parse(packageText);
  const lock = JSON.parse(lockBytes.toString("utf8"));
  assert.equal(packageJson.devDependencies?.["playwright-core"], "^1.62.1");
  assert.equal(packageJson.dependencies?.["playwright-core"], undefined);
  assert.equal(lock.packages?.[""]?.devDependencies?.["playwright-core"], "^1.62.1");
  assert.deepEqual(Object.keys(lock.packages).filter((path) => /(?:^|\/)playwright(?:-core)?$/.test(path)), [
    "node_modules/playwright-core",
  ]);
  assert.deepEqual(lock.packages["node_modules/playwright-core"], {
    version: "1.62.1",
    resolved: "https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.1.tgz",
    integrity: "sha512-wPYSwEBJY9GHraISXqyqtx0na0LpO3XEX7jNDhntbex7tzUS7kLnZsOlFruFJB4Hi/rhDMjXGqHewDZ68nYZVw==",
    dev: true,
    license: "Apache-2.0",
    bin: { "playwright-core": "cli.js" },
    engines: { node: ">=20" },
  });
  assert.equal(sha256(lockBytes), "2d45697a041b8bbc4c91b76c645cf5749a0f8e9293741c9a980ece95dc204896");
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
