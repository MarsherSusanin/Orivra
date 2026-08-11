import { canonicalJson } from "../packages/contracts/src/release-runtime.mjs";

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

function requirePublicationEvidence(publicationEvidence) {
  if (!publicationEvidence || publicationEvidence.kind !== "oci-publication-evidence" ||
    publicationEvidence.status !== "passed" || publicationEvidence.verification !== "verified" ||
    publicationEvidence.publicationClaim !== true || !Array.isArray(publicationEvidence.images) ||
    publicationEvidence.images.length !== imageIds.length) throw failure("STAGING_PUBLICATION_INVALID", "Publication evidence is invalid");
  publicationEvidence.images.forEach((image, index) => {
    if (image.id !== imageIds[index] || image.remoteDigest !== image.imageManifestDigest && image.imageManifestDigest !== undefined ||
      image.remoteReference !== `${image.remoteRepository}@${image.remoteDigest}`) throw failure("STAGING_PUBLICATION_INVALID", "Publication image is invalid");
  });
  return publicationEvidence;
}

export function createStagingImagePlan({ publicationEvidence }) {
  const evidence = requirePublicationEvidence(publicationEvidence);
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

function inspectDigestResult(result, evidence) {
  if (!Array.isArray(result) || result.length !== evidence.images.length || result.some((item, index) =>
    item.id !== evidence.images[index].id || item.remoteDigest !== evidence.images[index].remoteDigest)) {
    throw failure("STAGING_REMOTE_DIGEST_MISMATCH", "Staging image digest mismatch");
  }
}

export async function runDigitalOceanStaging({ publicationEvidence, publicationEvidenceSha256, target, digitalOceanAdapter, sshAdapter, appendStagingEvidence, cleanup }) {
  const evidence = requirePublicationEvidence(publicationEvidence);
  if (!target || !target.origin?.startsWith("https://") || !/^proofline-staging-[a-z0-9-]+$/.test(target.composeProject ?? "") ||
    /production/i.test(target.composeProject) || !/^sha256:[a-f0-9]{64}$/.test(target.sshHostKeySha256 ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(publicationEvidenceSha256 ?? "")) throw failure("STAGING_TARGET_INVALID", "Staging target is invalid");
  let resource;
  let original;
  let result;
  let stagingEvidenceWritten = false;
  try {
    resource = await digitalOceanAdapter.provision({ environment: "staging", target });
    await digitalOceanAdapter.applyFirewall({ resource, ingress: [80, 443], environment: "staging" });
    const observations = {};
    for (const id of commandIds) {
      const observed = await sshAdapter.run(commandFor(id, evidence, target));
      observations[id] = observed;
      if (id === "inspect-local-digests") inspectDigestResult(observed, evidence);
    }
    const stagingEvidence = {
      version: "1",
      kind: "digitalocean-staging-deployment-evidence",
      status: "passed",
      verification: "verified",
      stagingClaim: true,
      environment: "staging",
      publicationEvidenceSha256,
      deploymentId: resource.deploymentId,
      imageReferences: evidence.images.map(({ id, remoteReference }) => ({ id, remoteReference })),
      checks: commandIds.slice(2).map((id) => ({ id, status: "passed" })),
    };
    await appendStagingEvidence({
      filename: "staging-deployment-evidence.v1.json",
      bytes: Buffer.from(canonicalJson(stagingEvidence), "utf8"),
    });
    stagingEvidenceWritten = true;
    result = Object.freeze({ status: "passed", environment: "staging", deploymentId: resource.deploymentId });
  } catch (cause) {
    original = failure("DIGITALOCEAN_STAGING_FAILED", "DigitalOcean staging failed", {
      cause,
      partial: { publicationEvidenceRetained: true, stagingEvidenceWritten },
    });
  }
  let cleanupFailure;
  if (resource?.owned === true) {
    try { await cleanup(resource); } catch (cause) { cleanupFailure = cause; }
  }
  if (original && cleanupFailure) throw Object.assign(new AggregateError([original, cleanupFailure], "Staging and cleanup failed"), { cause: original });
  if (original) throw original;
  if (cleanupFailure) throw cleanupFailure;
  return result;
}
