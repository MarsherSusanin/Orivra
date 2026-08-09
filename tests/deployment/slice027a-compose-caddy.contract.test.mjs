import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const composePath = resolve(root, "compose.yaml");
const qaComposePath = resolve(root, "deploy/compose.qa.yaml");
const immutable = (name) => `registry.invalid/proofline/${name}@sha256:${"a".repeat(64)}`;
const composeEnvironment = {
  ...process.env,
  PROOFLINE_CADDY_IMAGE: immutable("caddy"),
  PROOFLINE_WEB_IMAGE: immutable("web"),
  PROOFLINE_API_IMAGE: immutable("api"),
  PROOFLINE_WORKER_IMAGE: immutable("worker"),
  PROOFLINE_WEB_ORIGIN: "https://proofline.example",
  PROOFLINE_API_DATABASE_URL_FILE: "/tmp/proofline-api-database-url",
  PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: "/tmp/proofline-api-token-digest-key",
  PROOFLINE_WORKER_DATABASE_URL_FILE: "/tmp/proofline-worker-database-url",
  PROOFLINE_WORKER_VERIFIER_API_KEY_FILE: "/tmp/proofline-worker-verifier-key",
  PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE: "/tmp/proofline-worker-private-key",
  PROOFLINE_POSTGRES_PASSWORD_FILE: "/tmp/proofline-postgres-password",
};

function renderCompose(files = [composePath], environment = composeEnvironment) {
  const args = ["compose"];
  for (const path of files) args.push("-f", path);
  args.push("config", "--format", "json");
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  let model = {};
  try {
    model = JSON.parse(result.stdout || "{}");
  } catch {
    model = {};
  }
  return { ...result, model };
}

function networkNames(service) {
  if (Array.isArray(service?.networks)) return [...service.networks].sort();
  return Object.keys(service?.networks ?? {}).sort();
}

function publishedPorts(service) {
  return (service?.ports ?? []).map((port) => ({
    target: Number(port.target),
    published: Number(port.published),
    protocol: port.protocol ?? "tcp",
  }));
}

function exposedPorts(service) {
  return (service?.expose ?? []).map((port) => Number(String(port).split("/")[0])).sort((a, b) => a - b);
}

function secretTargets(service) {
  return (service?.secrets ?? []).map((secret) =>
    typeof secret === "string" ? secret : secret.target ?? secret.source,
  ).sort();
}

const rendered = renderCompose();

test("renders one semantic production Compose model with the exact service inventory", () => {
  assert.equal(rendered.status, 0, rendered.stderr || "docker compose config must pass");
  assert.deepEqual(
    Object.keys(rendered.model.services ?? {}).sort(),
    ["api", "caddy", "postgres", "web", "worker"],
  );
});

test("keeps Caddy and Web default while gating the application runtime until 027B", () => {
  const services = rendered.model.services ?? {};
  assert.deepEqual(services.caddy?.profiles ?? [], []);
  assert.deepEqual(services.web?.profiles ?? [], []);
  for (const name of ["api", "worker", "postgres"]) {
    assert.deepEqual(services[name]?.profiles, ["runtime-after-027b"]);
  }
  assert.deepEqual(services.caddy?.depends_on ?? {}, {
    web: { condition: "service_started", required: true },
  });
});

test("enforces the exact five-network membership and internal boundaries", () => {
  const services = rendered.model.services ?? {};
  assert.deepEqual(networkNames(services.caddy), ["app_internal", "public_edge", "web_internal"]);
  assert.deepEqual(networkNames(services.web), ["web_internal"]);
  assert.deepEqual(networkNames(services.api), ["app_internal", "db_internal"]);
  assert.deepEqual(networkNames(services.worker), ["db_internal", "worker_egress"]);
  assert.deepEqual(networkNames(services.postgres), ["db_internal"]);
  assert.deepEqual(Object.keys(rendered.model.networks ?? {}).sort(), [
    "app_internal",
    "db_internal",
    "public_edge",
    "web_internal",
    "worker_egress",
  ]);
  for (const name of ["app_internal", "db_internal", "web_internal"]) {
    assert.equal(rendered.model.networks?.[name]?.internal, true);
  }
  assert.notEqual(rendered.model.networks?.public_edge?.internal, true);
  assert.notEqual(rendered.model.networks?.worker_egress?.internal, true);
});

test("publishes only Caddy TCP 80 and 443 and gives no host authority to other services", () => {
  const services = rendered.model.services ?? {};
  assert.deepEqual(publishedPorts(services.caddy), [
    { target: 80, published: 80, protocol: "tcp" },
    { target: 443, published: 443, protocol: "tcp" },
  ]);
  for (const name of ["web", "api", "worker", "postgres"]) {
    assert.deepEqual(publishedPorts(services[name]), [], `${name} must have no host port`);
    assert.notEqual(services[name]?.network_mode, "host");
  }
  assert.deepEqual(exposedPorts(services.web), [8080]);
  assert.deepEqual(exposedPorts(services.api), [8080]);
  assert.deepEqual(exposedPorts(services.postgres), [5432]);
  assert.deepEqual(exposedPorts(services.worker), []);
});

test("uses exact named PostgreSQL/Caddy volumes and mounted secret files only", () => {
  const services = rendered.model.services ?? {};
  assert.deepEqual(Object.keys(rendered.model.volumes ?? {}).sort(), [
    "caddy_config",
    "caddy_data",
    "postgres_data",
  ]);
  const pgMounts = services.postgres?.volumes ?? [];
  assert.ok(pgMounts.some((mount) => mount.type === "volume" && mount.source === "postgres_data"));
  const caddyMounts = services.caddy?.volumes ?? [];
  assert.ok(caddyMounts.some((mount) => mount.type === "volume" && mount.source === "caddy_data"));
  assert.ok(caddyMounts.some((mount) => mount.type === "volume" && mount.source === "caddy_config"));

  const apiEnvironment = services.api?.environment ?? {};
  const workerEnvironment = services.worker?.environment ?? {};
  assert.deepEqual(
    Object.keys(apiEnvironment).filter((name) => /DATABASE_URL|TOKEN_DIGEST_KEY/.test(name)).sort(),
    ["DATABASE_URL_FILE", "PROOFLINE_TOKEN_DIGEST_KEY_FILE"],
  );
  assert.deepEqual(
    Object.keys(workerEnvironment).filter((name) => /DATABASE_URL|VERIFIER_API_KEY|COSTON2_PRIVATE_KEY/.test(name)).sort(),
    ["DATABASE_URL_FILE", "PROOFLINE_COSTON2_PRIVATE_KEY_FILE", "PROOFLINE_VERIFIER_API_KEY_FILE"],
  );
  assert.equal(services.postgres?.environment?.POSTGRES_PASSWORD_FILE, "/run/secrets/postgres_password");
  assert.deepEqual(secretTargets(services.api), ["api_database_url", "api_token_digest_key"]);
  assert.deepEqual(secretTargets(services.worker), [
    "worker_coston2_private_key",
    "worker_database_url",
    "worker_verifier_api_key",
  ]);
  assert.deepEqual(secretTargets(services.postgres), ["postgres_password"]);
  assert.deepEqual(Object.keys(rendered.model.secrets ?? {}).sort(), [
    "api_database_url",
    "api_token_digest_key",
    "postgres_password",
    "worker_coston2_private_key",
    "worker_database_url",
    "worker_verifier_api_key",
  ]);
  assert.deepEqual(secretTargets(services.caddy), []);
  assert.deepEqual(secretTargets(services.web), []);
  const renderedText = JSON.stringify(rendered.model);
  assert.doesNotMatch(renderedText, /postgres:\/\/[^"@]+:[^"@]+@/);
});

test("rejects privileged, Docker-socket, host-network and unbounded service defaults", () => {
  for (const [name, service] of Object.entries(rendered.model.services ?? {})) {
    assert.notEqual(service.privileged, true, `${name} must not be privileged`);
    assert.notEqual(service.network_mode, "host", `${name} must not use host networking`);
    assert.match(JSON.stringify(service.security_opt ?? []), /no-new-privileges/i);
    assert.ok((service.cap_drop ?? []).includes("ALL"), `${name} must drop ALL capabilities`);
    if (name === "caddy") assert.deepEqual(service.cap_add, ["NET_BIND_SERVICE"]);
    else assert.deepEqual(service.cap_add ?? [], []);
    assert.doesNotMatch(JSON.stringify(service.volumes ?? []), /docker\.sock/i);
    assert.ok(service.logging?.options?.["max-size"]);
    assert.ok(service.logging?.options?.["max-file"]);
    assert.match(String(service.stop_grace_period ?? ""), /^[1-9][0-9]*s$/);
    assert.ok(service.deploy?.resources?.limits?.cpus, `${name} must bound CPU`);
    assert.ok(service.deploy?.resources?.limits?.memory, `${name} must bound memory`);
    assert.ok(Number(service.pids_limit) > 0, `${name} must bound process count`);
  }
  for (const name of ["web", "api", "worker"]) {
    assert.equal(rendered.model.services?.[name]?.read_only, true);
    assert.ok((rendered.model.services?.[name]?.tmpfs ?? []).length > 0);
    assert.notEqual(rendered.model.services?.[name]?.user, "0");
  }
});

test("requires immutable production application images and pull never", () => {
  for (const [name, service] of Object.entries(rendered.model.services ?? {})) {
    assert.equal(service.pull_policy, "never", `${name} must never pull during composition`);
    if (name !== "postgres") assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
  }
  assert.equal(
    rendered.model.services?.postgres?.image,
    "postgres@sha256:747d5ed1fdeeb124b880fbe3d7c6557d2c4064ae41d6b6297d417882effce4be",
  );
  assert.equal(rendered.model.services?.postgres?.platform, "linux/amd64");
});

test("routes exact API paths before Web and strips the prefix exactly once", async () => {
  const caddyfile = await readFile(resolve(root, "deploy/caddy/Caddyfile"), "utf8").catch(() => "");
  assert.match(caddyfile, /@api\s+path\s+\/api\s+\/api\/\*/);
  assert.match(caddyfile, /handle\s+@api\s*\{/);
  assert.match(caddyfile, /uri\s+strip_prefix\s+\/api/);
  assert.match(caddyfile, /reverse_proxy\s+api:8080/);
  const apiIndex = caddyfile.search(/handle\s+@api/);
  const webIndex = caddyfile.search(/reverse_proxy\s+web:8080/);
  assert.ok(apiIndex >= 0 && webIndex > apiIndex, "API handler must precede Web fallback");
  assert.doesNotMatch(caddyfile, /handle_errors[\s\S]*web:8080/i);
});

test("keeps health, schema and worker readiness explicitly outside 027A", () => {
  const services = rendered.model.services ?? {};
  assert.equal(services.api?.healthcheck, undefined);
  assert.equal(services.worker?.healthcheck, undefined);
  assert.doesNotMatch(JSON.stringify({ api: services.api, worker: services.worker }), /healthz|readyz|migration|deployment[_-]?heartbeat/i);
  const pgHealth = JSON.stringify(services.postgres?.healthcheck ?? {});
  assert.match(pgHealth, /pg_isready/);
  assert.doesNotMatch(pgHealth, /schema|migration|heartbeat/i);
});

test("renders a loopback-only no-egress QA override with local tags and no worker activation", () => {
  const environment = {
    ...composeEnvironment,
    PROOFLINE_CADDY_IMAGE: "proofline/caddy:027a-qa",
    PROOFLINE_WEB_IMAGE: "proofline/web:027a-qa",
    PROOFLINE_API_IMAGE: "proofline/api:027a-qa",
    PROOFLINE_WORKER_IMAGE: "proofline/worker:027a-qa",
    PROOFLINE_QA_HTTP_PORT: "49152",
  };
  const qa = renderCompose([composePath, qaComposePath], environment);
  assert.equal(qa.status, 0, qa.stderr || "QA Compose config must pass");
  assert.equal(qa.model.networks?.public_edge?.internal, true);
  assert.deepEqual(publishedPorts(qa.model.services?.caddy), [
    { target: 80, published: 49152, protocol: "tcp" },
  ]);
  for (const name of ["caddy", "web", "api", "worker"]) {
    assert.match(qa.model.services?.[name]?.image ?? "", /^proofline\/[a-z]+:027a-qa$/);
    assert.equal(qa.model.services?.[name]?.pull_policy, "never");
  }
});

test("contains no Redis, Helm or hidden orchestration authority", async () => {
  const source = await readFile(composePath, "utf8").catch(() => "");
  const aggregate = `${source}\n${JSON.stringify(rendered.model)}`;
  assert.doesNotMatch(aggregate, /\bredis\b|helm|kubernetes|docker\.sock|network_mode:\s*host|privileged:\s*true/i);
});
