import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertExactTlsPortAvailable,
  runQaSmokeLifecycle,
} from "./docker-smoke-orchestration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = `proofline-027b-r${process.pid}-${randomBytes(4).toString("hex")}`;
if (!/^proofline-027b-[a-z0-9-]+$/.test(project)) {
  throw new Error("Invalid runtime QA project");
}

const portReservation = `${project}-port-check`;
const publicOrigin = "https://127.0.0.1";
const deploymentId = `deployment_${randomBytes(32).toString("hex")}`;
const releaseTreeSha = randomBytes(20).toString("hex");
const workerInstanceId = "027b027b-027b-427b-827b-027b027b027b";

function docker(args, environment, capture = false) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Runtime QA Docker command failed (${args.at(-1)})`);
  }
  return result.stdout ?? "";
}

function compose(arguments_, environment, capture = false) {
  return docker([
    "compose",
    "--project-name",
    project,
    "--file",
    "compose.yaml",
    "--file",
    "deploy/compose.runtime.yaml",
    "--file",
    "deploy/compose.qa.yaml",
    ...arguments_,
  ], environment, capture);
}

function bindExactTlsPort() {
  const server = createServer();
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(443, "127.0.0.1", () => {
      server.close((cause) => cause ? reject(cause) : resolvePromise());
    });
  });
}

function startDockerReservation() {
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    portReservation,
    "--publish",
    "127.0.0.1:443:443",
    "--entrypoint",
    "/bin/sh",
    "proofline/caddy:027a-qa",
    "-c",
    "sleep 10",
  ], process.env, true);
}

function removeDockerReservation() {
  const result = spawnSync("docker", ["rm", "--force", portReservation], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: "pipe",
  });
  if (result.status !== 0 && !/no such container/i.test(result.stderr ?? "")) {
    throw new Error("Runtime QA port reservation removal failed");
  }
}

async function request(path) {
  const target = new URL(`${publicOrigin}${path}`);
  return new Promise((resolvePromise, reject) => {
    const operation = httpsRequest(target, {
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
    operation.once("timeout", () => operation.destroy(new Error("Runtime QA request timed out")));
    operation.once("error", reject);
    operation.end();
  });
}

async function waitForResponse(path, expectedStatus, expectedBody) {
  let lastOutcome = "no response";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await request(path);
      if (response.status === expectedStatus && response.body === expectedBody) {
        return response;
      }
      lastOutcome = `status ${response.status}, body ${response.body}`;
    } catch (cause) {
      lastOutcome = `${String(cause?.code ?? cause?.name ?? "request error")}: ${String(cause?.message ?? "")}`;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Runtime QA route did not reach the expected response (${lastOutcome})`);
}

async function waitForPostgres(environment) {
  let lastOutcome = "no response";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = spawnSync("docker", [
      "compose",
      "--project-name",
      project,
      "--file",
      "compose.yaml",
      "--file",
      "deploy/compose.runtime.yaml",
      "--file",
      "deploy/compose.qa.yaml",
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "proofline",
      "-d",
      "proofline",
    ], {
      cwd: root,
      encoding: "utf8",
      env: environment,
      stdio: "pipe",
    });
    if (result.status === 0) return;
    lastOutcome = result.stderr || result.stdout || `status ${result.status}`;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Runtime QA PostgreSQL did not become healthy (${lastOutcome.trim()})`);
}

function parseComposePs(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForJob(name, environment) {
  let lastOutcome = "container absent";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const entries = parseComposePs(
      compose(["ps", "--all", "--format", "json", name], environment, true),
    );
    const entry = entries.find((candidate) => candidate.Service === name);
    if (entry?.State === "exited") {
      if (Number(entry.ExitCode) !== 0) {
        throw new Error(`${name} exited unsuccessfully`);
      }
      return;
    }
    lastOutcome = entry ? `${entry.State}/${entry.Status}` : "container absent";
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${name} did not complete (${lastOutcome})`);
}

function postgresSql(sql, environment) {
  return compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "proofline",
    "-d",
    "proofline",
    "-At",
    "-c",
    sql,
  ], environment, true).trim();
}

async function prepareTemporaryDirectory(temporaryDirectory) {
  const postgresPassword = randomBytes(24).toString("hex");
  const apiPassword = randomBytes(24).toString("hex");
  const migratorPassword = randomBytes(24).toString("hex");
  const importerPassword = randomBytes(24).toString("hex");
  const workerPassword = randomBytes(24).toString("hex");
  const secretValues = {
    postgresAdminDatabase: `postgres://proofline:${postgresPassword}@postgres:5432/proofline`,
    apiDatabase: `postgres://proofline_api_login:${apiPassword}@postgres:5432/proofline`,
    migratorDatabase: `postgres://proofline_migrator_login:${migratorPassword}@postgres:5432/proofline`,
    recordingImporterDatabase: `postgres://proofline_recording_importer_login:${importerPassword}@postgres:5432/proofline`,
    workerDatabase: `postgres://proofline_worker_login:${workerPassword}@postgres:5432/proofline`,
    workerReplayBundle: "{}",
    workerReplayPreflightReport: "{}",
    apiDigest: randomBytes(32).toString("hex"),
    postgresPassword,
  };
  const secretPaths = {};
  for (const [name, value] of Object.entries(secretValues)) {
    const path = join(temporaryDirectory, name);
    await writeFile(path, value, { mode: 0o600 });
    secretPaths[name] = path;
  }
  return {
    environment: {
      ...process.env,
      PROOFLINE_CADDY_IMAGE: "proofline/caddy:027a-qa",
      PROOFLINE_WEB_IMAGE: "proofline/web:027a-qa",
      PROOFLINE_API_IMAGE: "proofline/api:027a-qa",
      PROOFLINE_WORKER_IMAGE: "proofline/worker:027a-qa",
      PROOFLINE_PUBLIC_ORIGIN: publicOrigin,
      PROOFLINE_DEPLOYMENT_ID: deploymentId,
      PROOFLINE_RELEASE_TREE_SHA: releaseTreeSha,
      PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE: secretPaths.postgresAdminDatabase,
      PROOFLINE_MIGRATOR_DATABASE_URL_FILE: secretPaths.migratorDatabase,
      PROOFLINE_API_DATABASE_URL_FILE: secretPaths.apiDatabase,
      PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: secretPaths.apiDigest,
      PROOFLINE_WORKER_DATABASE_URL_FILE: secretPaths.workerDatabase,
      PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000000000000000",
      PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
      PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
      PROOFLINE_SAFE_CONSUMER_ADDRESS:
        "0x5555555555555555555555555555555555555555",
      PROOFLINE_WORKER_REPLAY_BUNDLE_FILE: secretPaths.workerReplayBundle,
      PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE:
        secretPaths.workerReplayPreflightReport,
      PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: secretPaths.recordingImporterDatabase,
      PROOFLINE_POSTGRES_PASSWORD_FILE: secretPaths.postgresPassword,
    },
  };
}

const healthBody = JSON.stringify({ version: "1", status: "ok" });
const readinessBody = (worker) => JSON.stringify({
  version: "1",
  status: worker === "ready" ? "ready" : "not-ready",
  checks: { database: "ready", schema: "ready", worker },
});
const databaseUnavailableBody = JSON.stringify({
  version: "1",
  status: "not-ready",
  checks: { database: "unavailable", schema: "unavailable", worker: "unavailable" },
});

async function runSmoke({ environment }) {
  try {
    compose([
      "up",
      "--detach",
      "--pull",
      "never",
      "--no-build",
      "--force-recreate",
      "caddy",
      "web",
      "postgres",
      "db-role-bootstrap",
      "migrator",
      "api",
    ], environment);

    await waitForJob("db-role-bootstrap", environment);
    await waitForJob("migrator", environment);
    await waitForResponse("/api/healthz", 200, healthBody);
    await waitForResponse("/api/readyz", 503, readinessBody("missing"));

    postgresSql(`
SET ROLE proofline_worker;
DELETE FROM proofline_private.deployment_worker_heartbeats
WHERE deployment_id = '${deploymentId}' AND worker_instance_id = '${workerInstanceId}';
INSERT INTO proofline_private.deployment_worker_heartbeats
  (deployment_id, worker_instance_id, release_tree_sha, started_at, last_heartbeat_at)
VALUES (
  '${deploymentId}',
  '${workerInstanceId}',
  '${releaseTreeSha}',
  date_trunc('milliseconds', clock_timestamp() - interval '31 seconds'),
  date_trunc('milliseconds', clock_timestamp())
);
`, environment);
    await waitForResponse("/api/readyz", 200, readinessBody("ready"));

    postgresSql(`
SET ROLE proofline_worker;
UPDATE proofline_private.deployment_worker_heartbeats
SET last_heartbeat_at = date_trunc('milliseconds', clock_timestamp() - interval '31 seconds')
WHERE deployment_id = '${deploymentId}' AND worker_instance_id = '${workerInstanceId}';
`, environment);
    await waitForResponse("/api/readyz", 503, readinessBody("stale"));

    const postgresContainer = compose(["ps", "--format", "json", "postgres"], environment, true);
    const postgresEntry = parseComposePs(postgresContainer)[0];
    if (!postgresEntry?.ID) throw new Error("Runtime QA PostgreSQL container is missing");
    const inspectionBefore = JSON.parse(docker(["inspect", postgresEntry.ID], environment, true))[0];
    const persistentVolume = inspectionBefore?.Mounts?.find((mount) =>
      mount.Type === "volume" && mount.Destination === "/var/lib/postgresql/data"
    )?.Name;
    if (!persistentVolume) throw new Error("Runtime QA PostgreSQL volume is missing");

    compose(["stop", "postgres"], environment);
    await waitForResponse("/api/readyz", 503, databaseUnavailableBody);
    compose(["start", "postgres"], environment);
    await waitForPostgres(environment);

    const inspectionAfter = JSON.parse(docker(["inspect", postgresEntry.ID], environment, true))[0];
    const restartedVolume = inspectionAfter?.Mounts?.find((mount) =>
      mount.Type === "volume" && mount.Destination === "/var/lib/postgresql/data"
    )?.Name;
    if (restartedVolume !== persistentVolume) {
      throw new Error("Runtime QA PostgreSQL volume identity changed across restart");
    }

    compose([
      "up", "--detach", "--pull", "never", "--no-build", "--no-deps",
      "--force-recreate", "db-role-bootstrap",
    ], environment);
    await waitForJob("db-role-bootstrap", environment);
    compose([
      "up", "--detach", "--pull", "never", "--no-build", "--no-deps",
      "--force-recreate", "migrator",
    ], environment);
    await waitForJob("migrator", environment);

    const ledger = postgresSql(`
SELECT count(*)::text || ':' || max(version)::text
FROM proofline_private.schema_migrations;
`, environment);
    if (ledger !== "10:10") throw new Error("Runtime QA migration ledger is not exact");
    await waitForResponse("/api/healthz", 200, healthBody);
    await waitForResponse("/api/readyz", 503, readinessBody("stale"));
  } catch (cause) {
    try {
      compose(["ps", "--all"], environment);
      compose([
        "logs", "--no-color", "--tail", "100",
        "caddy", "postgres", "db-role-bootstrap", "migrator", "api",
      ], environment);
    } catch {}
    throw cause;
  } finally {
    compose(["down", "--volumes", "--remove-orphans"], environment);
    const leftovers = [
      docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
      docker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
      docker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
    ].join("").trim();
    if (leftovers) throw new Error("Scoped runtime QA Docker cleanup is incomplete");
  }
}

await assertExactTlsPortAvailable({
  bindExactTlsPort,
  startDockerReservation,
  removeDockerReservation,
});
await runQaSmokeLifecycle({
  createTemporaryDirectory: () => mkdtemp(join(tmpdir(), `${project}-`)),
  prepareTemporaryDirectory,
  runSmoke,
  removeTemporaryDirectory: (temporaryDirectory) =>
    rm(temporaryDirectory, { recursive: true, force: true }),
});
