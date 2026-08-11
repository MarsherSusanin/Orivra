import { z } from "zod";
import { canonicalJson, sha256Bytes } from "./release-runtime.mjs";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const CanonicalTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
const RunIdSchema = z.string().regex(/^(?:pub|stg|run)_[0-9A-Z]{26}$/);
const OperatorIdSchema = z.string().regex(/^operator_[0-9A-Z]{26}$/);
const GhcrRepositorySchema = z.string()
  .regex(/^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/)
  .refine((value) => !value.includes("@") && !value.slice("ghcr.io/".length).includes(":"));

const imageDefinitions = Object.freeze([
  ["caddy", "proofline/caddy", "images/01-caddy.linux-amd64.oci.tar"],
  ["web", "proofline/web", "images/02-web.linux-amd64.oci.tar"],
  ["api", "proofline/api", "images/03-api.linux-amd64.oci.tar"],
  ["worker", "proofline/worker", "images/04-worker.linux-amd64.oci.tar"],
  ["postgres-recovery", "proofline/postgres-recovery", "images/05-postgres-recovery.linux-amd64.oci.tar"],
]);

const TargetImageSchema = ([id, sourceRepository]) => z.object({
  id: z.literal(id),
  sourceRepository: z.literal(sourceRepository),
  remoteRepository: GhcrRepositorySchema,
}).strict();

export const GhcrPublicationTargetsV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("ghcr-publication-targets"),
  registry: z.literal("ghcr.io"),
  images: z.tuple(imageDefinitions.map(TargetImageSchema)),
}).strict().superRefine((value, context) => {
  const repositories = value.images.map(({ remoteRepository }) => remoteRepository);
  if (new Set(repositories).size !== repositories.length) {
    context.addIssue({ code: "custom", path: ["images"], message: "GHCR repositories must be unique." });
  }
});

const ProducerSchema = z.object({
  commitSha: CommitShaSchema,
  treeSha: CommitShaSchema,
}).strict().refine((value) => value.commitSha !== value.treeSha, { path: ["treeSha"] });

const PublishedImageSchema = ([id, sourceRepository, archiveFilename]) => z.object({
  id: z.literal(id),
  sourceRepository: z.literal(sourceRepository),
  platform: z.literal("linux/amd64"),
  archiveFilename: z.literal(archiveFilename),
  archiveSizeBytes: z.number().int().positive().safe(),
  archiveSha256: Sha256Schema,
  imageManifestDigest: Sha256Schema,
  remoteRepository: GhcrRepositorySchema,
  remoteReference: z.string(),
  remoteDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.archiveSha256 === value.remoteDigest) {
    context.addIssue({ code: "custom", path: ["remoteDigest"], message: "Archive and registry digests are distinct." });
  }
  if (value.remoteDigest !== value.imageManifestDigest) {
    context.addIssue({ code: "custom", path: ["remoteDigest"], message: "Remote manifest digest mismatch." });
  }
  if (value.remoteReference !== `${value.remoteRepository}@${value.remoteDigest}`) {
    context.addIssue({ code: "custom", path: ["remoteReference"], message: "Remote reference is not immutable." });
  }
});

export const PublicationEvidenceV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("oci-publication-evidence"),
  status: z.literal("passed"),
  verification: z.literal("verified"),
  publicationClaim: z.literal(true),
  producer: ProducerSchema,
  runId: RunIdSchema,
  operatorId: OperatorIdSchema,
  publishedAt: CanonicalTimestampSchema,
  authorization: z.object({
    credentialFreeMlpCandidateSha256: Sha256Schema,
    coreReportSha256: Sha256Schema,
    productReportSha256: Sha256Schema,
  }).strict(),
  frozenRelease: z.object({
    frozenReleaseManifestSha256: Sha256Schema,
    receiptSha256: Sha256Schema,
    artifactInventorySha256: Sha256Schema,
  }).strict(),
  ghcrPublicationTargetsSha256: Sha256Schema,
  registry: z.literal("ghcr.io"),
  images: z.tuple(imageDefinitions.map(PublishedImageSchema)),
}).strict().superRefine((value, context) => {
  const repositories = value.images.map(({ remoteRepository }) => remoteRepository);
  if (new Set(repositories).size !== repositories.length) {
    context.addIssue({ code: "custom", path: ["images"], message: "Published repositories must be unique." });
  }
});

const StagingImageSchema = ([id]) => z.object({
  id: z.literal(id),
  remoteRepository: GhcrRepositorySchema,
  remoteReference: z.string(),
  remoteDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.remoteReference !== `${value.remoteRepository}@${value.remoteDigest}`) {
    context.addIssue({ code: "custom", path: ["remoteReference"], message: "Staging reference is not immutable." });
  }
});

const PassedSchema = z.object({ status: z.literal("passed") }).strict();

export const StagingDeploymentEvidenceV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("digitalocean-staging-deployment-evidence"),
  status: z.literal("passed"),
  verification: z.literal("verified"),
  stagingClaim: z.literal(true),
  producer: ProducerSchema,
  publicationEvidenceSha256: Sha256Schema,
  frozenReleaseManifestSha256: Sha256Schema,
  target: z.object({
    provider: z.literal("digitalocean"),
    environment: z.literal("staging"),
    deploymentId: z.string().min(1).max(128),
    composeProject: z.string().regex(/^proofline-staging-[a-z0-9-]+$/),
    publicOrigin: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  }).strict(),
  run: z.object({
    runId: RunIdSchema,
    operatorId: OperatorIdSchema,
    completedAt: CanonicalTimestampSchema,
    sshHostKeySha256: Sha256Schema,
  }).strict(),
  pullCredential: z.object({ registry: z.literal("ghcr.io"), access: z.literal("read-only") }).strict(),
  images: z.tuple(imageDefinitions.map(StagingImageSchema)),
  checks: z.object({
    exactDigestPull: PassedSchema,
    migration: z.object({
      migrationManifestSha256: Sha256Schema,
      targetVersion: z.literal(10),
      schemaVersion: z.literal(10),
      status: z.literal("passed"),
    }).strict(),
    healthz: PassedSchema,
    readyz: PassedSchema,
    workerHeartbeat: z.object({ status: z.literal("current") }).strict(),
    hostedBrowserSmoke: PassedSchema,
    spacesRestore: z.object({ restoreEvidenceSha256: Sha256Schema, status: z.literal("passed") }).strict(),
    liveCoston2: z.object({ runId: RunIdSchema, status: z.literal("passed") }).strict(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const repositories = value.images.map(({ remoteRepository }) => remoteRepository);
  if (new Set(repositories).size !== repositories.length) {
    context.addIssue({ code: "custom", path: ["images"], message: "Staging repositories must be unique." });
  }
});

export function canonicalSerializeGhcrPublicationTargets(value) {
  return canonicalJson(GhcrPublicationTargetsV1Schema.parse(value));
}

export function canonicalSerializePublicationEvidence(value) {
  return canonicalJson(PublicationEvidenceV1Schema.parse(value));
}

export function canonicalSerializeStagingDeploymentEvidence(value) {
  return canonicalJson(StagingDeploymentEvidenceV1Schema.parse(value));
}

const checksum = (text) => sha256Bytes(new TextEncoder().encode(text));

export const checksumGhcrPublicationTargets = (value) => checksum(canonicalSerializeGhcrPublicationTargets(value));
export const checksumPublicationEvidence = (value) => checksum(canonicalSerializePublicationEvidence(value));
export const checksumStagingDeploymentEvidence = (value) => checksum(canonicalSerializeStagingDeploymentEvidence(value));
