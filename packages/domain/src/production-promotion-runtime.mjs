import {
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializePublicationEvidence,
  canonicalSerializeStagingDeploymentEvidence,
} from "../../contracts/src/publication-runtime.mjs";
import {
  ProductionPromotionAuthorizationV1Schema,
  ProductionTargetV1Schema,
  canonicalSerializeProductionPromotionAuthorization,
  canonicalSerializeProductionTarget,
} from "../../contracts/src/production-promotion-runtime.mjs";
import { sha256Bytes } from "../../contracts/src/release-runtime.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const imageEnvironmentNames = [
  "PROOFLINE_CADDY_IMAGE",
  "PROOFLINE_WEB_IMAGE",
  "PROOFLINE_API_IMAGE",
  "PROOFLINE_WORKER_IMAGE",
  "PROOFLINE_POSTGRES_IMAGE",
];

function invalid(message = "Production promotion input is invalid") {
  throw Object.assign(new Error(message), { code: "PRODUCTION_PROMOTION_INPUT_INVALID" });
}

function parseCanonical(bytes, schema, serialize) {
  if (!(bytes instanceof Uint8Array)) invalid();
  const value = schema.parse(JSON.parse(decoder.decode(bytes)));
  if (decoder.decode(bytes) !== serialize(value)) invalid();
  return value;
}

function equalProducer(left, right) {
  return left.commitSha === right.commitSha && left.treeSha === right.treeSha;
}

function equalImages(left, right) {
  return left.length === right.length && left.every((image, index) =>
    image.id === right[index].id &&
    image.remoteRepository === right[index].remoteRepository &&
    image.remoteReference === right[index].remoteReference &&
    image.remoteDigest === right[index].remoteDigest);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function verifyProductionPromotionHandoff(input) {
  try {
    const publication = parseCanonical(input.publicationEvidenceBytes, PublicationEvidenceV1Schema, canonicalSerializePublicationEvidence);
    const staging = parseCanonical(input.stagingDeploymentEvidenceBytes, StagingDeploymentEvidenceV1Schema, canonicalSerializeStagingDeploymentEvidence);
    const target = parseCanonical(input.productionTargetBytes, ProductionTargetV1Schema, canonicalSerializeProductionTarget);
    const authorization = parseCanonical(input.promotionAuthorizationBytes, ProductionPromotionAuthorizationV1Schema, canonicalSerializeProductionPromotionAuthorization);
    const publicationEvidenceSha256 = sha256Bytes(input.publicationEvidenceBytes);
    const stagingDeploymentEvidenceSha256 = sha256Bytes(input.stagingDeploymentEvidenceBytes);
    const targetSha256 = sha256Bytes(input.productionTargetBytes);
    const now = Date.parse(input.now);
    if (publicationEvidenceSha256 !== input.expectedPublicationEvidenceSha256 ||
      stagingDeploymentEvidenceSha256 !== input.expectedStagingDeploymentEvidenceSha256 ||
      staging.publicationEvidenceSha256 !== publicationEvidenceSha256 ||
      staging.frozenReleaseManifestSha256 !== publication.frozenRelease.frozenReleaseManifestSha256 ||
      !equalProducer(staging.producer, publication.producer) || !equalImages(staging.images, publication.images) ||
      target.composeProject === staging.target.composeProject || target.publicOrigin === staging.target.publicOrigin ||
      target.deploymentId === staging.target.deploymentId ||
      authorization.publicationEvidenceSha256 !== publicationEvidenceSha256 ||
      authorization.stagingDeploymentEvidenceSha256 !== stagingDeploymentEvidenceSha256 ||
      authorization.productionTargetSha256 !== targetSha256 || !Number.isFinite(now) ||
      now < Date.parse(authorization.authorizedAt) || now >= Date.parse(authorization.expiresAt)) invalid();
    return deepFreeze({
      publicationEvidenceSha256,
      stagingDeploymentEvidenceSha256,
      publication,
      staging,
      target,
      authorization,
      images: publication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_PROMOTION_INPUT_INVALID") throw cause;
    throw Object.assign(new Error("Production promotion input is invalid"), { code: "PRODUCTION_PROMOTION_INPUT_INVALID", cause });
  }
}

export function createProductionPromotionPlan(authority) {
  if (!authority || !Object.isFrozen(authority) || !Array.isArray(authority.images) || authority.images.length !== imageEnvironmentNames.length) invalid();
  return deepFreeze({
    imageEnvironment: Object.fromEntries(authority.images.map((image, index) => [imageEnvironmentNames[index], image.remoteReference])),
    startOrder: ["postgres", "db-role-bootstrap", "migrator", "api", "worker", "web", "caddy"],
    preEffectChecks: ["dns-target", "ssh-host-key", "read-only-ghcr", "secret-files", "spaces-authority", "replay-bundle", "safe-consumer", "live-coston2"],
    publicPorts: [80, 443],
    privateHostPorts: { api: [], worker: [], postgres: [] },
  });
}

export function selectSchemaCompatibleRollback({ currentSchemaVersion, prior }) {
  if (!Number.isSafeInteger(currentSchemaVersion) || !prior || prior.status !== "passed" ||
    prior.verification !== "verified" || prior.productionClaim !== true ||
    !/^sha256:[a-f0-9]{64}$/.test(prior.publicationEvidenceSha256 ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(prior.deploymentEvidenceSha256 ?? "") ||
    !Number.isSafeInteger(prior.minimumCompatibleVersion) || !Number.isSafeInteger(prior.maximumCompatibleVersion) ||
    currentSchemaVersion < prior.minimumCompatibleVersion || currentSchemaVersion > prior.maximumCompatibleVersion ||
    prior.schemaVersion !== currentSchemaVersion || !Array.isArray(prior.images) || prior.images.length !== 5) {
    throw Object.assign(new Error("Production rollback is forbidden"), { code: "PRODUCTION_ROLLBACK_FORBIDDEN" });
  }
  return deepFreeze(structuredClone(prior));
}
