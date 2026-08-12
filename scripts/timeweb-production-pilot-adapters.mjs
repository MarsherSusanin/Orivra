import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "./backup-evidence-validation.mjs";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const DA = "https://ctn2-data-availability.flare.network";
const HOST_RUNNER = "/opt/orivra/current/scripts/timeweb-production-host-command.mjs";
const MAX_OUTPUT = 1024 * 1024;
const PROJECT = "proofline-production-primary";
const HOST_MAPPINGS = Object.freeze({
  "pull-exact-digests": "pull-exact-digests",
  "inspect-local-digests": "inspect-local-digests",
  "start-postgres": "postgres",
  "db-role-bootstrap": "db-role-bootstrap",
  migrator: "migrator",
  "start-api": "start-api",
  "safe-consumer-deployer": "safe-consumer-deployer",
  "write-safe-consumer-registry": "write-safe-consumer-registry",
  "start-worker": "start-worker",
  "start-web": "start-web",
  "start-caddy-candidate": "start-caddy-candidate",
  "readyz-real-heartbeat": "readyz-real-heartbeat",
  "timeweb-pitr-production": "timeweb-pitr-production",
  "persisted-live-coston2": "persisted-live-coston2",
});

function failure(code, message, cause) { return Object.assign(new Error(message), { code, cause }); }
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hexSha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

function encodeHostCommand(id, payload) {
  return Buffer.from(canonicalJson({
    version: "1",
    kind: "timeweb-production-host-command",
    id,
    payload,
  }), "utf8").toString("base64url");
}

export function createTimewebProductionHostCommandAdapter({ images, runId, invoke }) {
  if (!Array.isArray(images) || images.length !== 5 || !/^prod_[0-9A-Z]{26}$/.test(runId ?? "") || typeof invoke !== "function") {
    throw failure("PRODUCTION_HOST_COMMAND_INVALID", "Production host command adapter is invalid");
  }
  const frozenImages = structuredClone(images);
  return Object.freeze({ async run(command) {
    if (command?.id === "install-read-only-pull-credential" && command.environment === "production" && command.composeProject === PROJECT) {
      return Object.freeze({ status: "passed", access: "read-only", hostEffect: false });
    }
    const hostId = HOST_MAPPINGS[command?.id];
    if (!hostId || command.environment !== "production" || command.composeProject !== PROJECT) {
      throw failure("PRODUCTION_HOST_COMMAND_INVALID", "Production host command is invalid");
    }
    const payload = hostId === "timeweb-pitr-production"
      ? { runId }
      : ["pull-exact-digests", "inspect-local-digests", "postgres", "db-role-bootstrap", "migrator", "start-api", "safe-consumer-deployer", "start-worker", "start-web", "start-caddy-candidate"].includes(hostId)
        ? { images: frozenImages }
        : {};
    return invoke({ executable: "/usr/bin/node", arguments: [HOST_RUNNER, "--command", encodeHostCommand(hostId, payload)] });
  } });
}

async function readPrivateFile(path, maximum = 4096) {
  let handle;
  try {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new Error("path");
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 1 || stat.size > maximum) throw new Error("metadata");
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error("short read");
    return bytes;
  } finally { await handle?.close().catch(() => undefined); }
}

async function run(executable, arguments_, { input, maximum = MAX_OUTPUT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" } });
    const out = []; const err = []; let size = 0;
    const collect = (target) => (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); else target.push(chunk); };
    child.stdout.on("data", collect(out)); child.stderr.on("data", collect(err));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0 || signal || size > maximum) reject(failure("PRODUCTION_HOST_COMMAND_FAILED", "Production host command failed"));
      else resolve(Buffer.concat(out).toString("utf8"));
    });
    if (input) child.stdin.end(input);
  });
}

async function rpc(method, params = []) {
  const response = await fetch(RPC, { method: "POST", redirect: "error", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw failure("PRODUCTION_PREFLIGHT_INVALID", "Coston2 preflight failed");
  const payload = await response.json();
  if (payload?.error || typeof payload?.result !== "string") throw failure("PRODUCTION_PREFLIGHT_INVALID", "Coston2 preflight failed");
  return payload.result;
}

function awsDate(date) { return date.toISOString().replace(/[:-]|\.\d{3}/g, ""); }
function encodePath(value) { return value.split("/").map((part) => encodeURIComponent(part)).join("/"); }
function canonicalQuery(entries) { return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&"); }

async function signedS3Request({ method, key = "", query = [], body = new Uint8Array(), accessKey, secretKey }) {
  const date = new Date(); const amzDate = awsDate(date); const dateStamp = amzDate.slice(0, 8);
  const host = "s3.twcstorage.ru"; const path = `/orivra-backet${key ? `/${encodePath(key)}` : ""}`;
  const queryText = canonicalQuery(query); const payloadHash = hexSha256(body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `${method}\n${path}\n${queryText}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/ru-1/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hexSha256(canonicalRequest)}`;
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp); const regionKey = hmac(dateKey, "ru-1");
  const serviceKey = hmac(regionKey, "s3"); const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return fetch(`https://${host}${path}${queryText ? `?${queryText}` : ""}`, { method, redirect: "error", body: method === "GET" || method === "HEAD" ? undefined : body,
    headers: { authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate }, signal: AbortSignal.timeout(20_000) });
}

async function probeTimeweb(accessPath, secretPath) {
  const accessBytes = await readPrivateFile(accessPath); const secretBytes = await readPrivateFile(secretPath);
  const accessKey = accessBytes.toString("utf8").trim(); const secretKey = secretBytes.toString("utf8").trim();
  const key = `proofline/v1/production-preflight/${randomBytes(16).toString("hex")}`; const payload = randomBytes(32);
  try {
    const put = await signedS3Request({ method: "PUT", key, body: payload, accessKey, secretKey }); if (![200, 201].includes(put.status)) throw new Error("PUT");
    const head = await signedS3Request({ method: "HEAD", key, accessKey, secretKey }); if (head.status !== 200) throw new Error("HEAD");
    const list = await signedS3Request({ method: "GET", query: [["list-type", "2"], ["prefix", key]], accessKey, secretKey });
    if (list.status !== 200 || !(await list.text()).includes(`<Key>${key}</Key>`)) throw new Error("LIST");
    const get = await signedS3Request({ method: "GET", key, accessKey, secretKey });
    if (get.status !== 200 || !Buffer.from(await get.arrayBuffer()).equals(payload)) throw new Error("GET");
    const del = await signedS3Request({ method: "DELETE", key, accessKey, secretKey }); if (![200, 204].includes(del.status)) throw new Error("DELETE");
    return ["PUT", "HEAD", "LIST", "GET", "DELETE"].map((operation) => ({ operation, status: "passed" }));
  } catch (cause) {
    await signedS3Request({ method: "DELETE", key, accessKey, secretKey }).catch(() => undefined);
    throw failure("PRODUCTION_PREFLIGHT_INVALID", "Timeweb S3 capability preflight failed", cause);
  } finally { accessBytes.fill(0); secretBytes.fill(0); }
}

async function ghcrImages(authority, tokenPath) {
  const tokenBytes = await readPrivateFile(tokenPath); const token = tokenBytes.toString("utf8").trim();
  try {
    for (const image of authority.images) {
      const repository = image.remoteRepository.slice("ghcr.io/".length);
      const endpoint = new URL("https://ghcr.io/token"); endpoint.searchParams.set("service", "ghcr.io"); endpoint.searchParams.set("scope", `repository:${repository}:pull`);
      const auth = Buffer.from(`MarsherSusanin:${token}`, "utf8").toString("base64");
      const tokenResponse = await fetch(endpoint, { headers: { authorization: `Basic ${auth}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      const bearer = (await tokenResponse.json())?.token; if (!tokenResponse.ok || typeof bearer !== "string") throw new Error("token");
      const head = await fetch(`https://ghcr.io/v2/${repository}/manifests/${image.remoteDigest}`, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${bearer}`, accept: "application/vnd.oci.image.manifest.v1+json" } });
      if (!head.ok || head.headers.get("docker-content-digest") !== image.remoteDigest) throw new Error("manifest");
    }
    return authority.images.map(({ id, remoteReference, remoteDigest }) => ({ id, remoteReference, remoteDigest }));
  } catch (cause) { throw failure("PRODUCTION_PREFLIGHT_INVALID", "GHCR preflight failed", cause); }
  finally { tokenBytes.fill(0); }
}

async function sshKeyscan(host) {
  const text = await run("ssh-keyscan", ["-T", "10", "-t", "ed25519", host], { maximum: 16_384 });
  const line = text.split("\n").find((entry) => entry && !entry.startsWith("#"));
  const fields = line?.trim().split(/\s+/); if (fields?.length !== 3 || fields[1] !== "ssh-ed25519") throw failure("PRODUCTION_PREFLIGHT_INVALID", "SSH host key preflight failed");
  return { line, sha256: sha256(Buffer.from(fields[2], "base64")) };
}

function requiredEnvironmentPath(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) throw failure("PRODUCTION_PILOT_ADAPTERS_UNAVAILABLE", "Production pilot adapter path is unavailable");
  return value;
}

export async function createProductionPilotAdapters({ secretFiles }) {
  const fileInputs = Object.freeze({
    ghcrPullTokenFile: secretFiles.ghcrPullToken, sshPrivateKeyFile: secretFiles.sshPrivateKey,
    timewebS3AccessKeyFile: secretFiles.timewebAccessKey, timewebS3SecretKeyFile: secretFiles.timewebSecretKey,
    backupEncryptionKeyFile: secretFiles.backupEncryptionKey,
    productionSecretRoot: requiredEnvironmentPath("PROOFLINE_PRODUCTION_SECRET_ROOT"),
    replayBundleFile: requiredEnvironmentPath("PROOFLINE_WORKER_REPLAY_BUNDLE_FILE"),
    replayPreflightReportFile: requiredEnvironmentPath("PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE"),
    backupEvidenceFile: requiredEnvironmentPath("PROOFLINE_BACKUP_EVIDENCE_FILE"),
  });
  const relayerKeyPath = requiredEnvironmentPath("PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE");
  let activeSession;
  let provisionedTarget;

  async function remote(request) {
    if (!activeSession) throw failure("PRODUCTION_HOST_COMMAND_FAILED", "Production host session is not open");
    return activeSession.request(request);
  }

  async function createPinnedSession(endpoint, expectedHostKeySha256, hostAuthority) {
    const observed = await sshKeyscan(endpoint.host);
    if (observed.sha256 !== expectedHostKeySha256) {
      throw failure("PRODUCTION_SSH_HOST_KEY_MISMATCH", "Production SSH host key mismatch");
    }
    const root = await mkdtemp(join(tmpdir(), "orivra-known-host-"));
    const knownHosts = join(root, "known_hosts");
    await writeFile(knownHosts, `${observed.line}\n`, { mode: 0o400 });
    await chmod(root, 0o500);
    const baseArgs = [
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
      "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHosts}`,
      "-o", "ConnectTimeout=15", "-i", secretFiles.sshPrivateKey,
      `root@${endpoint.host}`,
    ];
    const invoke = async ({ executable, arguments: arguments_ }) => {
      if (executable !== "/usr/bin/node") throw failure("PRODUCTION_HOST_COMMAND_INVALID", "Production host command is invalid");
      const text = await run("ssh", [...baseArgs, executable, ...arguments_]);
      try { return JSON.parse(text); }
      catch (cause) { throw failure("PRODUCTION_HOST_COMMAND_FAILED", "Production host response is invalid", cause); }
    };
    const hostAdapter = hostAuthority ? createTimewebProductionHostCommandAdapter({
      images: hostAuthority.images,
      runId: hostAuthority.runId,
      invoke,
    }) : undefined;
    const session = {
      observedHostKeySha256: observed.sha256,
      async request(request) {
        return invoke({ executable: "/usr/bin/node", arguments: [HOST_RUNNER, "--command", encodeHostCommand(request.id, request.payload ?? {})] });
      },
      async run(command) {
        if (!hostAdapter) throw failure("PRODUCTION_HOST_COMMAND_INVALID", "Production host command authority is unavailable");
        if (command?.id === "canary-observe" && command.checkpointId === "cutover") {
          return invoke({ executable: "/usr/bin/node", arguments: [HOST_RUNNER, "--command", encodeHostCommand("canary-observe", { id: "cutover", dueAt: command.dueAt })] });
        }
        return hostAdapter.run(command);
      },
      async close() {
        await chmod(root, 0o700).catch(() => undefined);
        await rm(root, { recursive: true, force: true });
        if (activeSession === session) activeSession = undefined;
      },
    };
    return session;
  }

  return {
    fileInputs,
    inspectFile: lstat,
    preflightAdapter: { async verify(id, { authority, files }) {
      const base = { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed" };
      if (id === "dns-target") { const addresses = [...new Set(await resolve4(authority.target.dnsName))].sort(); return { ...base, dnsName: authority.target.dnsName, addresses }; }
      if (id === "ssh-host-key") { const observed = await sshKeyscan(authority.target.sshEndpoint.host); return { ...base, host: authority.target.sshEndpoint.host, port: 22, expectedHostKeySha256: authority.target.sshEndpoint.hostKeySha256, observedHostKeySha256: observed.sha256 }; }
      if (id === "read-only-ghcr") return { ...base, registry: "ghcr.io", access: "read-only", images: await ghcrImages(authority, files.ghcrPullTokenFile) };
      if (id === "secret-files") return { ...base, fileIds: Object.keys(files).sort(), valuesExposed: false };
      if (id === "timeweb-s3-authority") return { ...base, authoritySha256: authority.objectStoreAuthoritySha256, authorityMode: "shared-pilot",
        endpoint: authority.objectStore.endpoint, region: authority.objectStore.region, bucket: authority.objectStore.bucket, pathStyle: true,
        capabilities: await probeTimeweb(files.timewebS3AccessKeyFile, files.timewebS3SecretKeyFile) };
      if (id === "replay-bundle") {
        const [bundle, report] = await Promise.all([
          readPrivateFile(files.replayBundleFile, MAX_OUTPUT),
          readPrivateFile(files.replayPreflightReportFile, MAX_OUTPUT),
        ]);
        return { ...base, bundleSha256: sha256(bundle), reportSha256: sha256(report) };
      }
      if (id === "safe-consumer-manifests") return { ...base, manifests: [["open-meteo-current-weather", "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8"], ["eth-usd", "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db"]] };
      if (id === "live-coston2") {
        const keyBytes = await readPrivateFile(relayerKeyPath, 128); let account;
        try { const text = keyBytes.toString("utf8").trim(); const hex = keyBytes.length === 32 ? `0x${keyBytes.toString("hex")}` : text; account = privateKeyToAccount(hex); }
        finally { keyBytes.fill(0); }
        const chainId = Number.parseInt(await rpc("eth_chainId"), 16); const balanceWei = BigInt(await rpc("eth_getBalance", [account.address, "latest"])).toString();
        return { ...base, chainId, rpcUrl: RPC, dataAvailabilityUrl: DA, relayerAddress: account.address, balanceWei, authorization: "configured" };
      }
      throw failure("PRODUCTION_PREFLIGHT_INVALID", "Unknown production preflight");
    } },
    productionAdapter: {
      async provision({ target }) {
        provisionedTarget = structuredClone(target);
        return { owned: false, deploymentId: target.deploymentId, sshHost: target.sshEndpoint.host };
      },
      async applyFirewall() {
        if (!provisionedTarget) throw failure("PRODUCTION_HOST_COMMAND_FAILED", "Production target is unavailable");
        const oneShot = await createPinnedSession(
          provisionedTarget.sshEndpoint,
          provisionedTarget.sshEndpoint.hostKeySha256,
        );
        try { return await oneShot.request({ id: "configure-firewall", payload: {} }); }
        finally { await oneShot.close(); }
      },
    },
    sshAdapter: { async openPinnedSession({ endpoint, expectedHostKeySha256, images, runId }) {
      const session = await createPinnedSession(endpoint, expectedHostKeySha256, { images, runId });
      activeSession = session;
      return session;
    } },
    appendProductionEvidence: (entry) => remote({ id: "append-production-evidence", payload: { canonicalBytesBase64url: Buffer.from(entry.bytes).toString("base64url"), sha256: sha256(entry.bytes) } }),
    cutoverAdapter: {
      activateCaddy: ({ publicOrigin }) => remote({ id: "activate-caddy", payload: { publicOrigin } }),
      async observeExternalHttps({ publicOrigin }) { const response = await fetch(`${publicOrigin}/api/healthz`, { redirect: "error", signal: AbortSignal.timeout(20_000) }); if (!response.ok) throw failure("PRODUCTION_CUTOVER_FAILED", "External HTTPS failed"); return { status: "passed", publicOrigin, observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }; },
      rollbackCaddy: () => remote({ id: "rollback-caddy", payload: {} }),
    },
    checkpointStore: { append: (entry) => {
      const bytes = Buffer.from(canonicalJson(entry), "utf8");
      return remote({ id: "append-canary-checkpoint", payload: { canonicalBytesBase64url: bytes.toString("base64url"), sha256: sha256(bytes) } });
    } },
    teardownCandidate: () => undefined,
  };
}

export async function createProductionCanaryObservation({ id, dueAt }) {
  const text = await run("/usr/bin/node", [HOST_RUNNER, "--command", encodeHostCommand("canary-observe", { id, dueAt })]);
  try { return JSON.parse(text); } catch (cause) { throw failure("CANARY_OBSERVATION_INVALID", "Production canary observation is invalid", cause); }
}
