import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimePath = resolve(root, "deploy/compose.runtime.yaml");
const runtimeSource = await readFile(runtimePath, "utf8");
const immutable = (name) => `registry.invalid/proofline/${name}@sha256:${"a".repeat(64)}`;
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    name !== "COMPOSE_PROFILES" && !name.startsWith("PROOFLINE_"))),
  PROOFLINE_CADDY_IMAGE: immutable("caddy"),
  PROOFLINE_WEB_IMAGE: immutable("web"),
  PROOFLINE_API_IMAGE: immutable("api"),
  PROOFLINE_WORKER_IMAGE: immutable("worker"),
  PROOFLINE_PUBLIC_ORIGIN: "https://proofline.example",
  PROOFLINE_DEPLOYMENT_ID: `deployment_${"b".repeat(64)}`,
  PROOFLINE_RELEASE_TREE_SHA: "c".repeat(40),
  PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE: "/tmp/postgres-admin-database-url",
  PROOFLINE_MIGRATOR_DATABASE_URL_FILE: "/tmp/migrator-database-url",
  PROOFLINE_API_DATABASE_URL_FILE: "/tmp/api-database-url",
  PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: "/tmp/api-token-digest-key",
  PROOFLINE_WORKER_DATABASE_URL_FILE: "/tmp/worker-database-url",
  PROOFLINE_WORKER_VERIFIER_API_KEY_FILE: "/tmp/worker-verifier-key",
  PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE: "/tmp/worker-private-key",
  PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000000000000000",
  PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
  PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
  PROOFLINE_SAFE_CONSUMER_ADDRESS: "0x5555555555555555555555555555555555555555",
  PROOFLINE_WORKER_REPLAY_BUNDLE_FILE: "/tmp/worker-replay-bundle.json",
  PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE:
    "/tmp/worker-replay-preflight-report.json",
  PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: "/tmp/importer-database-url",
  PROOFLINE_POSTGRES_PASSWORD_FILE: "/tmp/postgres-password",
};

function render(files = ["compose.yaml", "deploy/compose.runtime.yaml"]) {
  const args = ["compose"];
  for (const file of files) args.push("--file", resolve(root, file));
  args.push("config", "--format", "json");
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", env: environment });
  let model = {};
  try { model = JSON.parse(result.stdout || "{}"); } catch {}
  return { ...result, model };
}

function networks(service) {
  return Array.isArray(service?.networks)
    ? [...service.networks].sort()
    : Object.keys(service?.networks ?? {}).sort();
}

function published(service) {
  return (service?.ports ?? []).filter((entry) => entry.published !== undefined);
}

function secretTargets(service) {
  return (service?.secrets ?? []).map((entry) =>
    typeof entry === "string" ? entry : entry.target ?? entry.source).sort();
}

const rendered = render();

test("renders exact seven-service runtime without the 027A profile block", () => {
  assert.equal(rendered.status, 0, rendered.stderr || "runtime compose config must render");
  assert.deepEqual(Object.keys(rendered.model.services ?? {}).sort(), [
    "api",
    "caddy",
    "db-role-bootstrap",
    "migrator",
    "postgres",
    "web",
    "worker",
  ]);
  for (const service of Object.values(rendered.model.services ?? {})) {
    assert.deepEqual(service.profiles ?? [], []);
  }
  assert.doesNotMatch(runtimeSource, /runtime-after-027b|profiles:/i);
});

test("keeps the independently renderable base limited to Caddy and Web", () => {
  const base = render(["compose.yaml"]);
  assert.equal(base.status, 0, base.stderr || "base compose config must render");
  assert.deepEqual(Object.keys(base.model.services ?? {}).sort(), ["caddy", "web"]);
});

test("orders engine health, role bootstrap, migration and both application processes exactly", () => {
  const services = rendered.model.services ?? {};
  assert.deepEqual(services["db-role-bootstrap"]?.depends_on, {
    postgres: { condition: "service_healthy", required: true },
  });
  assert.deepEqual(services.migrator?.depends_on, {
    "db-role-bootstrap": { condition: "service_completed_successfully", required: true },
    postgres: { condition: "service_healthy", required: true },
  });
  for (const name of ["api", "worker"]) {
    assert.equal(
      services[name]?.depends_on?.migrator?.condition,
      "service_completed_successfully",
    );
    assert.equal(services[name]?.depends_on?.postgres?.condition, "service_healthy");
  }
  assert.deepEqual(services.caddy?.depends_on, {
    api: { condition: "service_healthy", required: true },
    web: { condition: "service_started", required: true },
  });
  assert.equal(services.caddy?.depends_on?.worker, undefined);
});

test("uses exact API-image one-shot commands with private hardened runtime authority", () => {
  const services = rendered.model.services ?? {};
  for (const [name, entry] of [
    ["db-role-bootstrap", "db-role-bootstrap.js"],
    ["migrator", "migrate.js"],
  ]) {
    const service = services[name];
    assert.ok(service, `${name} must exist in the rendered runtime`);
    assert.equal(service.image, services.api?.image);
    assert.deepEqual(networks(service), ["db_internal"]);
    assert.equal(service.restart, "no");
    assert.equal(service.read_only, true);
    assert.notEqual(service.user, "0");
    assert.ok((service.tmpfs ?? []).length > 0);
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.deepEqual(published(service), []);
    assert.doesNotMatch(JSON.stringify(service.volumes ?? []), /docker\.sock/i);
    assert.deepEqual(service.command, ["node", `/app/apps/api/dist/${entry}`]);
  }
});

test("mounts exact role-bootstrap and migrator URL files without embedding credentials", () => {
  const services = rendered.model.services ?? {};
  assert.deepEqual(services["db-role-bootstrap"]?.environment, {
    DATABASE_URL_FILE: "/run/secrets/postgres_admin_database_url",
    PROOFLINE_API_DATABASE_URL_FILE: "/run/secrets/api_database_url",
    PROOFLINE_MIGRATOR_DATABASE_URL_FILE: "/run/secrets/migrator_database_url",
    PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: "/run/secrets/recording_importer_database_url",
    PROOFLINE_WORKER_DATABASE_URL_FILE: "/run/secrets/worker_database_url",
  });
  assert.deepEqual(secretTargets(services["db-role-bootstrap"]), [
    "api_database_url",
    "migrator_database_url",
    "postgres_admin_database_url",
    "recording_importer_database_url",
    "worker_database_url",
  ]);
  assert.deepEqual(services.migrator?.environment, {
    DATABASE_URL_FILE: "/run/secrets/migrator_database_url",
  });
  assert.deepEqual(secretTargets(services.migrator), ["migrator_database_url"]);
  assert.doesNotMatch(JSON.stringify(rendered.model), /postgres:\/\/[^"@]+:[^"@]+@/);
});

test("passes exact nonsecret deployment/tree identity to API and worker only", () => {
  const services = rendered.model.services ?? {};
  for (const name of ["api", "worker"]) {
    assert.equal(services[name]?.environment?.PROOFLINE_DEPLOYMENT_ID, environment.PROOFLINE_DEPLOYMENT_ID);
    assert.equal(services[name]?.environment?.PROOFLINE_RELEASE_TREE_SHA, environment.PROOFLINE_RELEASE_TREE_SHA);
  }
  for (const name of ["caddy", "web", "postgres", "db-role-bootstrap", "migrator"]) {
    assert.equal(services[name]?.environment?.PROOFLINE_DEPLOYMENT_ID, undefined);
  }
});

test("passes one complete typed worker configuration and two read-only replay inputs", () => {
  const worker = rendered.model.services?.worker;
  assert.ok(worker);
  assert.deepEqual(worker.environment, {
    DATABASE_URL_FILE: "/run/secrets/worker_database_url",
    PROOFLINE_COSTON2_DA_URL: "https://ctn2-data-availability.flare.network",
    PROOFLINE_COSTON2_PRIVATE_KEY_FILE: "/run/secrets/worker_coston2_private_key",
    PROOFLINE_COSTON2_RPC_URL: "https://coston2-api.flare.network/ext/C/rpc",
    PROOFLINE_DA_TIMEOUT_MS: "15000",
    PROOFLINE_DEPLOYMENT_ID: environment.PROOFLINE_DEPLOYMENT_ID,
    PROOFLINE_RECEIPT_POLL_TIMEOUT_MS: "25000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: environment.PROOFLINE_RELAYER_BALANCE_FLOOR_WEI,
    PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: environment.PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA,
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: environment.PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI,
    PROOFLINE_RELEASE_TREE_SHA: environment.PROOFLINE_RELEASE_TREE_SHA,
    PROOFLINE_REPLAY_BUNDLE_PATH: "/run/proofline/replay/bundle.json",
    PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH:
      "/run/proofline/replay/preflight-report.json",
    PROOFLINE_SAFE_CONSUMER_ADDRESS: environment.PROOFLINE_SAFE_CONSUMER_ADDRESS,
    PROOFLINE_VERIFIER_API_KEY_FILE: "/run/secrets/worker_verifier_api_key",
    PROOFLINE_VERIFIER_URL: "https://fdc-verifiers-testnet.flare.network",
    PROOFLINE_WORKER_DB_POOL_SIZE: "4",
    PROOFLINE_WORKER_LEASE_HEARTBEAT_MS: "10000",
    PROOFLINE_WORKER_MAX_ATTEMPTS: "8",
  });
  const replayMounts = (worker.volumes ?? [])
    .filter((mount) => mount.type === "bind")
    .sort((left, right) => String(left.target).localeCompare(String(right.target)));
  assert.deepEqual(replayMounts, [
    {
      type: "bind",
      source: environment.PROOFLINE_WORKER_REPLAY_BUNDLE_FILE,
      target: "/run/proofline/replay/bundle.json",
      read_only: true,
      bind: { create_host_path: false },
    },
    {
      type: "bind",
      source: environment.PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE,
      target: "/run/proofline/replay/preflight-report.json",
      read_only: true,
      bind: { create_host_path: false },
    },
  ]);
  assert.deepEqual(secretTargets(worker), [
    "worker_coston2_private_key",
    "worker_database_url",
    "worker_verifier_api_key",
  ]);
});

test("fails render when any required worker policy, address or host replay file is absent", () => {
  for (const name of [
    "PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI",
    "PROOFLINE_RELAYER_BALANCE_FLOOR_WEI",
    "PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA",
    "PROOFLINE_SAFE_CONSUMER_ADDRESS",
    "PROOFLINE_WORKER_REPLAY_BUNDLE_FILE",
    "PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE",
  ]) {
    const candidate = { ...environment };
    delete candidate[name];
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--file",
        resolve(root, "compose.yaml"),
        "--file",
        runtimePath,
        "config",
        "--format",
        "json",
      ],
      { cwd: root, encoding: "utf8", env: candidate },
    );
    assert.notEqual(result.status, 0, `${name} must fail before Compose effects`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test("uses healthz only for container liveness and leaves readyz to deployment promotion", () => {
  const services = rendered.model.services ?? {};
  const health = JSON.stringify(services.api?.healthcheck ?? {});
  assert.match(health, /\/healthz/);
  assert.doesNotMatch(health, /\/readyz|migration|worker|schema/i);
  assert.match(JSON.stringify(services.postgres?.healthcheck ?? {}), /pg_isready/);
  assert.equal(services.worker?.healthcheck, undefined);
});

test("ships job bundles, manifest and exact migration 010 in the API image only", async () => {
  const [dockerfile, packageJson] = await Promise.all([
    readFile(resolve(root, "docker/Dockerfile"), "utf8"),
    readFile(resolve(root, "apps/api/package.json"), "utf8").then(JSON.parse),
  ]);
  for (const script of ["build:db-role-bootstrap", "build:migrate", "db:bootstrap-roles", "db:migrate"]) {
    assert.equal(typeof packageJson.scripts?.[script], "string");
  }
  assert.match(dockerfile, /dist\/db-role-bootstrap\.js/);
  assert.match(dockerfile, /dist\/migrate\.js/);
  assert.match(dockerfile, /manifest\.v1\.json/);
  assert.match(dockerfile, /010_deployment_lifecycle\.sql|db\/migrations/);
  const workerStage = dockerfile.split(/ AS worker\b/)[1] ?? "";
  assert.doesNotMatch(workerStage, /db-role-bootstrap|migrate\.js|manifest\.v1\.json/);
});

test("forces runtime one-shot recreation and rejects start/restart bypass before Docker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027b-compose-wrapper-"));
  try {
    const executable = join(directory, "docker-fake");
    const log = join(directory, "calls.jsonl");
    await writeFile(executable, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
`);
    await chmod(executable, 0o700);
    const module = await import(`${pathToFileURL(resolve(root, "scripts/compose-production.mjs")).href}?027b=${Date.now()}`);
    await module.runProductionCompose({
      runtime: true,
      composeArguments: ["up", "--detach"],
      dockerExecutable: executable,
      environment,
    });
    const calls = (await readFile(log, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("--force-recreate"));
    assert.ok(calls[0].includes("deploy/compose.runtime.yaml"));
    for (const command of ["start", "restart"]) {
      await assert.rejects(module.runProductionCompose({
        runtime: true,
        composeArguments: [command],
        dockerExecutable: executable,
        environment,
      }), /one-shot|migration|runtime|up/i);
    }
    assert.equal((await readFile(log, "utf8")).trim().split(/\r?\n/).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("freezes a credential-free runtime lifecycle gate without an actual worker claim", async () => {
  const [packageJson, script] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "scripts/docker-runtime-smoke.mjs"), "utf8").catch(() => ""),
  ]);
  assert.equal(packageJson.scripts?.["test:docker:runtime"], "node scripts/docker-runtime-smoke.mjs");
  assert.match(script, /db-role-bootstrap/);
  assert.match(script, /migrator/);
  assert.match(script, /\/api\/healthz/);
  assert.match(script, /\/api\/readyz/);
  assert.match(script, /SET ROLE proofline_worker/i);
  assert.match(script, /deployment_worker_heartbeats/i);
  assert.match(script, /30 seconds|31 seconds/i);
  assert.match(script, /stop["',\s]+postgres|postgres["',\s]+stop/i);
  assert.match(script, /start["',\s]+postgres|postgres["',\s]+start/i);
  assert.doesNotMatch(script, /["']worker["']\s*\]|up[^\n]+\bworker\b|PROOFLINE_VERIFIER_API_KEY|PROOFLINE_COSTON2_PRIVATE_KEY/i);
  assert.doesNotMatch(script, /live worker ready|worker readiness PASS|hosted|deployed/i);
});
