import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = `proofline-027a-q${process.pid}-${randomBytes(4).toString("hex")}`;
if (!/^proofline-027a-[a-z0-9-]+$/.test(project)) throw new Error("Invalid QA project");
const temporaryDirectory = await mkdtemp(join(tmpdir(), `${project}-`));
const requestLedger = [];
const forbiddenHosts = new Set([
  "api.open-meteo.com",
  "api.coinbase.com",
  "fdc-verifiers-testnet.flare.network",
  "coston2-api.flare.network",
]);

function docker(args, environment, capture = false) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) throw new Error(`QA Docker command failed (${args.at(-1)})`);
  return result.stdout ?? "";
}

function compose(arguments_, environment, capture = false) {
  return docker([
    "compose",
    "--profile",
    "runtime-after-027b",
    "--project-name",
    project,
    "--file",
    "compose.yaml",
    "--file",
    "deploy/compose.qa.yaml",
    ...arguments_,
  ], environment, capture);
}

async function randomLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise, reject) =>
    server.close((cause) => cause ? reject(cause) : resolvePromise()),
  );
  if (!port) throw new Error("No loopback port available");
  return port;
}

async function request(port, path) {
  const target = new URL(`http://127.0.0.1:${port}${path}`);
  requestLedger.push({
    hostname: target.hostname,
    port: target.port,
    pathname: target.pathname,
  });
  const response = await fetch(target, {
    redirect: "manual",
    signal: AbortSignal.timeout(2_000),
  });
  return { status: response.status, body: await response.text() };
}

async function waitFor(port, path, expectedStatus) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request(port, path);
      if (response.status === expectedStatus) return response;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`QA route did not reach status ${expectedStatus}`);
}

const password = randomBytes(24).toString("hex");
const secretValues = {
  apiDatabase: `postgres://proofline:${password}@postgres:5432/proofline`,
  apiDigest: randomBytes(32).toString("hex"),
  postgresPassword: password,
};
const secretPaths = {};
for (const [name, value] of Object.entries(secretValues)) {
  const path = join(temporaryDirectory, name);
  await writeFile(path, value, { mode: 0o600 });
  secretPaths[name] = path;
}
const port = await randomLoopbackPort();
const environment = {
  ...process.env,
  PROOFLINE_CADDY_IMAGE: "proofline/caddy:027a-qa",
  PROOFLINE_WEB_IMAGE: "proofline/web:027a-qa",
  PROOFLINE_API_IMAGE: "proofline/api:027a-qa",
  PROOFLINE_WORKER_IMAGE: "proofline/worker:027a-qa",
  PROOFLINE_CADDY_SITE_ADDRESS: ":80",
  PROOFLINE_WEB_ORIGIN: "https://proofline.invalid",
  PROOFLINE_QA_HTTP_PORT: String(port),
  PROOFLINE_API_DATABASE_URL_FILE: secretPaths.apiDatabase,
  PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: secretPaths.apiDigest,
  PROOFLINE_POSTGRES_PASSWORD_FILE: secretPaths.postgresPassword,
};

try {
  compose(["up", "--detach", "--pull", "never", "--no-build", "caddy", "web", "postgres", "api"], environment);
  const ps = compose(["ps", "--format", "json"], environment, true);
  const entries = ps.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const containers = entries.map((entry) => entry.ID).filter(Boolean);
  if (containers.length !== 4) throw new Error("Unexpected QA service inventory");
  if (entries.some((entry) => entry.Service === "worker")) {
    throw new Error("Worker must not start in QA");
  }
  const inspectCommand = ["docker", "inspect", ...containers];
  const inspection = JSON.parse(docker(inspectCommand.slice(1), environment, true));
  const expectedNetworks = {
    caddy: ["app_internal", "public_edge", "web_internal"],
    web: ["web_internal"],
    api: ["app_internal", "db_internal"],
    postgres: ["db_internal"],
  };
  const expectedUsers = {
    caddy: "10001:10001",
    web: "1000:1000",
    api: "1000:1000",
    postgres: "70:70",
  };
  for (const container of inspection) {
    const text = JSON.stringify(container.Mounts ?? []);
    if (text.toLowerCase().includes("docker.sock")) {
      throw new Error("Forbidden socket mount");
    }
    const ports = container.NetworkSettings?.Ports ?? {};
    const bindings = Object.values(ports).flatMap((value) => value ?? []);
    if (bindings.some((binding) => binding.HostIp && binding.HostIp !== "127.0.0.1")) {
      throw new Error("Non-loopback HostPort binding");
    }
    const service = container.Config?.Labels?.["com.docker.compose.service"];
    if (!(service in expectedNetworks)) throw new Error("Unexpected QA service");
    if (container.Config?.User !== expectedUsers[service]) {
      throw new Error("Unexpected QA runtime user");
    }
    const liveNetworks = Object.keys(container.NetworkSettings?.Networks ?? {})
      .map((name) => name.replace(`${project}_`, ""))
      .sort();
    if (JSON.stringify(liveNetworks) !== JSON.stringify(expectedNetworks[service])) {
      throw new Error("Unexpected QA NetworkSettings");
    }
    if (service === "caddy") {
      const caddyBindings = ports["80/tcp"] ?? [];
      const expectedHostPort = environment.PROOFLINE_QA_HTTP_PORT;
      if (
        caddyBindings.length !== 1 ||
        caddyBindings[0].HostIp !== "127.0.0.1" ||
        caddyBindings[0].HostPort !== expectedHostPort
      ) {
        throw new Error("QA Caddy HostPort binding is unavailable");
      }
    }
    if (service !== "caddy" && bindings.some((binding) => binding.HostPort)) {
      throw new Error("Non-edge HostPort binding");
    }
    if (!Object.keys(container.NetworkSettings?.Networks ?? {}).length) {
      throw new Error("Missing private NetworkSettings");
    }
  }

  const rootResponse = await waitFor(port, "/", 200);
  if (!/<!doctype html/i.test(rootResponse.body)) throw new Error("QA root is not the Web shell");
  await waitFor(port, "/templates/open-meteo-current-weather", 200);
  await waitFor(port, "/api/v1/templates", 200);
  await waitFor(port, "/api/v1/templates?unexpected=1", 400);
  await waitFor(port, "/api/api/v1/templates", 401);
  await waitFor(port, "/api/not-a-route", 401);
  await waitFor(port, "/assets/missing.js", 404);
  for (const entry of requestLedger) {
    if (entry.hostname !== "127.0.0.1" || entry.port !== String(port)) {
      throw new Error("Runner request escaped the selected loopback origin");
    }
    if (forbiddenHosts.has(entry.hostname)) {
      throw new Error("Runner request reached a forbidden host");
    }
  }
} catch (cause) {
  try {
    compose(["ps"], environment);
    compose([
      "logs",
      "--no-color",
      "--tail",
      "80",
      "caddy",
      "web",
      "postgres",
      "api",
    ], environment);
  } catch {}
  throw cause;
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans"], environment);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
