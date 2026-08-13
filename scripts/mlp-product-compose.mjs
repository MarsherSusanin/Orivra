import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createRecordedProductFixture,
  createRecordedProductObservation,
  runRecordedProductLifecycle,
  verifyRecordedProductObservation,
} from "./mlp-product-compose-runtime.mjs";
import { canonicalSerializeSafeConsumerRegistry } from "../packages/contracts/src/safe-consumer-registry-runtime.mjs";
import { assertExactTlsPortAvailable } from "./docker-smoke-orchestration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = `proofline-029a-${process.pid}-${randomBytes(4).toString("hex")}`;
const publicOrigin = "https://127.0.0.1";
const portReservation = `${project}-port-check`;
const publicProductPaths = Object.freeze({
  catalog: "/api/v1/templates",
  detail: "/api/v1/templates/open-meteo-current-weather",
  product: "/templates/open-meteo-current-weather",
});

function fail(message = "Recorded product Compose gate failed") {
  throw new Error(message);
}

function parseArguments(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--fixture-output" ||
    !isAbsolute(arguments_[1]) || arguments_[1].includes("\0")) {
    fail("Usage: test:docker:product -- --fixture-output <absolute-path>");
  }
  return arguments_[1];
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function docker(arguments_, environment, capture = false) {
  const result = spawnSync("docker", arguments_, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) fail(`Recorded product Docker phase failed (${arguments_.at(-1)})`);
  return result.stdout ?? "";
}

function compose(arguments_, environment, capture = false) {
  return docker([
    "compose",
    "--project-name", project,
    "--file", "compose.yaml",
    "--file", "deploy/compose.runtime.yaml",
    "--file", "deploy/compose.qa.yaml",
    ...arguments_,
  ], environment, capture);
}

function parseComposePs(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function request(path) {
  return new Promise((resolvePromise, reject) => {
    const operation = httpsRequest(new URL(path, publicOrigin), {
      method: "GET",
      rejectUnauthorized: false,
      timeout: 2_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    operation.once("timeout", () => operation.destroy(new Error("Recorded product request timed out")));
    operation.once("error", reject);
    operation.end();
  });
}

async function waitFor(path) {
  let outcome;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await request(path);
      if (response.status === 200) return response;
      outcome = `status ${response.status}`;
    } catch (cause) {
      outcome = String(cause?.code ?? cause?.name ?? "request error");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(`Recorded product route unavailable (${outcome ?? "no response"})`);
}

async function bindExactTlsPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(443, "127.0.0.1", () => server.close((cause) =>
      cause ? reject(cause) : resolvePromise()));
  });
}

function startDockerReservation(environment) {
  docker([
    "run", "--detach", "--rm", "--pull", "never", "--name", portReservation,
    "--publish", "127.0.0.1:443:443", "--entrypoint", "/bin/sh",
    "proofline/caddy:027a-qa", "-c", "sleep 10",
  ], environment, true);
}

function removeDockerReservation(environment) {
  const result = spawnSync("docker", ["rm", "--force", portReservation], {
    cwd: root, env: environment, encoding: "utf8", stdio: "pipe",
  });
  if (result.status !== 0 && !/no such container/i.test(result.stderr ?? "")) fail();
}

async function createEnvironment(temporaryDirectory) {
  const password = randomBytes(24).toString("hex");
  const values = {
    postgresAdminDatabase: `postgres://proofline:${password}@postgres:5432/proofline`,
    apiDatabase: `postgres://proofline_api_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    migratorDatabase: `postgres://proofline_migrator_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    recordingDatabase: `postgres://proofline_recording_importer_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    workerDatabase: `postgres://proofline_worker_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    apiDigest: randomBytes(32).toString("hex"),
    replayBundle: "{}",
    replayPreflight: "{}",
    postgresPassword: password,
  };
  const paths = {};
  for (const [name, value] of Object.entries(values)) {
    const path = join(temporaryDirectory, name);
    await writeFile(path, value, { mode: 0o600, flag: "wx" });
    paths[name] = path;
  }
  paths.safeConsumerWorkerHandoff = join(temporaryDirectory, "safe-consumer-registry.v1.json");
  await writeFile(paths.safeConsumerWorkerHandoff, canonicalSerializeSafeConsumerRegistry({
    version: "1",
    kind: "safe-consumer-registry",
    chainId: 114,
    entries: [
      {
        templateId: "open-meteo-current-weather",
        revision: 1,
        manifestSha256: "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898",
        consumerAddress: "0x1111111111111111111111111111111111111111",
      },
      {
        templateId: "eth-usd",
        revision: 1,
        manifestSha256: "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db",
        consumerAddress: "0x2222222222222222222222222222222222222222",
      },
    ],
  }), { mode: 0o400, flag: "wx" });
  paths.replayBootstrapStage = join(temporaryDirectory, "replay-bootstrap-stage");
  await mkdir(paths.replayBootstrapStage, { mode: 0o700 });
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (git.status !== 0 || !/^[a-f0-9]{40}\n?$/.test(git.stdout ?? "")) fail();
  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost !== undefined && !/^unix:\/\/[A-Za-z0-9_./-]+$/.test(dockerHost)) fail();
  const ambient = Object.fromEntries([
    "CI", "DOCKER_CONFIG", "HOME", "LANG", "LC_ALL", "NODE_ENV", "PATH",
    "PROOFLINE_TESTCONTAINERS", "TMPDIR", "TZ", "XDG_CONFIG_HOME",
  ].flatMap((name) => typeof process.env[name] === "string" ? [[name, process.env[name]]] : []));
  return {
    ...ambient,
    ...(dockerHost ? { DOCKER_HOST: dockerHost } : {}),
    PROOFLINE_CADDY_IMAGE: "proofline/caddy:027a-qa",
    PROOFLINE_WEB_IMAGE: "proofline/web:027a-qa",
    PROOFLINE_API_IMAGE: "proofline/api:027a-qa",
    PROOFLINE_WORKER_IMAGE: "proofline/worker:027a-qa",
    PROOFLINE_PUBLIC_ORIGIN: publicOrigin,
    PROOFLINE_DEPLOYMENT_ID: `deployment_${randomBytes(32).toString("hex")}`,
    PROOFLINE_RELEASE_TREE_SHA: git.stdout.trim(),
    PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE: paths.postgresAdminDatabase,
    PROOFLINE_API_DATABASE_URL_FILE: paths.apiDatabase,
    PROOFLINE_MIGRATOR_DATABASE_URL_FILE: paths.migratorDatabase,
    PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: paths.recordingDatabase,
    PROOFLINE_WORKER_DATABASE_URL_FILE: paths.workerDatabase,
    PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: paths.apiDigest,
    PROOFLINE_WORKER_REPLAY_BUNDLE_FILE: paths.replayBundle,
    PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE: paths.replayPreflight,
    PROOFLINE_POSTGRES_PASSWORD_FILE: paths.postgresPassword,
    PROOFLINE_SAFE_CONSUMER_WORKER_HANDOFF_FILE: paths.safeConsumerWorkerHandoff,
    PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: paths.replayBootstrapStage,
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000000000000000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
  };
}

async function main() {
  const fixtureOutput = parseArguments(process.argv.slice(2));
  const fixtureBytes = await createRecordedProductFixture();
  await writeFile(fixtureOutput, fixtureBytes, { mode: 0o600, flag: "wx" });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), `${project}-`));
  const environment = await createEnvironment(temporaryDirectory);
  await runRecordedProductLifecycle({
    execute: async () => {
      await assertExactTlsPortAvailable({
        bindExactTlsPort,
        startDockerReservation: () => startDockerReservation(environment),
        removeDockerReservation: () => removeDockerReservation(environment),
      });
      compose([
        "up", "--detach", "--pull", "never", "--no-build", "caddy", "web", "postgres", "api",
      ], environment);
      const fixture = JSON.parse(fixtureBytes.toString("utf8"));
      if (fixture.template.apiCatalogPath !== publicProductPaths.catalog ||
        fixture.template.apiDetailPath !== publicProductPaths.detail ||
        fixture.template.productPath !== publicProductPaths.product) fail();
      const [landing, catalogResponse, detailResponse, routeResponse] = await Promise.all([
        waitFor(fixture.landing.route),
        waitFor(fixture.template.apiCatalogPath),
        waitFor(fixture.template.apiDetailPath),
        waitFor(fixture.template.productPath),
      ]);
      const catalog = JSON.parse(catalogResponse.body);
      const detail = JSON.parse(detailResponse.body);
      if (!landing.body.includes(`<title>${fixture.landing.documentTitle}</title>`) ||
        !routeResponse.body.includes(`<title>${fixture.landing.documentTitle}</title>`) ||
        catalog.templates?.[0]?.id !== fixture.template.id ||
        detail.template?.id !== fixture.template.id) fail();
      const entries = parseComposePs(compose(["ps", "--format", "json"], environment, true));
      const services = entries.map((entry) => entry.Service).filter(Boolean).sort();
      verifyRecordedProductObservation({
        services,
        origin: publicOrigin,
        fixtureSha256: sha256(fixtureBytes),
      });
      await chmod(fixtureOutput, 0o400);
      process.stdout.write(`${JSON.stringify(createRecordedProductObservation({
        fixtureSha256: sha256(fixtureBytes),
      }))}\n`);
    },
    cleanupCompose: async () => compose(["down", "--volumes", "--remove-orphans"], environment),
    inspectResidue: async () => {
      const leftovers = [
        docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
        docker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
        docker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
      ].join("").trim();
      if (leftovers) fail("Recorded product Compose cleanup is incomplete");
    },
    removeTemporary: async () => rm(temporaryDirectory, { recursive: true, force: true }),
    removeFailedFixture: async () => rm(fixtureOutput, { force: true }),
  });
}

main().catch(() => {
  process.stderr.write("Recorded product Compose gate failed\n");
  process.exitCode = 1;
});
