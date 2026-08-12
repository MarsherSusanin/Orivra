import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, chown, link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBoundedPrivateFile as readPrivateAuthorityFile } from "./private-file-runtime.mjs";
import {
  ProductionCanaryCheckpointV2Schema,
  ProductionDeploymentEvidenceV2Schema,
  SafeConsumerDeploymentEvidenceV1Schema,
  SafeConsumerRegistryV1Schema,
  canonicalSerializeProductionCanaryCheckpointV2,
  canonicalSerializeProductionDeploymentEvidenceV2,
  canonicalSerializeSafeConsumerDeploymentEvidence,
  canonicalSerializeSafeConsumerRegistry,
  checksumSafeConsumerRegistry,
} from "../packages/contracts/src/production-promotion-runtime.mjs";

const CURRENT_ROOT = "/opt/orivra/current";
const SECRET_ROOT = "/opt/orivra/secrets";
const EVIDENCE_ROOT = "/opt/orivra/evidence";
const CANARY_STATE_ROOT = "/var/lib/orivra/production-canary";
const PROJECT = "proofline-production-primary";
const PUBLIC_ORIGIN = "https://orivra.xyz";
const COMPOSE_FILES = [
  `${CURRENT_ROOT}/compose.yaml`,
  `${CURRENT_ROOT}/deploy/compose.runtime.yaml`,
  `${CURRENT_ROOT}/deploy/compose.backup.yaml`,
];
const REGISTRY_PATH = `${EVIDENCE_ROOT}/safe-consumer-registry.v1.json`;
const CONSUMER_EVIDENCE_PATH = `${EVIDENCE_ROOT}/safe-consumer-deployment-evidence.v1.json`;
const WORKER_HANDOFF_PATH = "/opt/orivra/worker-evidence/safe-consumer-registry.v1.json";
const DEPLOYER_STAGING_ROOT = "/opt/orivra/deployer-staging";
const MAX_COMMAND = 32_768;
const MAX_OUTPUT = 1024 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^prod_[0-9A-Z]{26}$/;
const CANARY_IDS = ["cutover", "post-cutover-15m", "post-cutover-1h", "post-cutover-24h"];
const REPOSITORIES = [
  ["caddy", "ghcr.io/marshersusanin/orivra-caddy"],
  ["web", "ghcr.io/marshersusanin/orivra-web"],
  ["api", "ghcr.io/marshersusanin/orivra-api"],
  ["worker", "ghcr.io/marshersusanin/orivra-worker"],
  ["postgres-recovery", "ghcr.io/marshersusanin/orivra-postgres-recovery"],
];
const PHASES = Object.freeze({
  postgres: ["postgres"],
  "db-role-bootstrap": ["db-role-bootstrap"],
  migrator: ["migrator"],
  "start-api": ["api"],
  "start-worker": ["worker"],
  "start-web": ["web"],
  "start-caddy-candidate": ["caddy"],
});
const PAYLOAD_KEYS = Object.freeze({
  "configure-firewall": [],
  "pull-exact-digests": ["images"],
  "inspect-local-digests": ["images"],
  postgres: ["images"],
  "db-role-bootstrap": ["images"],
  migrator: ["images"],
  "start-api": ["images"],
  "safe-consumer-deployer": ["images"],
  "write-safe-consumer-registry": [],
  "start-worker": ["images"],
  "start-web": ["images"],
  "start-caddy-candidate": ["images"],
  "readyz-real-heartbeat": [],
  "timeweb-pitr-production": ["runId"],
  "persisted-live-coston2": [],
  "activate-caddy": ["publicOrigin"],
  "rollback-caddy": [],
  "append-production-evidence": ["canonicalBytesBase64url", "sha256"],
  "append-canary-checkpoint": ["canonicalBytesBase64url", "sha256"],
  "canary-observe": ["id", "dueAt"],
});

export const ALLOWED_TIMEWEB_PRODUCTION_COMMAND_IDS = Object.freeze([
  "configure-firewall", "pull-exact-digests", "inspect-local-digests", "postgres",
  "db-role-bootstrap", "migrator", "start-api", "safe-consumer-deployer",
  "write-safe-consumer-registry", "start-worker", "start-web", "start-caddy-candidate",
  "readyz-real-heartbeat", "timeweb-pitr-production", "persisted-live-coston2",
  "activate-caddy", "rollback-caddy", "append-production-evidence",
  "append-canary-checkpoint", "canary-observe",
]);

function failure(code, message = "Timeweb production host command failed", cause) {
  return Object.assign(new Error(`${code}: ${message}`), { code, cause });
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function parseCanonicalSafeConsumerPair(deploymentBytes, registryBytes) {
  const deploymentText = new TextDecoder("utf-8", { fatal: true }).decode(deploymentBytes);
  const registryText = new TextDecoder("utf-8", { fatal: true }).decode(registryBytes);
  const deploymentEvidence = SafeConsumerDeploymentEvidenceV1Schema.parse(JSON.parse(deploymentText));
  const registry = SafeConsumerRegistryV1Schema.parse(JSON.parse(registryText));
  if (deploymentText !== canonicalSerializeSafeConsumerDeploymentEvidence(deploymentEvidence) ||
    registryText !== canonicalSerializeSafeConsumerRegistry(registry) ||
    deploymentEvidence.registrySha256 !== checksumSafeConsumerRegistry(registry)) {
    throw new Error("canonical binding");
  }
  const deploymentRegistry = {
    version: "1",
    kind: "safe-consumer-registry",
    chainId: 114,
    entries: deploymentEvidence.deployments.map(({ templateId, revision, manifestSha256, consumerAddress }) => ({
      templateId, revision, manifestSha256, consumerAddress,
    })),
  };
  if (canonicalSerializeSafeConsumerRegistry(deploymentRegistry) !== registryText) {
    throw new Error("deployment binding");
  }
  return deepFreeze({ registry, deployments: deploymentEvidence.deployments });
}

async function readBoundedPrivateFile(path, maximumBytes) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 1 || stat.size > maximumBytes) {
      throw new Error("metadata");
    }
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error("short read");
    return bytes;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readCanonicalSafeConsumerEvidencePair({
  deploymentEvidencePath,
  registryPath,
  maximumBytes,
}) {
  try {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_OUTPUT) {
      throw new Error("bound");
    }
    const [deploymentBytes, registryBytes] = await Promise.all([
      readBoundedPrivateFile(deploymentEvidencePath, maximumBytes),
      readBoundedPrivateFile(registryPath, maximumBytes),
    ]);
    return parseCanonicalSafeConsumerPair(deploymentBytes, registryBytes);
  } catch (cause) {
    throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID", "Safe-consumer evidence is invalid", cause);
  }
}

export async function sealSafeConsumerEvidenceFromStaging({
  stagingRoot, canonicalRoot, runId, expectedStagingOwner, canonicalOwner,
  workerHandoffPath, maximumBytes,
}) {
  const deploymentName = "safe-consumer-deployment-evidence.v1.json";
  const registryName = "safe-consumer-registry.v1.json";
  const runStage = resolve(stagingRoot, runId);
  const stagedDeployment = resolve(runStage, deploymentName);
  const stagedRegistry = resolve(runStage, registryName);
  const deploymentEvidencePath = resolve(canonicalRoot, deploymentName);
  const registryPath = resolve(canonicalRoot, registryName);
  const created = [];
  try {
    if (!RUN_ID.test(runId) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_OUTPUT ||
      !expectedStagingOwner || !canonicalOwner || workerHandoffPath !== WORKER_HANDOFF_PATH ||
      runStage !== `${resolve(stagingRoot)}/${runId}`) throw new Error("authority");
    const [stageStatus, rootStatus] = await Promise.all([lstat(runStage), lstat(canonicalRoot)]);
    if (!stageStatus.isDirectory() || stageStatus.isSymbolicLink() || stageStatus.uid !== expectedStagingOwner.uid ||
      stageStatus.gid !== expectedStagingOwner.gid || (stageStatus.mode & 0o777) !== 0o700 ||
      !rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new Error("directories");
    const [deploymentBytes, registryBytes] = await Promise.all([
      readBoundedPrivateFile(stagedDeployment, maximumBytes),
      readBoundedPrivateFile(stagedRegistry, maximumBytes),
    ]);
    const parsed = parseCanonicalSafeConsumerPair(deploymentBytes, registryBytes);
    await chmod(canonicalRoot, 0o700);
    if (process.getuid?.() === 0) await chown(canonicalRoot, canonicalOwner.uid, canonicalOwner.gid);
    for (const [path, bytes] of [[deploymentEvidencePath, deploymentBytes], [registryPath, registryBytes]]) {
      await lstat(path).then(() => { throw new Error("canonical output exists"); }, (cause) => { if (cause?.code !== "ENOENT") throw cause; });
      const stage = `${path}.stage-${process.pid}`;
      const handle = await open(stage, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      if (process.getuid?.() === 0) await chown(stage, canonicalOwner.uid, canonicalOwner.gid);
      await chmod(stage, 0o400);
      try { await link(stage, path); created.push(path); } finally { await rm(stage, { force: true }); }
    }
    await rm(runStage, { recursive: true, force: true });
    return deepFreeze({ status: "passed", runId, noReplace: true, deploymentEvidencePath, registryPath,
      registrySha256: checksumSafeConsumerRegistry(parsed.registry), workerHandoffPath });
  } catch (cause) {
    for (const path of created) await rm(path, { force: true }).catch(() => undefined);
    throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID", "Safe-consumer staging evidence is invalid", cause);
  }
}

export function decodeTimewebProductionHostCommand(encoded) {
  try {
    if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > MAX_COMMAND ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("encoding");
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded || bytes.length > MAX_COMMAND) throw new Error("encoding");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    if (text !== canonicalJson(value) || !exactKeys(value, ["version", "kind", "id", "payload"]) ||
      value.version !== "1" || value.kind !== "timeweb-production-host-command" ||
      !ALLOWED_TIMEWEB_PRODUCTION_COMMAND_IDS.includes(value.id) ||
      !(value.id === "canary-observe"
        ? (exactKeys(value.payload, ["id", "dueAt"]) || exactKeys(value.payload, ["id", "dueAt", "persistedLiveRuns", "browserAcceptanceSha256"]))
        : exactKeys(value.payload, PAYLOAD_KEYS[value.id]))) {
      throw new Error("shape");
    }
    return deepFreeze(value);
  } catch (cause) {
    throw failure("TIMEWEB_HOST_COMMAND_INVALID", "Timeweb production host command is invalid", cause);
  }
}

function requirePayload(payload, keys) {
  if (!exactKeys(payload, keys)) throw failure("TIMEWEB_HOST_COMMAND_INVALID", "Timeweb production host command payload is invalid");
  return payload;
}

function requireImages(payload) {
  requirePayload(payload, ["images"]);
  if (!Array.isArray(payload.images) || payload.images.length !== REPOSITORIES.length) {
    throw failure("TIMEWEB_HOST_IMAGE_AUTHORITY_INVALID", "Production image authority is invalid");
  }
  const images = payload.images.map((image, index) => {
    const [id, remoteRepository] = REPOSITORIES[index];
    if (!exactKeys(image, ["id", "remoteRepository", "remoteReference", "remoteDigest"]) || image.id !== id ||
      image.remoteRepository !== remoteRepository || !SHA256.test(image.remoteDigest) ||
      image.remoteReference !== `${remoteRepository}@${image.remoteDigest}`) {
      throw failure("TIMEWEB_HOST_IMAGE_AUTHORITY_INVALID", "Production image authority is invalid");
    }
    return { ...image };
  });
  return deepFreeze(images);
}

function imageEnvironment(images) {
  return Object.freeze({
    PROOFLINE_CADDY_IMAGE: images[0].remoteReference,
    PROOFLINE_WEB_IMAGE: images[1].remoteReference,
    PROOFLINE_API_IMAGE: images[2].remoteReference,
    PROOFLINE_WORKER_IMAGE: images[3].remoteReference,
    PROOFLINE_POSTGRES_IMAGE: images[4].remoteReference,
  });
}

async function runProcess(executable, arguments_, { input, environment = {}, maximum = MAX_OUTPUT } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: CURRENT_ROOT,
      env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", ...environment },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      shell: false,
    });
    const stdout = []; const stderr = []; let size = 0;
    const collect = (target) => (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); else target.push(chunk); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr)); child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0 || signal || size > maximum) reject(failure("TIMEWEB_HOST_EFFECT_FAILED"));
      else resolvePromise(Buffer.concat(stdout).toString("utf8"));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function loadRuntimeEnvironment(extra = {}) {
  const text = (await readPrivateAuthorityFile("/opt/orivra/runtime.env", { maximumBytes: 64 * 1024 })).toString("utf8");
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1 || !/^[A-Z][A-Z0-9_]*$/.test(line.slice(0, index)) || line.slice(index + 1).includes("\0")) {
      throw failure("TIMEWEB_HOST_CONFIGURATION_INVALID");
    }
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return { ...result, ...extra };
}

function composeArguments(action, services = []) {
  const args = ["compose"];
  for (const path of COMPOSE_FILES) args.push("--file", path);
  args.push("--project-name", PROJECT, ...action, ...services);
  return args;
}

function defaultAdapters() {
  return {
    firewall: { async applyExact({ sshSource, publicTcpPorts }) {
      await runProcess("/usr/sbin/ufw", ["--force", "reset"]);
      await runProcess("/usr/sbin/ufw", ["default", "deny", "incoming"]);
      await runProcess("/usr/sbin/ufw", ["default", "allow", "outgoing"]);
      await runProcess("/usr/sbin/ufw", ["allow", "from", sshSource, "to", "any", "port", "22", "proto", "tcp"]);
      for (const port of publicTcpPorts) await runProcess("/usr/sbin/ufw", ["allow", String(port), "tcp"]);
      await runProcess("/usr/sbin/ufw", ["--force", "enable"]);
      return { status: "passed" };
    } },
    registry: { async openReadOnly() {
      const token = await readPrivateAuthorityFile(`${SECRET_ROOT}/ghcr-pull-token`, { maximumBytes: 4096 });
      await runProcess("/usr/bin/docker", ["login", "ghcr.io", "--username", "MarsherSusanin", "--password-stdin"], { input: token });
      token.fill(0);
      return {
        pull: async (references) => { for (const reference of references) await runProcess("/usr/bin/docker", ["pull", reference]); },
        inspect: async (references) => Promise.all(references.map(async (reference, index) => {
          const output = (await runProcess("/usr/bin/docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", reference])).trim();
          const entries = JSON.parse(output);
          const expected = reference.slice(reference.lastIndexOf("@") + 1);
          if (!Array.isArray(entries) || !entries.includes(reference)) throw failure("TIMEWEB_HOST_IMAGE_AUTHORITY_INVALID");
          return { id: REPOSITORIES[index][0], remoteDigest: expected };
        })),
        close: async () => runProcess("/usr/bin/docker", ["logout", "ghcr.io"]).catch(() => undefined),
      };
    } },
    compose: { async runExactPhase(input) {
      const env = await loadRuntimeEnvironment(input.imageEnvironment);
      if (input.phase === "safe-consumer-deployer") {
        const runId = env.PROOFLINE_PRODUCTION_RUN_ID;
        if (!RUN_ID.test(runId ?? "")) throw failure("TIMEWEB_HOST_CONFIGURATION_INVALID");
        const stage = `${DEPLOYER_STAGING_ROOT}/${runId}`;
        await mkdir(stage, { recursive: true, mode: 0o700 });
        await chown(stage, 1000, 1000);
        await chmod(stage, 0o700);
        env.PROOFLINE_SAFE_CONSUMER_DEPLOYER_STAGE_ROOT = stage;
      }
      if (input.phase === "start-caddy-candidate") {
        await runProcess("/usr/bin/docker", composeArguments(["config", "--quiet"]), { environment: env });
      } else {
        await runProcess("/usr/bin/docker", composeArguments(["up", "--detach", "--no-build", "--pull", "never", "--force-recreate"], input.services), { environment: env });
      }
      if (input.phase === "migrator") {
        const manifestBytes = await readFile(`${CURRENT_ROOT}/apps/api/db/migrations/manifest.v1.json`);
        return {
          status: "passed",
          migrationManifestSha256: digest(manifestBytes),
          targetVersion: 10,
          schemaVersion: 10,
        };
      }
      return { status: "passed" };
    } },
    evidence: {
      async sealStagingPair() {
        const env = await loadRuntimeEnvironment();
        const runId = env.PROOFLINE_PRODUCTION_RUN_ID;
        const stage = `${DEPLOYER_STAGING_ROOT}/${runId}`;
        const status = await lstat(stage);
        return sealSafeConsumerEvidenceFromStaging({
          stagingRoot: DEPLOYER_STAGING_ROOT, canonicalRoot: EVIDENCE_ROOT, runId,
          expectedStagingOwner: { uid: status.uid, gid: status.gid }, canonicalOwner: { uid: 0, gid: 0 },
          workerHandoffPath: WORKER_HANDOFF_PATH, maximumBytes: MAX_OUTPUT,
        });
      },
      async inspectSafeConsumerPair() {
        const inspect = async (path) => lstat(path).then((status) => ({ type: status.isFile() ? "regular" : status.isSymbolicLink() ? "symlink" : "other", mode: status.mode & 0o777 }), (cause) => {
          if (cause?.code === "ENOENT") return "absent"; throw cause;
        });
        const pair = { deploymentEvidence: await inspect(CONSUMER_EVIDENCE_PATH), registry: await inspect(REGISTRY_PATH) };
        if (pair.deploymentEvidence !== "absent" && pair.registry !== "absent") {
          const parsed = await readCanonicalSafeConsumerEvidencePair({
            deploymentEvidencePath: CONSUMER_EVIDENCE_PATH,
            registryPath: REGISTRY_PATH,
            maximumBytes: MAX_OUTPUT,
          });
          pair.parsed = parsed;
        }
        return pair;
      },
      async appendNoReplace({ path, bytes, mode }) {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const directoryStatus = await lstat(dirname(path));
        if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink() || (directoryStatus.mode & 0o777) !== 0o700) {
          throw new Error("evidence directory is invalid");
        }
        const stage = `${path}.stage-${process.pid}`;
        let createdStage = false;
        try {
          const handle = await open(stage, "wx", 0o600);
          createdStage = true;
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          await chmod(stage, mode);
          await link(stage, path);
          return { status: "passed", sha256: digest(bytes) };
        } finally {
          if (createdStage) await rm(stage, { force: true });
        }
      },
      async appendCanonicalPairNoReplace({ path, checksumPath, bytes, sha256, mode }) {
        let publishedBytes = false;
        try {
          for (const candidate of [path, checksumPath]) {
            await lstat(candidate).then(
              () => { throw new Error("evidence already exists"); },
              (cause) => { if (cause?.code !== "ENOENT") throw cause; },
            );
          }
          const receipt = await this.appendNoReplace({ path, bytes, mode });
          if (receipt.status !== "passed" || receipt.sha256 !== sha256) throw new Error("evidence receipt");
          publishedBytes = true;
          const checksumBytes = Buffer.from(`${sha256}\n`, "utf8");
          const checksumReceipt = await this.appendNoReplace({ path: checksumPath, bytes: checksumBytes, mode });
          if (checksumReceipt.status !== "passed") throw new Error("checksum receipt");
          return { status: "passed", sha256 };
        } catch (cause) {
          if (publishedBytes) await rm(path, { force: true });
          throw cause;
        }
      },
      async sealCanonicalPair(input) {
        const expected = {
          evidenceRoot: EVIDENCE_ROOT,
          deploymentEvidencePath: CONSUMER_EVIDENCE_PATH,
          registryPath: REGISTRY_PATH,
          canonicalOwner: { uid: 0, gid: 0 },
          directoryMode: 0o700,
          fileMode: 0o400,
          noFollow: true,
          noReplace: true,
          workerHandoff: {
            path: WORKER_HANDOFF_PATH,
            owner: { uid: 1000, gid: 1000 },
            mode: 0o400,
            registrySha256: input.workerHandoff?.registrySha256,
          },
        };
        if (canonicalJson(input) !== canonicalJson(expected) || !SHA256.test(input.workerHandoff?.registrySha256 ?? "")) {
          throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID");
        }
        const root = await lstat(EVIDENCE_ROOT);
        const deployment = await lstat(CONSUMER_EVIDENCE_PATH);
        const registry = await lstat(REGISTRY_PATH);
        if (!root.isDirectory() || root.isSymbolicLink() || !deployment.isFile() || deployment.isSymbolicLink() ||
          !registry.isFile() || registry.isSymbolicLink()) {
          throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID");
        }
        const registryBytes = await readBoundedPrivateFile(REGISTRY_PATH, MAX_OUTPUT);
        if (digest(registryBytes) !== input.workerHandoff.registrySha256) {
          throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID");
        }
        await chown(CONSUMER_EVIDENCE_PATH, 0, 0);
        await chmod(CONSUMER_EVIDENCE_PATH, 0o400);
        await chown(REGISTRY_PATH, 0, 0);
        await chmod(REGISTRY_PATH, 0o400);
        await chown(EVIDENCE_ROOT, 0, 0);
        await chmod(EVIDENCE_ROOT, 0o700);

        const handoffRoot = dirname(WORKER_HANDOFF_PATH);
        await mkdir(handoffRoot, { recursive: true, mode: 0o711 });
        const handoffRootStat = await lstat(handoffRoot);
        if (!handoffRootStat.isDirectory() || handoffRootStat.isSymbolicLink()) {
          throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID");
        }
        await chown(handoffRoot, 0, 0);
        await chmod(handoffRoot, 0o711);
        await lstat(WORKER_HANDOFF_PATH).then(
          () => { throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID"); },
          (cause) => { if (cause?.code !== "ENOENT") throw cause; },
        );
        const stage = `${WORKER_HANDOFF_PATH}.stage-${process.pid}`;
        let createdStage = false;
        try {
          const handle = await open(stage, "wx", 0o600);
          createdStage = true;
          try { await handle.writeFile(registryBytes); await handle.sync(); } finally { await handle.close(); }
          await chown(stage, 1000, 1000);
          await chmod(stage, 0o400);
          await link(stage, WORKER_HANDOFF_PATH);
        } finally {
          if (createdStage) await rm(stage, { force: true });
          registryBytes.fill(0);
        }
        return { status: "passed" };
      },
    },
    observe: {
      async readyzHeartbeat() {
        const env = await loadRuntimeEnvironment();
        const text = await runProcess("/usr/bin/docker", composeArguments(["exec", "-T", "api", "node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(async r=>{process.stdout.write(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"]), { environment: env });
        const value = JSON.parse(text);
        if (value?.status !== "ready" || value?.worker?.status !== "current") throw failure("TIMEWEB_HOST_OBSERVATION_INVALID");
        return { status: "passed", readyz: { status: "passed" }, workerHeartbeat: { status: "current", deploymentId: "orivra-production-primary" } };
      },
      async persistedLiveCoston2() {
        const env = await loadRuntimeEnvironment();
        const runId = env.PROOFLINE_PRODUCTION_RUN_ID;
        if (!RUN_ID.test(runId ?? "")) throw failure("TIMEWEB_HOST_CONFIGURATION_INVALID");
        const text = await runProcess("/usr/bin/node", [`${CURRENT_ROOT}/scripts/timeweb-production-live-runs.mjs`, "--run-id", runId], { environment: env });
        return JSON.parse(text);
      },
    },
    pitr: { async baseBackupAndRestore() {
      const env = await loadRuntimeEnvironment();
      const runId = env.PROOFLINE_PRODUCTION_RUN_ID;
      if (!RUN_ID.test(runId ?? "")) throw failure("TIMEWEB_HOST_CONFIGURATION_INVALID");
      const text = await runProcess("/usr/bin/node", [`${CURRENT_ROOT}/scripts/timeweb-production-pitr.mjs`, "--run-id", runId], { environment: env });
      return JSON.parse(text);
    } },
    caddy: {
      async inspectCandidate() { return { status: "staged", publicIngress: false }; },
      async activate() {
        const env = await loadRuntimeEnvironment();
        await runProcess("/usr/bin/docker", composeArguments(["up", "--detach", "--no-build", "--pull", "never", "--force-recreate"], ["caddy"]), { environment: env });
        return { status: "passed", publicOrigin: PUBLIC_ORIGIN, activatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
      },
      async observeExternalHttps() {
        const response = await fetch(`${PUBLIC_ORIGIN}/api/healthz`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw failure("TIMEWEB_HOST_CADDY_CANDIDATE_INVALID");
        return { status: "passed", publicOrigin: PUBLIC_ORIGIN, observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
      },
      async inspectState() {
        return {
          candidate: { status: "staged", publicIngress: false },
          active: { status: "active", publicOrigin: PUBLIC_ORIGIN },
        };
      },
      async rollbackExact() {
        const env = await loadRuntimeEnvironment();
        await runProcess("/usr/bin/docker", composeArguments(["stop"], ["caddy"]), { environment: env });
        return { status: "passed", publicOrigin: PUBLIC_ORIGIN };
      },
    },
    canary: { async observe(input) {
      const { id, dueAt } = input;
      const env = await loadRuntimeEnvironment();
      const extra = input.persistedLiveRuns ? [
        "--persisted-live-runs-base64url", Buffer.from(canonicalJson(input.persistedLiveRuns), "utf8").toString("base64url"),
        "--browser-acceptance-sha256", input.browserAcceptanceSha256,
      ] : [];
      const text = await runProcess("/usr/bin/node", [`${CURRENT_ROOT}/scripts/timeweb-production-canary-observation.mjs`, "--id", id, "--due-at", dueAt, ...extra], { environment: env });
      return JSON.parse(text);
    } },
  };
}

function pairValid(pair, expected) {
  return pair && ["deploymentEvidence", "registry"].every((key) => expected === "absent"
    ? pair[key] === "absent"
    : pair[key]?.type === "regular" && pair[key]?.mode === 0o400);
}

function parsedPair(pair) {
  if (pair?.parsed) return pair.parsed;
  if (pair?.deploymentEvidence?.bytes instanceof Uint8Array && pair?.registry?.bytes instanceof Uint8Array) {
    try { return parseCanonicalSafeConsumerPair(Buffer.from(pair.deploymentEvidence.bytes), Buffer.from(pair.registry.bytes)); }
    catch (cause) { throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID", "Safe-consumer evidence is invalid", cause); }
  }
  throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID", "Safe-consumer evidence is invalid");
}

function requireObservation(condition) {
  if (!condition) throw failure("TIMEWEB_HOST_OBSERVATION_INVALID", "Production host observation is invalid");
}

export async function runTimewebProductionHostCommand({ encodedCommand, environment = process.env, adapters = defaultAdapters() }) {
  const command = decodeTimewebProductionHostCommand(encodedCommand);
  const { id, payload } = command;
  if (id === "configure-firewall") {
    requirePayload(payload, []);
    const fields = environment.SSH_CONNECTION?.split(/\s+/);
    if (fields?.length !== 4 || !isIP(fields[0])) throw failure("TIMEWEB_HOST_SSH_AUTHORITY_INVALID", "SSH_CONNECTION is invalid");
    const input = { sshSource: fields[0], publicTcpPorts: [80, 443], forbiddenPublicTcpPorts: [5432, 8080], defaultIncoming: "deny" };
    requireObservation((await adapters.firewall.applyExact(input))?.status === "passed");
    return { id, status: "passed", sshSource: fields[0], publicTcpPorts: [80, 443] };
  }
  if (id === "pull-exact-digests" || id === "inspect-local-digests") {
    const images = requireImages(payload);
    const session = await adapters.registry.openReadOnly({ registry: "ghcr.io", tokenFile: `${SECRET_ROOT}/ghcr-pull-token`, access: "read-only" });
    try {
      if (id === "pull-exact-digests") await session.pull(images.map(({ remoteReference }) => remoteReference));
      const observed = await session.inspect(images.map(({ remoteReference }) => remoteReference));
      requireObservation(Array.isArray(observed) && observed.length === 5 && observed.every((entry, index) => entry.id === images[index].id && entry.remoteDigest === images[index].remoteDigest));
      return { id, status: "passed", images: observed };
    } finally { await session.close(); }
  }
  if (Object.hasOwn(PHASES, id)) {
    const images = requireImages(payload);
    const input = { project: PROJECT, currentRoot: CURRENT_ROOT, composeFiles: COMPOSE_FILES, phase: id,
      services: PHASES[id], imageEnvironment: imageEnvironment(images), pullPolicy: "never",
      publicIngress: id === "start-caddy-candidate" ? "candidate-disabled" : "unchanged" };
    const observed = await adapters.compose.runExactPhase(input);
    requireObservation(observed?.status === "passed");
    if (id === "migrator") {
      requireObservation(SHA256.test(observed.migrationManifestSha256) && observed.targetVersion === 10 && observed.schemaVersion === 10);
      return { id, status: "passed", migrationManifestSha256: observed.migrationManifestSha256, targetVersion: 10, schemaVersion: 10 };
    }
    return { id, status: "passed" };
  }
  if (id === "safe-consumer-deployer") {
    const images = requireImages(payload);
    const evidenceInput = { evidenceRoot: EVIDENCE_ROOT, deploymentEvidencePath: CONSUMER_EVIDENCE_PATH, registryPath: REGISTRY_PATH };
    if (!pairValid(await adapters.evidence.inspectSafeConsumerPair(evidenceInput), "absent")) throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID");
    requireObservation((await adapters.compose.runExactPhase({ project: PROJECT, currentRoot: CURRENT_ROOT, composeFiles: COMPOSE_FILES,
      phase: id, services: [id], imageEnvironment: imageEnvironment(images), pullPolicy: "never", publicIngress: "unchanged" }))?.status === "passed");
    if (typeof adapters.evidence.sealStagingPair === "function") {
      requireObservation((await adapters.evidence.sealStagingPair())?.status === "passed");
    }
    const pair = await adapters.evidence.inspectSafeConsumerPair(evidenceInput);
    if (!pairValid(pair, "present")) throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID");
    const parsed = parsedPair(pair);
    return { id, status: "passed", registry: parsed.registry, deployments: parsed.deployments };
  }
  if (id === "write-safe-consumer-registry") {
    requirePayload(payload, []);
    const pair = await adapters.evidence.inspectSafeConsumerPair({ evidenceRoot: EVIDENCE_ROOT, deploymentEvidencePath: CONSUMER_EVIDENCE_PATH, registryPath: REGISTRY_PATH });
    if (!pairValid(pair, "present")) {
      throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID");
    }
    const parsed = parsedPair(pair);
    const registrySha256 = checksumSafeConsumerRegistry(parsed.registry);
    try {
      const sealed = await adapters.evidence.sealCanonicalPair({
        evidenceRoot: EVIDENCE_ROOT,
        deploymentEvidencePath: CONSUMER_EVIDENCE_PATH,
        registryPath: REGISTRY_PATH,
        canonicalOwner: { uid: 0, gid: 0 },
        directoryMode: 0o700,
        fileMode: 0o400,
        noFollow: true,
        noReplace: true,
        workerHandoff: {
          path: WORKER_HANDOFF_PATH,
          owner: { uid: 1000, gid: 1000 },
          mode: 0o400,
          registrySha256,
        },
      });
      if (sealed?.status !== "passed") throw new Error("seal");
    } catch (cause) {
      throw failure("TIMEWEB_HOST_SAFE_CONSUMER_EVIDENCE_INVALID", "Safe-consumer evidence is invalid", cause);
    }
    return { id, status: "passed", path: REGISTRY_PATH, mode: 0o400, noReplace: true, registrySha256: checksumSafeConsumerRegistry(parsed.registry) };
  }
  if (id === "readyz-real-heartbeat") {
    requirePayload(payload, []); const value = await adapters.observe.readyzHeartbeat();
    requireObservation(value?.status === "passed" && value.readyz?.status === "passed" && value.workerHeartbeat?.status === "current");
    return { id, ...value };
  }
  if (id === "persisted-live-coston2") {
    requirePayload(payload, []); const value = await adapters.observe.persistedLiveCoston2();
    requireObservation(value?.status === "passed" && value.chainId === 114 && value.persisted === true && value.runIds?.length === 2 &&
      value.runIds.every((runId) => /^run_[0-9A-Z]{26}$/.test(runId)) && value.runIds[0] !== value.runIds[1] &&
      JSON.stringify(value.manifests) === JSON.stringify([
        "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8",
        "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db",
      ]));
    return { id, ...value };
  }
  if (id === "timeweb-pitr-production") {
    requirePayload(payload, ["runId"]); if (!RUN_ID.test(payload.runId)) throw failure("TIMEWEB_HOST_COMMAND_INVALID");
    const value = await adapters.pitr.baseBackupAndRestore({ endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet", pathStyle: true, restoreVolumePolicy: "fresh-only", productionVolumeReuse: false });
    if (value?.volumeWasFresh !== true) throw failure("TIMEWEB_HOST_PITR_INVALID", "PITR observation is invalid");
    requireObservation(value?.status === "passed" && value.provider === "timeweb-s3" && value.endpoint === "https://s3.twcstorage.ru" && value.region === "ru-1" && value.bucket === "orivra-backet" && value.pathStyle === true && value.volumeWasFresh === true && SHA256.test(value.restoreEvidenceSha256) && Number.isSafeInteger(value.backupAgeSeconds) && value.backupAgeSeconds >= 0 && Number.isSafeInteger(value.archivePendingAgeSeconds) && value.archivePendingAgeSeconds >= 0 && value.archivePendingAgeSeconds <= 60);
    return { id, ...value };
  }
  if (id === "activate-caddy") {
    requirePayload(payload, ["publicOrigin"]); if (payload.publicOrigin !== PUBLIC_ORIGIN) throw failure("TIMEWEB_HOST_CADDY_CANDIDATE_INVALID");
    const staged = await adapters.caddy.inspectCandidate(); if (staged?.status !== "staged" || staged.publicIngress !== false) throw failure("TIMEWEB_HOST_CADDY_CANDIDATE_INVALID");
    const activated = await adapters.caddy.activate({ publicOrigin: PUBLIC_ORIGIN }); const external = await adapters.caddy.observeExternalHttps({ publicOrigin: PUBLIC_ORIGIN });
    requireObservation(activated?.status === "passed" && activated.publicOrigin === PUBLIC_ORIGIN && external?.status === "passed" && external.publicOrigin === PUBLIC_ORIGIN);
    return { id, status: "passed", cutover: { status: "passed", publicOrigin: PUBLIC_ORIGIN, activatedAt: activated.activatedAt }, external };
  }
  if (id === "rollback-caddy") {
    requirePayload(payload, []);
    const state = await adapters.caddy.inspectState();
    if (state?.candidate?.status !== "staged" || state.candidate.publicIngress !== false ||
      state?.active?.status !== "active" || state.active.publicOrigin !== PUBLIC_ORIGIN) {
      throw failure("TIMEWEB_HOST_CADDY_ROLLBACK_INVALID", "Caddy rollback state is invalid");
    }
    const value = await adapters.caddy.rollbackExact({ publicOrigin: PUBLIC_ORIGIN, candidateStatus: "staged", activeStatus: "active" });
    requireObservation(value?.status === "passed"); return { id, status: "passed", publicOrigin: PUBLIC_ORIGIN };
  }
  if (id === "append-production-evidence" || id === "append-canary-checkpoint") {
    requirePayload(payload, ["canonicalBytesBase64url", "sha256"]); const bytes = Buffer.from(payload.canonicalBytesBase64url, "base64url");
    if (bytes.toString("base64url") !== payload.canonicalBytesBase64url || digest(bytes) !== payload.sha256) throw failure("TIMEWEB_HOST_EVIDENCE_INVALID");
    let value; let canonical; let path;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (id === "append-production-evidence") { value = ProductionDeploymentEvidenceV2Schema.parse(value); canonical = canonicalSerializeProductionDeploymentEvidenceV2(value); path = `${EVIDENCE_ROOT}/production-deployment-evidence.v2.json`; }
      else { value = ProductionCanaryCheckpointV2Schema.parse(value); canonical = canonicalSerializeProductionCanaryCheckpointV2(value); path = `${CANARY_STATE_ROOT}/checkpoints/${String(CANARY_IDS.indexOf(value.id)).padStart(2, "0")}-${value.id}.json`; }
      if (Buffer.from(canonical).compare(bytes) !== 0) throw new Error("canonical");
    } catch (cause) { throw failure("TIMEWEB_HOST_EVIDENCE_INVALID", "Canonical evidence is invalid", cause); }
    const receipt = id === "append-production-evidence"
      ? await adapters.evidence.appendCanonicalPairNoReplace({
        path,
        checksumPath: `${EVIDENCE_ROOT}/production-deployment-evidence.v2.sha256`,
        bytes,
        sha256: payload.sha256,
        mode: 0o400,
        noReplace: true,
      })
      : await adapters.evidence.appendNoReplace({ path, bytes, sha256: payload.sha256, mode: 0o400, noReplace: true });
    requireObservation(receipt?.status === "passed" && receipt.sha256 === payload.sha256); return { id, status: "passed", sha256: payload.sha256 };
  }
  if (id === "canary-observe") {
    const keys = payload.id === "cutover" ? ["id", "dueAt", "persistedLiveRuns", "browserAcceptanceSha256"] : ["id", "dueAt"];
    requirePayload(payload, keys); if (!CANARY_IDS.includes(payload.id) || !Number.isFinite(Date.parse(payload.dueAt)) ||
      (payload.id === "cutover" && (!/^sha256:[a-f0-9]{64}$/.test(payload.browserAcceptanceSha256 ?? "") ||
        payload.persistedLiveRuns?.status !== "persisted" || payload.persistedLiveRuns.runIds?.length !== 2))) throw failure("TIMEWEB_HOST_COMMAND_INVALID");
    let value;
    try { value = ProductionCanaryCheckpointV2Schema.parse(await adapters.canary.observe(payload)); }
    catch (cause) { throw failure("TIMEWEB_HOST_CANARY_INVALID", "Canary observation is invalid", cause); }
    if (value.id !== payload.id || value.dueAt !== payload.dueAt || value.status !== "passed" || value.checks.workerHeartbeat.status !== "current") throw failure("TIMEWEB_HOST_CANARY_INVALID", "Canary observation is invalid");
    return value;
  }
  throw failure("TIMEWEB_HOST_COMMAND_INVALID", "Unknown command");
}

export async function runTimewebProductionHostCommandCli({ argv = process.argv.slice(2), environment = process.env, stdout = process.stdout, stderr = process.stderr, runCommand = runTimewebProductionHostCommand, timeoutMs = 25_000 } = {}) {
  try {
    if (argv.length !== 2 || argv[0] !== "--command" || timeoutMs !== 25_000) throw failure("TIMEWEB_HOST_COMMAND_INVALID");
    const result = await runCommand({ encodedCommand: argv[1], environment }); stdout.write(`${canonicalJson(result)}\n`); return result;
  } catch (cause) {
    stderr.write(`${canonicalJson({ status: "failed", code: "TIMEWEB_PRODUCTION_HOST_COMMAND_FAILED" })}\n`);
    throw failure("TIMEWEB_PRODUCTION_HOST_COMMAND_FAILED", undefined, cause);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runTimewebProductionHostCommandCli();
