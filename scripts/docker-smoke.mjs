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
const project = `proofline-027a-q${process.pid}-${randomBytes(4).toString("hex")}`;
if (!/^proofline-027a-[a-z0-9-]+$/.test(project)) throw new Error("Invalid QA project");
const portReservation = `${project}-port-check`;
const PROOFLINE_PUBLIC_ORIGIN = "https://127.0.0.1";
const ALLOW_ORIGIN_HEADER = "Access-Control-Allow-Origin";
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
    throw new Error("QA Docker port reservation removal failed");
  }
}

async function request(path, options = {}) {
  const target = new URL(`${PROOFLINE_PUBLIC_ORIGIN}${path}`);
  requestLedger.push({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    pathname: target.pathname,
  });
  return new Promise((resolvePromise, reject) => {
    const operation = httpsRequest(target, {
      method: options.method ?? "GET",
      headers: options.headers,
      rejectUnauthorized: false,
      timeout: 2_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    operation.once("timeout", () => operation.destroy(new Error("QA request timed out")));
    operation.once("error", reject);
    operation.end();
  });
}

async function waitFor(path, expectedStatus) {
  let lastOutcome = "no response";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request(path);
      if (response.status === expectedStatus) return response;
      lastOutcome = `status ${response.status}`;
    } catch (cause) {
      lastOutcome = `${String(cause?.code ?? cause?.name ?? "request error")}: ${String(cause?.message ?? "")}`;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`QA route did not reach status ${expectedStatus} (${lastOutcome})`);
}

async function prepareTemporaryDirectory(temporaryDirectory) {
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
  return {
    environment: {
      ...process.env,
      PROOFLINE_CADDY_IMAGE: "proofline/caddy:027a-qa",
      PROOFLINE_WEB_IMAGE: "proofline/web:027a-qa",
      PROOFLINE_API_IMAGE: "proofline/api:027a-qa",
      PROOFLINE_WORKER_IMAGE: "proofline/worker:027a-qa",
      PROOFLINE_PUBLIC_ORIGIN,
      PROOFLINE_API_DATABASE_URL_FILE: secretPaths.apiDatabase,
      PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: secretPaths.apiDigest,
      PROOFLINE_POSTGRES_PASSWORD_FILE: secretPaths.postgresPassword,
    },
  };
}

async function runSmoke({ environment }) {
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
      const caddyBindings = ports["443/tcp"] ?? [];
      if (
        caddyBindings.length !== 1 ||
        caddyBindings[0].HostIp !== "127.0.0.1" ||
        caddyBindings[0].HostPort !== "443"
      ) {
        throw new Error("QA Caddy HostPort 443 binding is unavailable");
      }
    }
    if (service !== "caddy" && bindings.some((binding) => binding.HostPort)) {
      throw new Error("Non-edge HostPort binding");
    }
    if (!Object.keys(container.NetworkSettings?.Networks ?? {}).length) {
      throw new Error("Missing private NetworkSettings");
    }
  }

  const rootResponse = await waitFor("/", 200);
  if (!/<!doctype html/i.test(rootResponse.body)) throw new Error("QA root is not the Web shell");
  await waitFor("/templates/open-meteo-current-weather", 200);
  await waitFor("/api/v1/templates", 200);
  await waitFor("/api/v1/templates?unexpected=1", 400);
  await waitFor("/api/api/v1/templates", 401);
  await waitFor("/api/not-a-route", 401);
  await waitFor("/assets/missing.js", 404);

  const allowed = await request("/api/v1/auth/wallet/challenges", {
    method: "OPTIONS",
    headers: {
      Origin: PROOFLINE_PUBLIC_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  if (allowed.status !== 204) throw new Error("Allowed preflight must return status 204");
  if (allowed.headers[ALLOW_ORIGIN_HEADER.toLowerCase()] !== PROOFLINE_PUBLIC_ORIGIN) {
    throw new Error("Allowed preflight Access-Control-Allow-Origin mismatch");
  }
  if (!String(allowed.headers.Vary?.toString() ?? allowed.headers.vary ?? "")
    .split(",").some((value) => value.trim().toLowerCase() === "origin")) {
    throw new Error("Allowed preflight Vary must include Origin");
  }

  const hostile = await request("/api/v1/auth/wallet/challenges", {
    method: "OPTIONS",
    headers: {
      Origin: "https://127.0.0.1.evil.invalid",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  if (hostile.status !== 403) throw new Error("Hostile preflight must be denied");
  if (hostile.headers[ALLOW_ORIGIN_HEADER.toLowerCase()] !== undefined) {
    throw new Error("Hostile preflight must not receive Access-Control-Allow-Origin");
  }

  for (const entry of requestLedger) {
    if (entry.protocol !== "https:" || entry.hostname !== "127.0.0.1" || entry.port !== "") {
      throw new Error("Runner request escaped the exact default-port HTTPS origin");
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
    compose(["down", "--volumes", "--remove-orphans"], environment);
    const leftovers = [
      docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
      docker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
      docker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], environment, true),
    ].join("").trim();
    if (leftovers) throw new Error("Scoped QA Docker cleanup is incomplete");
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
