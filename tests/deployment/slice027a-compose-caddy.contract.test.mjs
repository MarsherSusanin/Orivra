import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const composePath = resolve(root, "compose.yaml");
const runtimeComposePath = resolve(root, "deploy/compose.runtime.yaml");
const qaComposePath = resolve(root, "deploy/compose.qa.yaml");
const [baseComposeSource, runtimeComposeSource, qaComposeSource] = await Promise.all(
  [composePath, runtimeComposePath, qaComposePath].map((path) =>
    readFile(path, "utf8").catch(() => "")),
);
const immutable = (name) => `registry.invalid/proofline/${name}@sha256:${"a".repeat(64)}`;
const dockerCliEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    name !== "COMPOSE_PROFILES" && !name.startsWith("PROOFLINE_")),
);
const baseComposeEnvironment = {
  ...dockerCliEnvironment,
  PROOFLINE_CADDY_IMAGE: immutable("caddy"),
  PROOFLINE_WEB_IMAGE: immutable("web"),
  PROOFLINE_PUBLIC_ORIGIN: "https://proofline.example",
};
const runtimeComposeEnvironment = {
  ...baseComposeEnvironment,
  PROOFLINE_API_IMAGE: immutable("api"),
  PROOFLINE_WORKER_IMAGE: immutable("worker"),
  PROOFLINE_API_DATABASE_URL_FILE: "/tmp/proofline-api-database-url",
  PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: "/tmp/proofline-api-token-digest-key",
  PROOFLINE_WORKER_DATABASE_URL_FILE: "/tmp/proofline-worker-database-url",
  PROOFLINE_WORKER_VERIFIER_API_KEY_FILE: "/tmp/proofline-worker-verifier-key",
  PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE: "/tmp/proofline-worker-private-key",
  PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE: "/tmp/proofline-postgres-admin-database-url",
  PROOFLINE_MIGRATOR_DATABASE_URL_FILE: "/tmp/proofline-migrator-database-url",
  PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: "/tmp/proofline-recording-importer-database-url",
  PROOFLINE_POSTGRES_PASSWORD_FILE: "/tmp/proofline-postgres-password",
};

function renderCompose(
  files = [composePath, runtimeComposePath],
  environment = runtimeComposeEnvironment,
) {
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

function renderDefaultServices(
  files = [composePath],
  environment = baseComposeEnvironment,
) {
  const args = ["compose"];
  for (const path of files) args.push("-f", path);
  args.push("config", "--services");
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  return {
    ...result,
    services: result.stdout.split(/\r?\n/).filter(Boolean).sort(),
  };
}

function networkNames(service) {
  if (Array.isArray(service?.networks)) return [...service.networks].sort();
  return Object.keys(service?.networks ?? {}).sort();
}

function networkMembers(model, network) {
  return Object.entries(model.services ?? {})
    .filter(([, service]) => networkNames(service).includes(network))
    .map(([name]) => name)
    .sort();
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

function serviceBlock(source, name) {
  const match = source.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9_-]*:\\n|^networks:|^volumes:|^secrets:|(?![\\s\\S]))`, "m"),
  );
  return match?.[0] ?? "";
}

const rendered = renderCompose();
const baseRendered = renderCompose([composePath], baseComposeEnvironment);
const defaultServices = renderDefaultServices();

test("keeps the independently renderable base limited to Caddy and Web", () => {
  assert.notEqual(baseComposeSource, "");
  assert.match(baseComposeSource, /^  caddy:/m);
  assert.match(baseComposeSource, /^  web:/m);
  assert.doesNotMatch(baseComposeSource, /^  (?:api|worker|postgres):/m);
  assert.doesNotMatch(baseComposeSource, /app_internal|db_internal|worker_egress|postgres_data/);
  assert.equal(baseRendered.status, 0, baseRendered.stderr || "base Compose config must pass");
  assert.deepEqual(baseRendered.model.services?.caddy?.depends_on ?? {}, {
    web: { condition: "service_started", required: true },
  });
});

test("keeps all runtime services, networks, secrets and PostgreSQL state in one overlay", () => {
  assert.notEqual(runtimeComposeSource, "", "deploy/compose.runtime.yaml must exist");
  for (const service of ["api", "worker", "postgres"]) {
    assert.match(runtimeComposeSource, new RegExp(`^  ${service}:`, "m"));
  }
  for (const authority of [
    "app_internal",
    "db_internal",
    "worker_egress",
    "postgres_data",
    "api_database_url",
    "worker_coston2_private_key",
  ]) {
    assert.match(runtimeComposeSource, new RegExp(authority));
  }
});

test("makes only named Caddy state writable and bounds its temporary filesystem", () => {
  const caddy = serviceBlock(baseComposeSource, "caddy");
  assert.notEqual(caddy, "");
  assert.match(caddy, /read_only:\s*true/);
  assert.match(caddy, /tmpfs:[\s\S]*\/tmp:[^\n]*(?:size=|size:)/);
  assert.match(caddy, /caddy_data:\/data|caddy_data[\s\S]{0,80}target:\s*\/data/);
  assert.match(caddy, /caddy_config:\/config|caddy_config[\s\S]{0,80}target:\s*\/config/);
  assert.doesNotMatch(caddy, /type:\s*bind|docker\.sock/);
});

test("derives Caddy and runtime API authority from one exact public origin", () => {
  const caddy = serviceBlock(baseComposeSource, "caddy");
  const api = serviceBlock(runtimeComposeSource, "api");
  assert.match(caddy, /PROOFLINE_PUBLIC_ORIGIN:\s*\$\{PROOFLINE_PUBLIC_ORIGIN:\?/);
  assert.match(api, /PROOFLINE_WEB_ORIGIN:\s*\$\{PROOFLINE_PUBLIC_ORIGIN:\?/);
  assert.doesNotMatch(`${baseComposeSource}\n${runtimeComposeSource}`, /PROOFLINE_CADDY_SITE_ADDRESS/);
});

test("binds QA only to exact loopback HTTPS 443 without random HTTP authority", () => {
  const caddy = serviceBlock(qaComposeSource, "caddy");
  assert.match(caddy, /target:\s*443/);
  assert.match(caddy, /published:\s*443/);
  assert.match(caddy, /host_ip:\s*127\.0\.0\.1/);
  assert.doesNotMatch(caddy, /target:\s*80|PROOFLINE_QA_HTTP_PORT|PROOFLINE_CADDY_SITE_ADDRESS|:\s*80/);
});

test("renders one semantic production Compose model with the exact 027B service inventory", () => {
  assert.equal(rendered.status, 0, rendered.stderr || "docker compose config must pass");
  assert.deepEqual(
    Object.keys(rendered.model.services ?? {}).sort(),
    ["api", "caddy", "db-role-bootstrap", "migrator", "postgres", "web", "worker"],
  );
});

test("activates only Caddy and Web when no runtime profile is requested", () => {
  assert.equal(
    Object.hasOwn(baseComposeEnvironment, "COMPOSE_PROFILES"),
    false,
    "operator COMPOSE_PROFILES must not activate hidden services in this test",
  );
  assert.deepEqual(
    Object.keys(baseComposeEnvironment).filter((name) => name.startsWith("PROOFLINE_")).sort(),
    ["PROOFLINE_CADDY_IMAGE", "PROOFLINE_PUBLIC_ORIGIN", "PROOFLINE_WEB_IMAGE"],
    "default composition must not require dormant runtime images or secret paths",
  );
  assert.equal(defaultServices.status, 0, defaultServices.stderr || "default Compose config must pass");
  assert.deepEqual(defaultServices.services, ["caddy", "web"]);
});

test("promotes the 027B runtime without a hidden Compose profile", () => {
  const services = rendered.model.services ?? {};
  for (const name of ["caddy", "web", "postgres", "db-role-bootstrap", "migrator", "api", "worker"]) {
    assert.deepEqual(services[name]?.profiles ?? [], []);
  }
  assert.deepEqual(services.caddy?.depends_on ?? {}, {
    api: { condition: "service_healthy", required: true },
    web: { condition: "service_started", required: true },
  });
  assert.equal(services.caddy?.depends_on?.worker, undefined);
  assert.deepEqual(Object.keys(rendered.model.services ?? {}).sort(), [
    "api",
    "caddy",
    "db-role-bootstrap",
    "migrator",
    "postgres",
    "web",
    "worker",
  ]);
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
  for (const name of ["web", "api", "worker", "postgres", "db-role-bootstrap", "migrator"]) {
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
    "migrator_database_url",
    "postgres_admin_database_url",
    "postgres_password",
    "recording_importer_database_url",
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
  for (const name of ["caddy", "web", "api", "worker", "db-role-bootstrap", "migrator"]) {
    assert.equal(rendered.model.services?.[name]?.read_only, true);
    assert.ok((rendered.model.services?.[name]?.tmpfs ?? []).length > 0);
    assert.notEqual(rendered.model.services?.[name]?.user, "0");
  }
  assert.deepEqual(
    (rendered.model.services?.caddy?.volumes ?? []).map((mount) => mount.target).sort(),
    ["/config", "/data"],
    "only named Caddy state/config volumes may be writable outside bounded tmpfs",
  );
  assert.ok(
    (rendered.model.services?.caddy?.tmpfs ?? []).some((entry) =>
      String(typeof entry === "string" ? entry : entry.target).startsWith("/tmp")),
    "Caddy must receive a bounded /tmp tmpfs",
  );
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
  const [caddyfile, qaCaddyfile] = await Promise.all([
    readFile(resolve(root, "deploy/caddy/Caddyfile"), "utf8").catch(() => ""),
    readFile(resolve(root, "deploy/caddy/Caddyfile.qa"), "utf8").catch(() => ""),
  ]);
  assert.match(caddyfile, /@api\s+path\s+\/api\s+\/api\/\*/);
  assert.match(caddyfile, /handle\s+@api\s*\{/);
  assert.match(caddyfile, /uri\s+strip_prefix\s+\/api/);
  assert.match(caddyfile, /reverse_proxy\s+api:8080/);
  assert.match(caddyfile, /\{\$PROOFLINE_PUBLIC_ORIGIN\}/);
  assert.doesNotMatch(
    caddyfile,
    /tls\s+internal|default_sni\s+127\.0\.0\.1/,
    "production ingress must retain Caddy automatic public HTTPS/ACME",
  );
  assert.notEqual(qaCaddyfile, "", "deploy/caddy/Caddyfile.qa must exist");
  assert.match(qaCaddyfile, /default_sni\s+127\.0\.0\.1/);
  assert.match(qaCaddyfile, /tls\s+internal/);
  assert.match(qaCaddyfile, /@api\s+path\s+\/api\s+\/api\/\*/);
  assert.match(qaCaddyfile, /uri\s+strip_prefix\s+\/api/);
  assert.deepEqual(
    [...new Set(
      [...caddyfile.matchAll(/reverse_proxy\s+([^\s{]+)/g)].map((match) => match[1]),
    )].sort(),
    ["api:8080", "web:8080"],
    "Caddy must have no external or provider upstream",
  );
  const apiIndex = caddyfile.search(/handle\s+@api/);
  const webIndex = caddyfile.search(/reverse_proxy\s+web:8080/);
  assert.ok(apiIndex >= 0 && webIndex > apiIndex, "API handler must precede Web fallback");
  assert.doesNotMatch(caddyfile, /handle_errors[\s\S]*web:8080/i);
});

test("uses process-only API health while keeping readiness out of container health", () => {
  const services = rendered.model.services ?? {};
  const apiHealth = JSON.stringify(services.api?.healthcheck ?? {});
  assert.match(apiHealth, /\/healthz/);
  assert.doesNotMatch(apiHealth, /\/readyz|schema|migration|heartbeat/i);
  assert.equal(services.worker?.healthcheck, undefined);
  const pgHealth = JSON.stringify(services.postgres?.healthcheck ?? {});
  assert.match(pgHealth, /pg_isready/);
  assert.doesNotMatch(pgHealth, /schema|migration|heartbeat/i);
});

test("renders the bounded exact-origin HTTPS QA override with local tags and no worker activation", () => {
  const environment = {
    ...runtimeComposeEnvironment,
    PROOFLINE_CADDY_IMAGE: "proofline/caddy:027a-qa",
    PROOFLINE_WEB_IMAGE: "proofline/web:027a-qa",
    PROOFLINE_API_IMAGE: "proofline/api:027a-qa",
    PROOFLINE_WORKER_IMAGE: "proofline/worker:027a-qa",
    PROOFLINE_PUBLIC_ORIGIN: "https://127.0.0.1",
  };
  const qa = renderCompose([composePath, runtimeComposePath, qaComposePath], environment);
  assert.equal(qa.status, 0, qa.stderr || "QA Compose config must pass");
  assert.notEqual(
    qa.model.networks?.public_edge?.internal,
    true,
    "Docker Desktop requires a non-internal edge for a loopback host publish",
  );
  assert.deepEqual(networkMembers(qa.model, "public_edge"), ["caddy"]);
  assert.equal(
    qa.model.services?.caddy?.environment?.PROOFLINE_PUBLIC_ORIGIN,
    "https://127.0.0.1",
  );
  assert.equal(
    qa.model.services?.api?.environment?.PROOFLINE_WEB_ORIGIN,
    qa.model.services?.caddy?.environment?.PROOFLINE_PUBLIC_ORIGIN,
    "Caddy and API must derive authority from the same single public origin",
  );
  const qaCaddyConfigMounts = (qa.model.services?.caddy?.volumes ?? []).filter((mount) =>
    mount.type === "bind" && mount.target === "/etc/caddy/Caddyfile");
  assert.equal(qaCaddyConfigMounts.length, 1, "QA must select exactly one QA-only Caddyfile");
  assert.ok(
    String(qaCaddyConfigMounts[0]?.source ?? "").endsWith("/deploy/caddy/Caddyfile.qa"),
    "QA must bind the exact deploy/caddy/Caddyfile.qa source",
  );
  assert.equal(qaCaddyConfigMounts[0]?.read_only, true);
  assert.equal(
    (rendered.model.services?.caddy?.volumes ?? []).some((mount) =>
      mount.type === "bind" && mount.target === "/etc/caddy/Caddyfile"),
    false,
    "production composition must not select the QA-only TLS configuration",
  );
  assert.deepEqual(publishedPorts(qa.model.services?.caddy), [
    { target: 443, published: 443, protocol: "tcp" },
  ]);
  for (const name of ["web", "api", "worker", "postgres"]) {
    assert.deepEqual(publishedPorts(qa.model.services?.[name]), []);
  }
  for (const name of ["caddy", "web", "api", "worker"]) {
    assert.match(qa.model.services?.[name]?.image ?? "", /^proofline\/[a-z]+:027a-qa$/);
    assert.equal(qa.model.services?.[name]?.pull_policy, "never");
  }
});

test("contains no Redis, Helm or hidden orchestration authority", async () => {
  const sources = await Promise.all(
    [composePath, runtimeComposePath, qaComposePath].map((path) =>
      readFile(path, "utf8").catch(() => "")),
  );
  const aggregate = `${sources.join("\n")}\n${JSON.stringify(rendered.model)}`;
  assert.doesNotMatch(aggregate, /\bredis\b|helm|kubernetes|docker\.sock|network_mode:\s*host|privileged:\s*true/i);
});
