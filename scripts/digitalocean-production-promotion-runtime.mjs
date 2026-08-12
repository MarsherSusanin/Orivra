import {
  ProductionDeploymentEvidenceV1Schema,
  ProductionPromotionEvidenceV1Schema,
  canonicalSerializeProductionDeploymentEvidence,
  canonicalSerializeProductionPromotionEvidence,
  checksumProductionDeploymentEvidence,
  checksumProductionPromotionAuthorization,
  checksumProductionTarget,
} from "../packages/contracts/src/production-promotion-runtime.mjs";
import {
  createProductionPromotionPlan,
  selectSchemaCompatibleRollback,
  verifyProductionPromotionHandoff,
} from "../packages/domain/src/production-promotion-runtime.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const preflightIds = Object.freeze([
  "dns-target", "ssh-host-key", "read-only-ghcr", "secret-files",
  "spaces-authority", "replay-bundle", "safe-consumer", "live-coston2",
]);
const commandIds = Object.freeze([
  "install-read-only-pull-credential", "pull-exact-digests", "inspect-local-digests",
  "start-postgres", "db-role-bootstrap", "migrator", "start-api", "start-worker",
  "start-web", "start-caddy", "healthz", "readyz-real-heartbeat",
  "spaces-pitr-production", "persisted-live-coston2",
]);
const canaryDefinitions = Object.freeze([
  ["pre-cutover", 0], ["post-cutover-15m", 900], ["post-cutover-1h", 3600],
  ["post-cutover-24h", 86400], ["post-cutover-72h", 259200], ["post-cutover-7d", 604800],
]);
const fileKeys = Object.freeze([
  "doApiTokenFile", "ghcrPullTokenFile", "sshPrivateKeyFile", "productionSecretRoot",
  "replayBundleFile", "replayPreflightReportFile", "backupEvidenceFile",
]);

function failure(code, message, details) {
  return Object.assign(new Error(message), { code, ...details });
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function parseRun(bytes, operatorId) {
  try {
    if (!(bytes instanceof Uint8Array)) throw new Error("missing bytes");
    const text = decoder.decode(bytes);
    const value = JSON.parse(text);
    if (!exactKeys(value, ["runId", "operatorId", "completedAt"]) ||
      !/^prod_[0-9A-Z]{26}$/.test(value.runId) || value.operatorId !== operatorId ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.completedAt) ||
      text !== canonicalJson(value)) throw new Error("invalid run");
    return deepFreeze(structuredClone(value));
  } catch (cause) {
    throw failure("PRODUCTION_PROMOTION_INPUT_INVALID", "Production promotion input is invalid", { cause });
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function snapshotFiles(value) {
  if (!exactKeys(value, fileKeys)) throw failure("PRODUCTION_PROMOTION_INPUT_INVALID", "Production promotion input is invalid");
  const copy = {};
  for (const key of fileKeys) {
    const path = value[key];
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) {
      throw failure("PRODUCTION_PROMOTION_INPUT_INVALID", "Production promotion input is invalid");
    }
    copy[key] = path;
  }
  return deepFreeze(copy);
}

async function verifyFileInputs(files, inspectFile) {
  if (typeof inspectFile !== "function") throw failure("PRODUCTION_PREFLIGHT_FAILED", "Production preflight failed");
  for (const key of fileKeys) {
    const stat = await inspectFile(files[key]);
    const root = key === "productionSecretRoot";
    const accepted = stat && !stat.isSymbolicLink() && (root ? stat.isDirectory() : stat.isFile()) &&
      (stat.mode & 0o777) === (root ? 0o500 : 0o400) && (root || (Number.isSafeInteger(stat.size) && stat.size > 0));
    if (!accepted) throw failure("PRODUCTION_PREFLIGHT_FAILED", "Production preflight failed", { check: "secret-files" });
  }
}

function commandFor(id, authority) {
  return deepFreeze({
    id,
    environment: "production",
    composeProject: authority.target.composeProject,
    imageReferences: id === "pull-exact-digests" || id === "inspect-local-digests"
      ? authority.images.map(({ id: imageId, remoteReference }) => ({ id: imageId, remoteReference }))
      : undefined,
  });
}

function requireObservation(id, observed, authority) {
  if (!observed || observed.status !== "passed") throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  if (id === "inspect-local-digests" && (!Array.isArray(observed.images) || observed.images.length !== authority.images.length ||
    observed.images.some((image, index) => image.id !== authority.images[index].id || image.remoteDigest !== authority.images[index].remoteDigest))) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "migrator" && (!/^sha256:[a-f0-9]{64}$/.test(observed.migrationManifestSha256 ?? "") || observed.targetVersion !== 10 || observed.schemaVersion !== 10)) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "readyz-real-heartbeat" && (observed.readyz?.status !== "passed" || observed.workerHeartbeat?.status !== "current")) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "spaces-pitr-production" && (!/^sha256:[a-f0-9]{64}$/.test(observed.restoreEvidenceSha256 ?? "") ||
    !Number.isSafeInteger(observed.backupAgeSeconds) || observed.backupAgeSeconds < 0 ||
    !Number.isSafeInteger(observed.archivePendingAgeSeconds) || observed.archivePendingAgeSeconds < 0)) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "persisted-live-coston2" && (!/^run_[0-9A-Z]{26}$/.test(observed.runId ?? "") || observed.persisted !== true)) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  return deepFreeze(structuredClone(observed));
}

function addSeconds(timestamp, seconds) {
  return new Date(Date.parse(timestamp) + seconds * 1000).toISOString().replace(".000Z", "Z");
}

function deploymentEvidence(authority, run, observations) {
  return ProductionDeploymentEvidenceV1Schema.parse({
    version: "1", kind: "digitalocean-production-deployment-evidence", status: "passed",
    verification: "verified", productionClaim: true, producer: authority.publication.producer,
    publicationEvidenceSha256: authority.publicationEvidenceSha256,
    stagingDeploymentEvidenceSha256: authority.stagingDeploymentEvidenceSha256,
    frozenReleaseManifestSha256: authority.publication.frozenRelease.frozenReleaseManifestSha256,
    promotionAuthorizationSha256: checksumProductionPromotionAuthorization(authority.authorization),
    target: authority.target, run,
    pullCredential: { registry: "ghcr.io", access: "read-only" }, images: authority.images,
    topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
    database: {
      volumeIdentitySha256: checksumProductionTarget(authority.target),
      migrationManifestSha256: observations.migrator.migrationManifestSha256,
      targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" },
    },
    checks: {
      exactDigestPull: { status: "passed" }, healthz: { status: "passed" },
      readyz: observations["readyz-real-heartbeat"].readyz,
      workerHeartbeat: observations["readyz-real-heartbeat"].workerHeartbeat,
      spacesPitr: { restoreEvidenceSha256: observations["spaces-pitr-production"].restoreEvidenceSha256, status: "passed" },
      liveCoston2: { runId: observations["persisted-live-coston2"].runId, status: "persisted" },
    },
  });
}

function promotionEvidence(authority, run, deployment, checkpoints) {
  return ProductionPromotionEvidenceV1Schema.parse({
    version: "1", kind: "digitalocean-production-promotion-evidence", status: "passed",
    verification: "verified", promotionClaim: true, producer: authority.publication.producer,
    publicationEvidenceSha256: authority.publicationEvidenceSha256,
    productionDeploymentEvidenceSha256: checksumProductionDeploymentEvidence(deployment),
    runId: run.runId, operatorId: run.operatorId, startedAt: checkpoints[0].observedAt,
    completedAt: checkpoints.at(-1).observedAt,
    canary: { durationSeconds: 604800, checkpoints },
  });
}

export async function runDigitalOceanProductionPromotion(input) {
  let authority;
  let run;
  let files;
  try {
    authority = verifyProductionPromotionHandoff(input);
    run = parseRun(input.runBytes, authority.authorization.operatorId);
    files = snapshotFiles(input.fileInputs);
  } catch (cause) {
    if (cause?.code === "PRODUCTION_PROMOTION_INPUT_INVALID") throw cause;
    throw failure("PRODUCTION_PROMOTION_INPUT_INVALID", "Production promotion input is invalid", { cause });
  }
  await verifyFileInputs(files, input.inspectFile);
  for (const id of preflightIds) {
    const observation = await input.preflightAdapter?.verify(id, { authority, files });
    if (!observation || observation.status !== "passed") throw failure("PRODUCTION_PREFLIGHT_FAILED", "Production preflight failed", { check: id });
  }

  const plan = createProductionPromotionPlan(authority);
  let resource;
  let session;
  let original;
  let result;
  let cutover = false;
  try {
    resource = await input.productionAdapter.provision({ environment: "production", target: authority.target, plan });
    await input.productionAdapter.applyFirewall({ resource, ingress: [80, 443], environment: "production" });
    session = await input.sshAdapter.openPinnedSession({
      endpoint: { host: resource.sshHost, port: 22 }, expectedHostKeySha256: authority.target.sshEndpoint.hostKeySha256,
    });
    if (!session || session.observedHostKeySha256 !== authority.target.sshEndpoint.hostKeySha256 || typeof session.run !== "function") {
      throw failure("PRODUCTION_SSH_HOST_KEY_MISMATCH", "Production SSH host key mismatch");
    }
    const observations = {};
    for (const id of commandIds) observations[id] = requireObservation(id, await session.run(commandFor(id, authority)), authority);
    const deployment = deploymentEvidence(authority, run, observations);
    await input.appendProductionEvidence({ filename: "production-deployment-evidence.v1.json", bytes: Buffer.from(canonicalSerializeProductionDeploymentEvidence(deployment), "utf8") });
    cutover = true;
    const checkpoints = [];
    for (const [id, seconds] of canaryDefinitions) {
      const observedAt = addSeconds(run.completedAt, seconds);
      const observed = await session.run(deepFreeze({ id: `canary-${id}`, observedAt, environment: "production", composeProject: authority.target.composeProject }));
      if (!observed || observed.status !== "passed" || observed.observedAt !== observedAt) throw failure("PRODUCTION_CANARY_FAILED", "Production canary failed", { checkpoint: id });
      checkpoints.push({ id, observedAt, status: "passed" });
    }
    const promotion = promotionEvidence(authority, run, deployment, checkpoints);
    await input.appendPromotionEvidence({ filename: "production-promotion-evidence.v1.json", bytes: Buffer.from(canonicalSerializeProductionPromotionEvidence(promotion), "utf8") });
    result = deepFreeze({ status: "passed", environment: "production", deploymentId: resource.deploymentId });
  } catch (cause) {
    original = failure("DIGITALOCEAN_PRODUCTION_FAILED", "DigitalOcean production promotion failed", { cause, partial: { cutover } });
  }
  const cleanupFailures = [];
  if (session?.close) try { await session.close(); } catch (cause) { cleanupFailures.push(cause); }
  if (original && !cutover && resource?.owned === true && typeof input.teardownCandidate === "function") {
    try { await input.teardownCandidate(resource); } catch (cause) { cleanupFailures.push(cause); }
  }
  if (original && cleanupFailures.length) throw Object.assign(new AggregateError([original, ...cleanupFailures], "Production and cleanup failed"), { cause: original });
  if (original) throw original;
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, "Production cleanup failed");
  return result;
}

export async function runApplicationRollback(input) {
  try {
    const selected = selectSchemaCompatibleRollback(input);
    if (typeof input.apply !== "function") throw new Error("missing apply");
    await input.apply(selected);
    return Object.freeze({ status: "passed", rollback: true });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_ROLLBACK_FORBIDDEN") throw cause;
    throw failure("PRODUCTION_ROLLBACK_FORBIDDEN", "Production rollback is forbidden", { cause });
  }
}
