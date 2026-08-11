import {
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializeStagingDeploymentEvidence,
} from "../packages/contracts/src/publication-runtime.mjs";
import { verifyPublicationEvidenceHandoff } from "../packages/domain/src/publication-runtime.mjs";

const imageIds = Object.freeze(["caddy", "web", "api", "worker", "postgres-recovery"]);
const imageEnvironment = Object.freeze({
  caddy: "PROOFLINE_CADDY_IMAGE",
  web: "PROOFLINE_WEB_IMAGE",
  api: "PROOFLINE_API_IMAGE",
  worker: "PROOFLINE_WORKER_IMAGE",
  "postgres-recovery": "PROOFLINE_POSTGRES_IMAGE",
});

function failure(code, message, details) {
  return Object.assign(new Error(message), { code, ...details });
}

async function requireFile(path, inspect) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw failure("STAGING_CREDENTIAL_INVALID", "Staging credential file is invalid");
  const stat = await inspect(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o400) throw failure("STAGING_CREDENTIAL_INVALID", "Staging credential file is invalid");
}

export async function createStagingCredentialEnvironment({
  ambientEnvironment = {}, username, doApiTokenFile, ghcrPullTokenFile,
  sshPrivateKeyFile, stagingSecretRoot, inspectSecretFile,
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username ?? "") || typeof inspectSecretFile !== "function") throw failure("STAGING_CREDENTIAL_INVALID", "Staging credential input is invalid");
  await Promise.all([doApiTokenFile, ghcrPullTokenFile, sshPrivateKeyFile].map((path) => requireFile(path, inspectSecretFile)));
  const root = await inspectSecretFile(stagingSecretRoot);
  if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o777) !== 0o500) throw failure("STAGING_CREDENTIAL_INVALID", "Staging secret root is invalid");
  return Object.freeze({
    PATH: typeof ambientEnvironment.PATH === "string" ? ambientEnvironment.PATH : "/usr/bin:/bin",
    PROOFLINE_DO_API_TOKEN_FILE: doApiTokenFile,
    PROOFLINE_GHCR_PULL_USERNAME: username,
    PROOFLINE_GHCR_PULL_TOKEN_FILE: ghcrPullTokenFile,
    PROOFLINE_STAGING_SECRET_ROOT: stagingSecretRoot,
    PROOFLINE_STAGING_SSH_PRIVATE_KEY_FILE: sshPrivateKeyFile,
  });
}

function requirePublicationHandoff({ publicationHandoff, publicationEvidence, publicationEvidenceSha256 }) {
  try {
    if (!publicationHandoff || publicationHandoff.evidence !== publicationEvidence ||
      publicationHandoff.expectedPublicationEvidenceSha256 !== publicationEvidenceSha256) throw new Error("handoff mismatch");
    verifyPublicationEvidenceHandoff(publicationHandoff);
    return publicationEvidence;
  } catch (cause) {
    throw failure("STAGING_PUBLICATION_INVALID", "Publication evidence handoff is invalid", { cause });
  }
}

export function createStagingImagePlan(input) {
  const evidence = requirePublicationHandoff(input);
  const environment = {};
  for (const image of evidence.images) environment[imageEnvironment[image.id]] = image.remoteReference;
  return Object.freeze({
    environment: Object.freeze(environment),
    pullPolicy: "explicit-before-compose",
    credentialAccess: "read-only",
  });
}

const commandIds = Object.freeze([
  "install-read-only-pull-credential",
  "pull-exact-digests",
  "inspect-local-digests",
  "start-postgres",
  "role-bootstrap",
  "migrator",
  "start-api",
  "start-worker",
  "start-web",
  "start-caddy",
  "healthz",
  "readyz-real-heartbeat",
  "hosted-browser-smoke",
  "spaces-pitr-restore",
  "persisted-live-coston2",
]);

function commandFor(id, evidence, target) {
  return Object.freeze({
    id,
    environment: "staging",
    composeProject: target.composeProject,
    imageReferences: id === "pull-exact-digests" || id === "inspect-local-digests"
      ? evidence.images.map(({ id: imageId, remoteReference }) => ({ id: imageId, remoteReference }))
      : undefined,
  });
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function requireObservation(id, observed, evidence, sshHostKeySha256) {
  const common = ["status", "sshHostKeySha256"];
  const expectedKeys = id === "inspect-local-digests" ? [...common, "images"]
    : id === "migrator" ? [...common, "migrationManifestSha256", "targetVersion", "schemaVersion"]
      : id === "readyz-real-heartbeat" ? [...common, "readyz", "workerHeartbeat"]
        : id === "spaces-pitr-restore" ? [...common, "restoreEvidenceSha256"]
          : id === "persisted-live-coston2" ? [...common, "runId"]
            : id === "install-read-only-pull-credential" ? [...common, "registry", "access"]
              : common;
  if (!exactKeys(observed, expectedKeys) || observed.status !== "passed" ||
    observed.sshHostKeySha256 !== sshHostKeySha256) {
    throw failure("STAGING_OBSERVATION_INVALID", "Staging observation is invalid");
  }
  if (id === "inspect-local-digests" && (!Array.isArray(observed.images) ||
    observed.images.length !== evidence.images.length || observed.images.some((item, index) =>
      !exactKeys(item, ["id", "remoteDigest"]) || item.id !== evidence.images[index].id ||
      item.remoteDigest !== evidence.images[index].remoteDigest))) {
    throw failure("STAGING_REMOTE_DIGEST_MISMATCH", "Staging image digest mismatch");
  }
  if (id === "migrator" && (!/^sha256:[a-f0-9]{64}$/.test(observed.migrationManifestSha256 ?? "") ||
    observed.targetVersion !== 10 || observed.schemaVersion !== 10)) throw failure("STAGING_OBSERVATION_INVALID", "Staging observation is invalid");
  if (id === "readyz-real-heartbeat" &&
    (!exactKeys(observed.readyz, ["status"]) || observed.readyz.status !== "passed" ||
      !exactKeys(observed.workerHeartbeat, ["status"]) || observed.workerHeartbeat.status !== "current")) {
    throw failure("STAGING_OBSERVATION_INVALID", "Staging observation is invalid");
  }
  if (id === "spaces-pitr-restore" && !/^sha256:[a-f0-9]{64}$/.test(observed.restoreEvidenceSha256 ?? "")) throw failure("STAGING_OBSERVATION_INVALID", "Staging observation is invalid");
  if (id === "persisted-live-coston2" && !/^run_[0-9A-Z]{26}$/.test(observed.runId ?? "")) throw failure("STAGING_OBSERVATION_INVALID", "Staging observation is invalid");
  if (id === "install-read-only-pull-credential" && (observed.registry !== "ghcr.io" || observed.access !== "read-only")) throw failure("STAGING_OBSERVATION_INVALID", "Staging observation is invalid");
  return observed;
}

function buildStagingEvidence({ evidence, publicationEvidenceSha256, target, run, resource, observations }) {
  return StagingDeploymentEvidenceV1Schema.parse({
    version: "1",
    kind: "digitalocean-staging-deployment-evidence",
    status: "passed",
    verification: "verified",
    stagingClaim: true,
    producer: evidence.producer,
    publicationEvidenceSha256,
    frozenReleaseManifestSha256: evidence.frozenRelease.frozenReleaseManifestSha256,
    target: {
      provider: "digitalocean",
      environment: "staging",
      deploymentId: resource.deploymentId,
      composeProject: target.composeProject,
      publicOrigin: target.origin,
    },
    run: { ...run, sshHostKeySha256: target.sshHostKeySha256 },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: evidence.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    checks: {
      exactDigestPull: { status: "passed" },
      migration: {
        migrationManifestSha256: observations.migrator.migrationManifestSha256,
        targetVersion: observations.migrator.targetVersion,
        schemaVersion: observations.migrator.schemaVersion,
        status: "passed",
      },
      healthz: { status: "passed" },
      readyz: observations["readyz-real-heartbeat"].readyz,
      workerHeartbeat: observations["readyz-real-heartbeat"].workerHeartbeat,
      hostedBrowserSmoke: { status: "passed" },
      spacesRestore: { restoreEvidenceSha256: observations["spaces-pitr-restore"].restoreEvidenceSha256, status: "passed" },
      liveCoston2: { runId: observations["persisted-live-coston2"].runId, status: "passed" },
    },
  });
}

export async function runDigitalOceanStaging({ publicationHandoff, publicationEvidence, publicationEvidenceSha256, target, run, digitalOceanAdapter, sshAdapter, appendStagingEvidence, closeLocalSession, teardownStaging, cleanup }) {
  const evidence = requirePublicationHandoff({ publicationHandoff, publicationEvidence, publicationEvidenceSha256 });
  if (!target || !target.origin?.startsWith("https://") || !/^proofline-staging-[a-z0-9-]+$/.test(target.composeProject ?? "") ||
    /production/i.test(target.composeProject) || !/^sha256:[a-f0-9]{64}$/.test(target.sshHostKeySha256 ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(publicationEvidenceSha256 ?? "") ||
    !run || !/^stg_[0-9A-Z]{26}$/.test(run.runId ?? "") || !/^operator_[0-9A-Z]{26}$/.test(run.operatorId ?? "") ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(run.completedAt ?? "")) throw failure("STAGING_TARGET_INVALID", "Staging target is invalid");
  let resource;
  let session;
  let original;
  let result;
  let stagingEvidenceWritten = false;
  try {
    resource = await digitalOceanAdapter.provision({ environment: "staging", target });
    await digitalOceanAdapter.applyFirewall({ resource, ingress: [80, 443], environment: "staging" });
    session = await sshAdapter.openPinnedSession({
      endpoint: { host: resource.sshHost, port: 22 },
      expectedHostKeySha256: target.sshHostKeySha256,
    });
    if (session?.observedHostKeySha256 !== target.sshHostKeySha256 || typeof session.run !== "function") {
      throw failure("STAGING_SSH_HOST_KEY_MISMATCH", "Staging SSH host key mismatch");
    }
    const observations = {};
    for (const id of commandIds) {
      observations[id] = requireObservation(
        id,
        await session.run(commandFor(id, evidence, target)),
        evidence,
        target.sshHostKeySha256,
      );
    }
    const stagingEvidence = buildStagingEvidence({ evidence, publicationEvidenceSha256, target, run, resource, observations });
    await appendStagingEvidence({
      filename: "staging-deployment-evidence.v1.json",
      bytes: Buffer.from(canonicalSerializeStagingDeploymentEvidence(stagingEvidence), "utf8"),
    });
    stagingEvidenceWritten = true;
    result = Object.freeze({ status: "passed", environment: "staging", deploymentId: resource.deploymentId });
  } catch (cause) {
    original = failure("DIGITALOCEAN_STAGING_FAILED", "DigitalOcean staging failed", {
      cause,
      partial: { publicationEvidenceRetained: true, stagingEvidenceWritten },
    });
  }
  const cleanupFailures = [];
  if (session && typeof session.close === "function") {
    try { await session.close(); } catch (cause) { cleanupFailures.push(cause); }
  }
  if (typeof closeLocalSession === "function") {
    try { await closeLocalSession(); } catch (cause) { cleanupFailures.push(cause); }
  }
  if (resource?.owned === true && (original || typeof closeLocalSession !== "function")) {
    const finalizer = original ? (teardownStaging ?? cleanup) : cleanup;
    if (typeof finalizer === "function") {
      try { await finalizer(resource); } catch (cause) { cleanupFailures.push(cause); }
    }
  }
  if (original && cleanupFailures.length) throw Object.assign(new AggregateError([original, ...cleanupFailures], "Staging and cleanup failed"), { cause: original });
  if (original) throw original;
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, "Staging cleanup failed");
  return result;
}
