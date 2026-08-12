import {
  ProductionCanaryCheckpointV2Schema,
  ProductionDeploymentEvidenceV1Schema,
  ProductionDeploymentEvidenceV2Schema,
  ProductionPromotionEvidenceV1Schema,
  ProductionPromotionEvidenceV2Schema,
  canonicalSerializeProductionCanaryCheckpointV2,
  canonicalSerializeProductionDeploymentEvidence,
  canonicalSerializeProductionDeploymentEvidenceV2,
  canonicalSerializeProductionPromotionEvidence,
  canonicalSerializeProductionPromotionEvidenceV2,
  canonicalSerializeSafeConsumerRegistry,
  checksumProductionDeploymentEvidence,
  checksumProductionPilotPreflightEvidence,
  checksumProductionPromotionAuthorization,
  checksumProductionPromotionAuthorizationV2,
  checksumProductionTarget,
} from "../packages/contracts/src/production-promotion-runtime.mjs";
import {
  createDirectProductionPilotPlan,
  createProductionPromotionPlan,
  selectSchemaCompatibleRollback,
  verifyDirectProductionPilotHandoff,
  verifyProductionPromotionHandoff,
} from "../packages/domain/src/production-promotion-runtime.mjs";
import { sha256Bytes } from "../packages/contracts/src/release-runtime.mjs";

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
    !Number.isSafeInteger(observed.archivePendingAgeSeconds) || observed.archivePendingAgeSeconds < 0 ||
    observed.archivePendingAgeSeconds > 60)) {
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

const directPreflightIds = Object.freeze([
  "dns-target", "ssh-host-key", "read-only-ghcr", "secret-files", "timeweb-s3-authority",
  "replay-bundle", "safe-consumer-manifests", "live-coston2",
]);
const directFileKeys = Object.freeze([
  "ghcrPullTokenFile", "sshPrivateKeyFile", "timewebS3AccessKeyFile", "timewebS3SecretKeyFile",
  "backupEncryptionKeyFile", "productionSecretRoot", "replayBundleFile", "replayPreflightReportFile",
  "backupEvidenceFile",
]);
const directRegistryOutput = "/opt/orivra/evidence/safe-consumer-registry.v1.json";
const directCommandIds = Object.freeze([
  "install-read-only-pull-credential", "pull-exact-digests", "inspect-local-digests", "start-postgres",
  "db-role-bootstrap", "migrator", "start-api", "safe-consumer-deployer", "write-safe-consumer-registry",
  "start-worker", "start-web", "start-caddy-candidate", "readyz-real-heartbeat", "timeweb-pitr-production",
  "persisted-live-coston2",
]);
const directCanaryDefinitions = Object.freeze([
  ["cutover", 0], ["post-cutover-15m", 900], ["post-cutover-1h", 3600], ["post-cutover-24h", 86400],
]);
const openMeteoSha = "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8";
const ethUsdSha = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";

function parseDirectRun(bytes, operatorId, completedAt) {
  try {
    if (!(bytes instanceof Uint8Array)) throw new Error("missing bytes");
    const text = decoder.decode(bytes);
    const value = JSON.parse(text);
    if (!exactKeys(value, ["runId", "operatorId"]) || !/^prod_[0-9A-Z]{26}$/.test(value.runId) ||
      value.operatorId !== operatorId || text !== canonicalJson(value)) throw new Error("invalid run");
    return deepFreeze({ ...value, completedAt });
  } catch (cause) {
    throw failure("PRODUCTION_PROMOTION_INPUT_INVALID", "Production promotion input is invalid", { cause });
  }
}

function snapshotDirectFiles(value) {
  if (!exactKeys(value, directFileKeys)) throw failure("PRODUCTION_PROMOTION_INPUT_INVALID", "Production promotion input is invalid");
  const copy = {};
  for (const key of directFileKeys) {
    const path = value[key];
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) {
      throw failure("PRODUCTION_PROMOTION_INPUT_INVALID", "Production promotion input is invalid");
    }
    copy[key] = path;
  }
  return deepFreeze(copy);
}

async function verifyDirectFileInputs(files, inspectFile) {
  if (typeof inspectFile !== "function") throw failure("PRODUCTION_PREFLIGHT_INVALID", "Production pilot preflight is invalid");
  for (const key of directFileKeys) {
    const stat = await inspectFile(files[key]);
    const root = key === "productionSecretRoot";
    if (!stat || stat.isSymbolicLink() || (root ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== (root ? 0o500 : 0o400) || (!root && (!Number.isSafeInteger(stat.size) || stat.size <= 0))) {
      throw failure("PRODUCTION_PREFLIGHT_INVALID", "Production pilot preflight is invalid", { check: "secret-files" });
    }
  }
  if (await inspectFile(directRegistryOutput) !== null) {
    throw failure("PRODUCTION_PREFLIGHT_INVALID", "Production pilot preflight is invalid", {
      check: "safe-consumer-registry-output",
    });
  }
}

function requireDirectPreflight(id, value, authority, files) {
  const base = value && value.version === "1" && value.kind === "production-pilot-preflight-observation" &&
    value.check === id && value.status === "passed";
  let valid = base;
  if (id === "dns-target") valid &&= exactKeys(value, ["version", "kind", "check", "status", "dnsName", "addresses"]) &&
    value.dnsName === authority.target.dnsName && Array.isArray(value.addresses) && value.addresses.length === 1 && value.addresses[0] === "72.56.81.28";
  if (id === "ssh-host-key") valid &&= exactKeys(value, ["version", "kind", "check", "status", "host", "port", "expectedHostKeySha256", "observedHostKeySha256"]) &&
    value.host === authority.target.sshEndpoint.host && value.port === 22 && value.expectedHostKeySha256 === authority.target.sshEndpoint.hostKeySha256 && value.observedHostKeySha256 === value.expectedHostKeySha256;
  if (id === "read-only-ghcr") valid &&= exactKeys(value, ["version", "kind", "check", "status", "registry", "access", "images"]) &&
    value.registry === "ghcr.io" && value.access === "read-only" && Array.isArray(value.images) && value.images.length === authority.images.length &&
    value.images.every((image, index) => exactKeys(image, ["id", "remoteReference", "remoteDigest"]) &&
      image.id === authority.images[index].id && image.remoteReference === authority.images[index].remoteReference && image.remoteDigest === authority.images[index].remoteDigest);
  if (id === "secret-files") valid &&= exactKeys(value, ["version", "kind", "check", "status", "fileIds", "valuesExposed"]) &&
    JSON.stringify(value.fileIds) === JSON.stringify(Object.keys(files).sort()) && value.valuesExposed === false;
  if (id === "timeweb-s3-authority") valid &&= exactKeys(value, ["version", "kind", "check", "status", "authoritySha256", "authorityMode", "endpoint", "region", "bucket", "pathStyle", "capabilities"]) &&
    value.authoritySha256 === authority.objectStoreAuthoritySha256 && value.authorityMode === "shared-pilot" &&
    value.endpoint === authority.objectStore.endpoint && value.region === authority.objectStore.region && value.bucket === authority.objectStore.bucket && value.pathStyle === true &&
    JSON.stringify(value.capabilities) === JSON.stringify(["PUT", "HEAD", "LIST", "GET", "DELETE"].map((operation) => ({ operation, status: "passed" })));
  if (id === "replay-bundle") valid &&= exactKeys(value, ["version", "kind", "check", "status", "bundleSha256", "reportSha256"]) &&
    /^sha256:[a-f0-9]{64}$/.test(value.bundleSha256) && /^sha256:[a-f0-9]{64}$/.test(value.reportSha256);
  if (id === "safe-consumer-manifests") valid &&= exactKeys(value, ["version", "kind", "check", "status", "manifests"]) &&
    JSON.stringify(value.manifests) === JSON.stringify([["open-meteo-current-weather", openMeteoSha], ["eth-usd", ethUsdSha]]);
  if (id === "live-coston2") valid &&= exactKeys(value, ["version", "kind", "check", "status", "chainId", "rpcUrl", "dataAvailabilityUrl", "relayerAddress", "balanceWei", "authorization"]) &&
    value.chainId === 114 && value.rpcUrl === "https://coston2-api.flare.network/ext/C/rpc" &&
    value.dataAvailabilityUrl === "https://ctn2-data-availability.flare.network" && /^0x[a-fA-F0-9]{40}$/.test(value.relayerAddress ?? "") &&
    /^(?:0|[1-9][0-9]*)$/.test(value.balanceWei ?? "") && value.authorization === "configured";
  if (!valid) throw failure("PRODUCTION_PREFLIGHT_INVALID", "Production pilot preflight is invalid", { check: id });
  return deepFreeze(structuredClone(value));
}

function directPreflightEvidence(authority, observations, files) {
  const checks = observations.map((entry) => {
    const { version: _version, kind: _kind, ...check } = entry;
    if (check.check === "secret-files") {
      const { fileIds: _fileIds, ...rest } = check;
      return { ...rest, fileIdsSha256: sha256Bytes(new TextEncoder().encode(canonicalJson(Object.keys(files).sort()))) };
    }
    if (check.check === "safe-consumer-manifests") return { ...check, registrySha256: sha256Bytes(new TextEncoder().encode(canonicalJson(check.manifests))) };
    return check;
  });
  return {
    version: "1", kind: "production-pilot-preflight-evidence", status: "passed",
    targetSha256: authority.productionTargetSha256, objectStoreAuthoritySha256: authority.objectStoreAuthoritySha256, checks,
  };
}

function requireDirectCommand(id, observed, authority) {
  if (!observed || observed.status !== "passed") throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  if (id === "inspect-local-digests" && (!Array.isArray(observed.images) || observed.images.length !== authority.images.length ||
    observed.images.some((image, index) => image.id !== authority.images[index].id || image.remoteDigest !== authority.images[index].remoteDigest))) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "migrator" && (!/^sha256:[a-f0-9]{64}$/.test(observed.migrationManifestSha256 ?? "") || observed.targetVersion !== 10 || observed.schemaVersion !== 10)) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "safe-consumer-deployer") {
    try {
      canonicalSerializeSafeConsumerRegistry(observed.registry);
      if (!Array.isArray(observed.deployments) || observed.deployments.length !== 2 || observed.deployments.some((entry, index) =>
        entry.templateId !== observed.registry.entries[index].templateId || entry.manifestSha256 !== observed.registry.entries[index].manifestSha256 ||
        entry.consumerAddress !== observed.registry.entries[index].consumerAddress || !/^0x[a-fA-F0-9]{64}$/.test(entry.transactionHash ?? ""))) throw new Error("deployments");
    } catch { throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id }); }
  }
  if (id === "write-safe-consumer-registry" && (observed.path !== "/opt/orivra/evidence/safe-consumer-registry.v1.json" || observed.mode !== 0o400 || !/^sha256:[a-f0-9]{64}$/.test(observed.registrySha256 ?? ""))) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "readyz-real-heartbeat" && (observed.readyz?.status !== "passed" || observed.workerHeartbeat?.status !== "current")) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "timeweb-pitr-production" && (!/^sha256:[a-f0-9]{64}$/.test(observed.restoreEvidenceSha256 ?? "") ||
    !Number.isSafeInteger(observed.backupAgeSeconds) || observed.backupAgeSeconds < 0 || !Number.isSafeInteger(observed.archivePendingAgeSeconds) || observed.archivePendingAgeSeconds < 0)) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  if (id === "persisted-live-coston2" && (!Array.isArray(observed.runIds) || observed.runIds.length !== 2 || observed.runIds[0] === observed.runIds[1] ||
    observed.runIds.some((runId) => !/^run_[0-9A-Z]{26}$/.test(runId)) || JSON.stringify(observed.manifests) !== JSON.stringify([openMeteoSha, ethUsdSha]))) {
    throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: id });
  }
  return deepFreeze(structuredClone(observed));
}

function directCommandFor(id, authority) {
  return deepFreeze({ id, environment: "production", composeProject: authority.target.composeProject,
    images: authority.images });
}

export async function runTimewebDirectProductionPilot(input) {
  const authority = verifyDirectProductionPilotHandoff(input);
  const now = input.clock?.now?.();
  if (typeof now !== "string" || !Number.isFinite(Date.parse(now))) throw failure("PRODUCTION_PREFLIGHT_INVALID", "Production pilot preflight is invalid");
  const run = parseDirectRun(input.runBytes, authority.authorization.operatorId, now);
  const files = snapshotDirectFiles(input.fileInputs);
  const preflightObservations = [];
  for (const id of directPreflightIds) preflightObservations.push(requireDirectPreflight(id, await input.preflightAdapter?.verify(id, { authority, files }), authority, files));
  await verifyDirectFileInputs(files, input.inspectFile);
  const preflightEvidence = directPreflightEvidence(authority, preflightObservations, files);
  const plan = createDirectProductionPilotPlan(authority);
  let resource;
  let session;
  let cutover = false;
  let deploymentPublished = false;
  let failureCause;
  try {
    resource = await input.productionAdapter.provision({ environment: "production", target: authority.target, plan });
    await input.productionAdapter.applyFirewall({ resource, ingress: [80, 443], environment: "production" });
    session = await input.sshAdapter.openPinnedSession({
      endpoint: { host: resource.sshHost, port: 22 },
      expectedHostKeySha256: authority.target.sshEndpoint.hostKeySha256,
      images: authority.images,
      runId: run.runId,
    });
    if (!session || session.observedHostKeySha256 !== authority.target.sshEndpoint.hostKeySha256 || typeof session.run !== "function") {
      throw failure("PRODUCTION_SSH_HOST_KEY_MISMATCH", "Production SSH host key mismatch");
    }
    const observations = {};
    for (const id of directCommandIds) observations[id] = requireDirectCommand(id, await session.run(directCommandFor(id, authority)), authority);
    const registry = observations["safe-consumer-deployer"].registry;
    if (observations["write-safe-consumer-registry"].registrySha256 !== sha256Bytes(new TextEncoder().encode(canonicalSerializeSafeConsumerRegistry(registry)))) {
      throw failure("PRODUCTION_OBSERVATION_INVALID", "Production observation is invalid", { check: "write-safe-consumer-registry" });
    }
    const activated = await input.cutoverAdapter.activateCaddy({ publicOrigin: authority.target.publicOrigin, target: authority.target });
    if (!activated || activated.status !== "passed" || activated.publicOrigin !== authority.target.publicOrigin || !Number.isFinite(Date.parse(activated.activatedAt))) {
      throw failure("PRODUCTION_CUTOVER_FAILED", "Production cutover failed");
    }
    cutover = true;
    const external = await input.cutoverAdapter.observeExternalHttps({ publicOrigin: authority.target.publicOrigin, target: authority.target });
    if (!external || external.status !== "passed" || external.publicOrigin !== authority.target.publicOrigin ||
      !Number.isFinite(Date.parse(external.observedAt)) || Date.parse(external.observedAt) < Date.parse(activated.activatedAt)) {
      throw failure("PRODUCTION_CUTOVER_FAILED", "Production external HTTPS observation failed");
    }
    let checkpoint;
    try {
      checkpoint = ProductionCanaryCheckpointV2Schema.parse(await session.run({
        id: "canary-observe",
        checkpointId: "cutover",
        dueAt: activated.activatedAt,
      }));
    } catch (cause) {
      throw failure("PRODUCTION_CUTOVER_FAILED", "Production cutover host observation failed", { cause });
    }
    if (checkpoint.id !== "cutover" || checkpoint.dueAt !== activated.activatedAt || checkpoint.status !== "passed" ||
      Date.parse(checkpoint.observedAt) < Date.parse(external.observedAt)) {
      throw failure("PRODUCTION_CUTOVER_FAILED", "Production cutover host observation failed");
    }
    await input.checkpointStore.append(checkpoint);
    const deployment = ProductionDeploymentEvidenceV2Schema.parse({
      version: "2", kind: "digitalocean-production-deployment-evidence", status: "passed", verification: "verified", productionClaim: true,
      producer: authority.publication.producer, publicationEvidenceSha256: authority.publicationEvidenceSha256,
      frozenReleaseManifestSha256: authority.publication.frozenRelease.frozenReleaseManifestSha256,
      promotionAuthorizationSha256: checksumProductionPromotionAuthorizationV2(authority.authorization),
      preflightEvidenceSha256: checksumProductionPilotPreflightEvidence(preflightEvidence), target: authority.target, run,
      pullCredential: { registry: "ghcr.io", access: "read-only" }, images: authority.images,
      topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
      database: { migrationManifestSha256: observations.migrator.migrationManifestSha256, targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" } },
      objectStore: authority.objectStore, safeConsumers: registry,
      checks: { exactDigestPull: { status: "passed" }, readyz: observations["readyz-real-heartbeat"].readyz,
        workerHeartbeat: observations["readyz-real-heartbeat"].workerHeartbeat,
        timewebPitr: { status: "passed", restoreEvidenceSha256: observations["timeweb-pitr-production"].restoreEvidenceSha256,
          backupAgeSeconds: observations["timeweb-pitr-production"].backupAgeSeconds, archivePendingAgeSeconds: observations["timeweb-pitr-production"].archivePendingAgeSeconds },
        liveCoston2: { status: "persisted", runIds: observations["persisted-live-coston2"].runIds, manifests: observations["persisted-live-coston2"].manifests } },
      cutover: { status: "passed", publicOrigin: authority.target.publicOrigin, activatedAt: activated.activatedAt },
    });
    const deploymentBytes = Buffer.from(canonicalSerializeProductionDeploymentEvidenceV2(deployment), "utf8");
    await input.appendProductionEvidence({ filename: "production-deployment-evidence.v2.json", bytes: deploymentBytes });
    deploymentPublished = true;
    return deepFreeze({ status: "canary-pending", environment: "production", deploymentId: resource.deploymentId,
      deploymentEvidenceSha256: sha256Bytes(deploymentBytes), runId: run.runId });
  } catch (cause) {
    failureCause = failure("DIGITALOCEAN_PRODUCTION_FAILED", "DigitalOcean production promotion failed", { cause, partial: { cutover } });
  } finally {
    try { await session?.close?.(); } catch (cause) { if (!failureCause) failureCause = cause; else failureCause = new AggregateError([failureCause, cause]); }
    if (failureCause && cutover && !deploymentPublished && typeof input.cutoverAdapter?.rollbackCaddy === "function") {
      try { await input.cutoverAdapter.rollbackCaddy({ target: authority.target }); } catch (cause) { failureCause = new AggregateError([failureCause, cause]); }
    } else if (failureCause && !cutover && resource?.owned === true && typeof input.teardownCandidate === "function") {
      try { await input.teardownCandidate(resource); } catch (cause) { failureCause = new AggregateError([failureCause, cause]); }
    }
  }
  throw failureCause;
}

export async function resumeTimewebProductionCanary(input) {
  if (!(input.deploymentEvidenceBytes instanceof Uint8Array) || !/^sha256:[a-f0-9]{64}$/.test(input.expectedDeploymentEvidenceSha256 ?? "")) {
    throw failure("PRODUCTION_CANARY_FAILED", "Production canary failed");
  }
  const now = input.clock?.now?.();
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw failure("PRODUCTION_CANARY_FAILED", "Production canary failed");
  let deployment;
  try {
    const text = decoder.decode(input.deploymentEvidenceBytes);
    deployment = ProductionDeploymentEvidenceV2Schema.parse(JSON.parse(text));
    if (text !== canonicalSerializeProductionDeploymentEvidenceV2(deployment) ||
      sha256Bytes(input.deploymentEvidenceBytes) !== input.expectedDeploymentEvidenceSha256) throw new Error("deployment binding");
  } catch (cause) {
    throw failure("PRODUCTION_DEPLOYMENT_EVIDENCE_INVALID", "Production deployment evidence is invalid", { cause });
  }
  const stored = await input.checkpointStore.load();
  if (!Array.isArray(stored) || stored.length < 1 || stored.length > 4 || stored[0]?.id !== "cutover" || !Number.isFinite(Date.parse(stored[0].observedAt))) {
    throw failure("PRODUCTION_CANARY_FAILED", "Production canary failed");
  }
  const cutoverAt = stored[0].observedAt;
  const expectedIds = directCanaryDefinitions.map(([id]) => id);
  if (stored.some((entry, index) => entry.id !== expectedIds[index])) throw failure("PRODUCTION_CANARY_FAILED", "Production canary failed");
  const next = directCanaryDefinitions[stored.length];
  if (!next) return deepFreeze({ status: "passed" });
  const dueAt = addSeconds(cutoverAt, next[1]);
  if (nowMs < Date.parse(dueAt)) return deepFreeze({ status: "canary-pending", nextCheckpoint: next[0], dueAt });
  let observed;
  try { observed = ProductionCanaryCheckpointV2Schema.parse(await input.observe({ id: next[0], dueAt })); }
  catch (cause) { throw failure("CANARY_CHECKPOINT_INVALID", "Production canary clock synchronization or checkpoint is invalid", { cause }); }
  if (observed.id !== next[0] || observed.dueAt !== dueAt || observed.observedAt !== now) throw failure("PRODUCTION_CANARY_FAILED", "Production canary failed");
  await input.checkpointStore.append(observed);
  if (next[0] !== "post-cutover-24h") return deepFreeze({ status: "canary-pending", nextCheckpoint: expectedIds[stored.length + 1] });
  const checkpoints = [...stored, observed];
  const promotion = ProductionPromotionEvidenceV2Schema.parse({ version: "2", kind: "digitalocean-production-promotion-evidence", status: "passed", verification: "verified", promotionClaim: true,
    producer: deployment.producer, publicationEvidenceSha256: deployment.publicationEvidenceSha256,
    productionDeploymentEvidenceSha256: input.expectedDeploymentEvidenceSha256, runId: deployment.run.runId, operatorId: deployment.run.operatorId,
    cutover: deployment.cutover, canary: { durationSeconds: 86400, checkpoints }, completedAt: observed.observedAt });
  const text = canonicalSerializeProductionPromotionEvidenceV2(promotion);
  await input.appendPromotionEvidence({ filename: "production-promotion-evidence.v2.json", bytes: Buffer.from(text, "utf8") });
  return deepFreeze({ status: "passed" });
}
