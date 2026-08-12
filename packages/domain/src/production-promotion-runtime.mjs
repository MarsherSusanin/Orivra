import {
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializePublicationEvidence,
  canonicalSerializeStagingDeploymentEvidence,
} from "../../contracts/src/publication-runtime.mjs";
import {
  ApplicationRollbackAuthorizationV1Schema,
  ApplicationRollbackAuthorizationV2Schema,
  ProductionDeploymentEvidenceV1Schema,
  ProductionDeploymentEvidenceV2Schema,
  ProductionPromotionAuthorizationV1Schema,
  ProductionPromotionAuthorizationV2Schema,
  ProductionTargetV1Schema,
  ProductionTargetV2Schema,
  TimewebS3PilotAuthorityV1Schema,
  canonicalSerializeApplicationRollbackAuthorization,
  canonicalSerializeApplicationRollbackAuthorizationV2,
  canonicalSerializeProductionDeploymentEvidence,
  canonicalSerializeProductionDeploymentEvidenceV2,
  canonicalSerializeProductionPromotionAuthorization,
  canonicalSerializeProductionPromotionAuthorizationV2,
  canonicalSerializeProductionTarget,
  canonicalSerializeProductionTargetV2,
  canonicalSerializeTimewebS3PilotAuthority,
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

export function verifyDirectProductionPilotHandoff(input) {
  try {
    if (Object.hasOwn(input, "stagingDeploymentEvidenceBytes")) invalid();
    const publication = parseCanonical(input.publicationEvidenceBytes, PublicationEvidenceV1Schema, canonicalSerializePublicationEvidence);
    const target = parseCanonical(input.productionTargetBytes, ProductionTargetV2Schema, canonicalSerializeProductionTargetV2);
    const objectStore = parseCanonical(input.objectStoreAuthorityBytes, TimewebS3PilotAuthorityV1Schema, canonicalSerializeTimewebS3PilotAuthority);
    const authorization = parseCanonical(input.promotionAuthorizationBytes, ProductionPromotionAuthorizationV2Schema, canonicalSerializeProductionPromotionAuthorizationV2);
    const publicationEvidenceSha256 = sha256Bytes(input.publicationEvidenceBytes);
    const productionTargetSha256 = sha256Bytes(input.productionTargetBytes);
    const objectStoreAuthoritySha256 = sha256Bytes(input.objectStoreAuthorityBytes);
    const promotionAuthorizationSha256 = sha256Bytes(input.promotionAuthorizationBytes);
    const now = Date.parse(input.now);
    if (publicationEvidenceSha256 !== input.expectedPublicationEvidenceSha256 ||
      productionTargetSha256 !== input.expectedProductionTargetSha256 ||
      objectStoreAuthoritySha256 !== input.expectedObjectStoreAuthoritySha256 ||
      promotionAuthorizationSha256 !== input.expectedPromotionAuthorizationSha256 ||
      authorization.publicationEvidenceSha256 !== publicationEvidenceSha256 ||
      authorization.productionTargetSha256 !== productionTargetSha256 ||
      authorization.objectStoreAuthoritySha256 !== objectStoreAuthoritySha256 ||
      canonicalSerializeTimewebS3PilotAuthority(target.objectStore) !== canonicalSerializeTimewebS3PilotAuthority(objectStore) ||
      !Number.isFinite(now) || now < Date.parse(authorization.authorizedAt) || now >= Date.parse(authorization.expiresAt)) invalid();
    return deepFreeze({
      publicationEvidenceSha256, productionTargetSha256, objectStoreAuthoritySha256, promotionAuthorizationSha256,
      publication, target, objectStore, authorization,
      images: publication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_PROMOTION_INPUT_INVALID") throw cause;
    throw Object.assign(new Error("Production promotion input is invalid"), { code: "PRODUCTION_PROMOTION_INPUT_INVALID", cause });
  }
}

export function createDirectProductionPilotPlan(authority) {
  if (!authority || !Object.isFrozen(authority) || authority.target?.deploymentMode !== "direct-pilot" ||
    !Array.isArray(authority.images) || authority.images.length !== imageEnvironmentNames.length) invalid();
  return deepFreeze({
    imageEnvironment: Object.fromEntries(authority.images.map((image, index) => [imageEnvironmentNames[index], image.remoteReference])),
    startOrder: ["postgres", "db-role-bootstrap", "migrator", "api", "safe-consumer-deployer", "write-safe-consumer-registry", "worker", "web", "caddy-candidate"],
    safeConsumerManifestOrder: [
      ["open-meteo-current-weather", "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8"],
      ["eth-usd", "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db"],
    ],
    safeConsumerRegistryFile: "/opt/orivra/evidence/safe-consumer-registry.v1.json",
    preEffectChecks: ["dns-target", "ssh-host-key", "read-only-ghcr", "secret-files", "timeweb-s3-authority", "replay-bundle", "safe-consumer-manifests", "live-coston2"],
    publicPorts: [80, 443],
    privateHostPorts: { api: [], worker: [], postgres: [] },
  });
}

export function selectSchemaCompatibleRollback(input) {
  try {
    const authorization = parseCanonical(input.rollbackAuthorizationBytes, ApplicationRollbackAuthorizationV1Schema, canonicalSerializeApplicationRollbackAuthorization);
    const currentDeployment = parseCanonical(input.currentProductionDeploymentEvidenceBytes, ProductionDeploymentEvidenceV1Schema, canonicalSerializeProductionDeploymentEvidence);
    const priorDeployment = parseCanonical(input.priorProductionDeploymentEvidenceBytes, ProductionDeploymentEvidenceV1Schema, canonicalSerializeProductionDeploymentEvidence);
    const currentPublication = parseCanonical(input.currentPublicationEvidenceBytes, PublicationEvidenceV1Schema, canonicalSerializePublicationEvidence);
    const priorPublication = parseCanonical(input.priorPublicationEvidenceBytes, PublicationEvidenceV1Schema, canonicalSerializePublicationEvidence);
    const checksums = {
      authorization: sha256Bytes(input.rollbackAuthorizationBytes),
      currentDeployment: sha256Bytes(input.currentProductionDeploymentEvidenceBytes),
      priorDeployment: sha256Bytes(input.priorProductionDeploymentEvidenceBytes),
      currentPublication: sha256Bytes(input.currentPublicationEvidenceBytes),
      priorPublication: sha256Bytes(input.priorPublicationEvidenceBytes),
    };
    const now = Date.parse(input.now);
    const invalidChecks = [
      checksums.authorization !== input.expectedRollbackAuthorizationSha256,
      checksums.currentDeployment !== input.expectedCurrentProductionDeploymentEvidenceSha256,
      checksums.priorDeployment !== input.expectedPriorProductionDeploymentEvidenceSha256,
      checksums.currentPublication !== input.expectedCurrentPublicationEvidenceSha256,
      checksums.priorPublication !== input.expectedPriorPublicationEvidenceSha256,
      authorization.currentProductionDeploymentEvidenceSha256 !== checksums.currentDeployment,
      authorization.priorProductionDeploymentEvidenceSha256 !== checksums.priorDeployment,
      authorization.priorPublicationEvidenceSha256 !== checksums.priorPublication,
      currentDeployment.publicationEvidenceSha256 !== checksums.currentPublication,
      priorDeployment.publicationEvidenceSha256 !== checksums.priorPublication,
      currentDeployment.frozenReleaseManifestSha256 !== currentPublication.frozenRelease.frozenReleaseManifestSha256,
      priorDeployment.frozenReleaseManifestSha256 !== priorPublication.frozenRelease.frozenReleaseManifestSha256,
      !equalProducer(currentDeployment.producer, currentPublication.producer),
      !equalProducer(priorDeployment.producer, priorPublication.producer),
      !equalImages(currentDeployment.images, currentPublication.images),
      !equalImages(priorDeployment.images, priorPublication.images),
      authorization.operatorId !== currentDeployment.run.operatorId,
      authorization.operatorId !== priorDeployment.run.operatorId,
      authorization.currentSchemaVersion !== currentDeployment.database.schemaVersion,
      priorDeployment.database.schemaVersion < authorization.priorMinimumCompatibleVersion,
      priorDeployment.database.schemaVersion > authorization.priorMaximumCompatibleVersion,
      authorization.currentSchemaVersion < authorization.priorMinimumCompatibleVersion,
      authorization.currentSchemaVersion > authorization.priorMaximumCompatibleVersion,
      !Number.isFinite(now) || now < Date.parse(authorization.authorizedAt) || now >= Date.parse(authorization.expiresAt),
    ];
    if (invalidChecks.includes(true)) throw new Error("rollback binding mismatch");
    return deepFreeze({
      authorization,
      currentDeployment,
      priorDeployment,
      currentPublication,
      priorPublication,
      images: priorPublication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    });
  } catch (cause) {
    throw Object.assign(new Error("Production rollback is forbidden"), { code: "PRODUCTION_ROLLBACK_FORBIDDEN", cause });
  }
}

export function selectSchemaCompatibleRollbackV2(input) {
  try {
    const authorization = parseCanonical(input.rollbackAuthorizationBytes, ApplicationRollbackAuthorizationV2Schema, canonicalSerializeApplicationRollbackAuthorizationV2);
    const currentDeployment = parseCanonical(input.currentProductionDeploymentEvidenceBytes, ProductionDeploymentEvidenceV2Schema, canonicalSerializeProductionDeploymentEvidenceV2);
    const priorDeployment = parseCanonical(input.priorProductionDeploymentEvidenceBytes, ProductionDeploymentEvidenceV2Schema, canonicalSerializeProductionDeploymentEvidenceV2);
    const currentPublication = parseCanonical(input.currentPublicationEvidenceBytes, PublicationEvidenceV1Schema, canonicalSerializePublicationEvidence);
    const priorPublication = parseCanonical(input.priorPublicationEvidenceBytes, PublicationEvidenceV1Schema, canonicalSerializePublicationEvidence);
    const checksums = {
      authorization: sha256Bytes(input.rollbackAuthorizationBytes), currentDeployment: sha256Bytes(input.currentProductionDeploymentEvidenceBytes),
      priorDeployment: sha256Bytes(input.priorProductionDeploymentEvidenceBytes), currentPublication: sha256Bytes(input.currentPublicationEvidenceBytes),
      priorPublication: sha256Bytes(input.priorPublicationEvidenceBytes),
    };
    const now = Date.parse(input.now);
    const invalidChecks = [
      checksums.authorization !== input.expectedRollbackAuthorizationSha256,
      checksums.currentDeployment !== input.expectedCurrentProductionDeploymentEvidenceSha256,
      checksums.priorDeployment !== input.expectedPriorProductionDeploymentEvidenceSha256,
      checksums.currentPublication !== input.expectedCurrentPublicationEvidenceSha256,
      checksums.priorPublication !== input.expectedPriorPublicationEvidenceSha256,
      authorization.currentProductionDeploymentEvidenceSha256 !== checksums.currentDeployment,
      authorization.priorProductionDeploymentEvidenceSha256 !== checksums.priorDeployment,
      authorization.currentPublicationEvidenceSha256 !== checksums.currentPublication,
      authorization.priorPublicationEvidenceSha256 !== checksums.priorPublication,
      currentDeployment.publicationEvidenceSha256 !== checksums.currentPublication,
      priorDeployment.publicationEvidenceSha256 !== checksums.priorPublication,
      currentDeployment.frozenReleaseManifestSha256 !== currentPublication.frozenRelease.frozenReleaseManifestSha256,
      priorDeployment.frozenReleaseManifestSha256 !== priorPublication.frozenRelease.frozenReleaseManifestSha256,
      !equalProducer(currentDeployment.producer, currentPublication.producer),
      !equalProducer(priorDeployment.producer, priorPublication.producer),
      !equalImages(currentDeployment.images, currentPublication.images),
      !equalImages(priorDeployment.images, priorPublication.images),
      authorization.operatorId !== currentDeployment.run.operatorId,
      authorization.operatorId !== priorDeployment.run.operatorId,
      authorization.currentSchemaVersion !== currentDeployment.database.schemaVersion,
      !Number.isFinite(now),
      now < Date.parse(authorization.authorizedAt),
      now >= Date.parse(authorization.expiresAt),
    ];
    if (invalidChecks.includes(true)) throw new Error("rollback binding mismatch");
    return deepFreeze({ authorization, currentDeployment, priorDeployment, currentPublication, priorPublication,
      images: priorPublication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })) });
  } catch (cause) {
    throw Object.assign(new Error("Production rollback is forbidden"), { code: "PRODUCTION_ROLLBACK_FORBIDDEN", cause });
  }
}
