import { z } from "zod";
import { canonicalJson, sha256Bytes } from "./release-runtime.mjs";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const TimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
const OperatorIdSchema = z.string().regex(/^operator_[0-9A-Z]{26}$/);
const RunIdSchema = z.string().regex(/^(?:prod|run)_[0-9A-Z]{26}$/);
const PassedSchema = z.object({ status: z.literal("passed") }).strict();
const ProducerSchema = z.object({
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  treeSha: z.string().regex(/^[a-f0-9]{40}$/),
}).strict().refine(({ commitSha, treeSha }) => commitSha !== treeSha, { path: ["treeSha"] });
const GhcrRepositorySchema = z.string().regex(/^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/);
const imageIds = ["caddy", "web", "api", "worker", "postgres-recovery"];

const ProductionImageSchema = (id) => z.object({
  id: z.literal(id),
  remoteRepository: GhcrRepositorySchema,
  remoteReference: z.string(),
  remoteDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.remoteReference !== `${value.remoteRepository}@${value.remoteDigest}`) {
    context.addIssue({ code: "custom", path: ["remoteReference"], message: "Production reference must be immutable." });
  }
});

export const ProductionTargetV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("digitalocean-production-target"),
  provider: z.literal("digitalocean"),
  environment: z.literal("production"),
  deploymentId: z.string().regex(/^orivra-production-[a-z0-9-]+$/),
  composeProject: z.string().regex(/^proofline-production-[a-z0-9-]+$/),
  publicOrigin: z.string().url(),
  dnsName: z.string().regex(/^[a-z0-9.-]+$/),
  sshEndpoint: z.object({
    host: z.string().min(1).max(253),
    port: z.literal(22),
    hostKeySha256: Sha256Schema,
  }).strict(),
  ingress: z.tuple([z.literal(80), z.literal(443)]),
}).strict().superRefine((value, context) => {
  try {
    const origin = new URL(value.publicOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash ||
      origin.pathname !== "/" || origin.search || origin.hostname !== value.dnsName || origin.origin !== value.publicOrigin) {
      context.addIssue({ code: "custom", path: ["publicOrigin"], message: "Production origin is not canonical." });
    }
  } catch {
    context.addIssue({ code: "custom", path: ["publicOrigin"], message: "Production origin is invalid." });
  }
});

export const ProductionPromotionAuthorizationV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("production-promotion-authorization"),
  status: z.literal("authorized"),
  promote: z.literal(true),
  publicationEvidenceSha256: Sha256Schema,
  stagingDeploymentEvidenceSha256: Sha256Schema,
  productionTargetSha256: Sha256Schema,
  operatorId: OperatorIdSchema,
  authorizedAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).strict().refine((value) => Date.parse(value.authorizedAt) < Date.parse(value.expiresAt), { path: ["expiresAt"] });

export const ProductionDeploymentEvidenceV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("digitalocean-production-deployment-evidence"),
  status: z.literal("passed"),
  verification: z.literal("verified"),
  productionClaim: z.literal(true),
  producer: ProducerSchema,
  publicationEvidenceSha256: Sha256Schema,
  stagingDeploymentEvidenceSha256: Sha256Schema,
  frozenReleaseManifestSha256: Sha256Schema,
  promotionAuthorizationSha256: Sha256Schema,
  target: ProductionTargetV1Schema,
  run: z.object({ runId: RunIdSchema, operatorId: OperatorIdSchema, completedAt: TimestampSchema }).strict(),
  pullCredential: z.object({ registry: z.literal("ghcr.io"), access: z.literal("read-only") }).strict(),
  images: z.tuple(imageIds.map(ProductionImageSchema)),
  topology: z.object({
    publicService: z.literal("caddy"),
    publicPorts: z.tuple([z.literal(80), z.literal(443)]),
    privateServices: z.tuple([z.literal("web"), z.literal("api"), z.literal("worker"), z.literal("postgres")]),
    forbiddenPublicPorts: z.tuple([z.literal(5432), z.literal(8080)]),
    dockerSocketMounted: z.literal(false),
  }).strict(),
  database: z.object({
    volumeIdentitySha256: Sha256Schema,
    migrationManifestSha256: Sha256Schema,
    targetVersion: z.literal(10),
    schemaVersion: z.literal(10),
    roleBootstrap: PassedSchema,
    migration: PassedSchema,
  }).strict(),
  checks: z.object({
    exactDigestPull: PassedSchema,
    healthz: PassedSchema,
    readyz: PassedSchema,
    workerHeartbeat: z.object({ status: z.literal("current") }).strict(),
    spacesPitr: z.object({ restoreEvidenceSha256: Sha256Schema, status: z.literal("passed") }).strict(),
    liveCoston2: z.object({ runId: RunIdSchema, status: z.literal("persisted") }).strict(),
  }).strict(),
}).strict();

const checkpointIds = ["pre-cutover", "post-cutover-15m", "post-cutover-1h", "post-cutover-24h", "post-cutover-72h", "post-cutover-7d"];

export const ProductionPromotionEvidenceV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("digitalocean-production-promotion-evidence"),
  status: z.literal("passed"),
  verification: z.literal("verified"),
  promotionClaim: z.literal(true),
  producer: ProducerSchema,
  publicationEvidenceSha256: Sha256Schema,
  productionDeploymentEvidenceSha256: Sha256Schema,
  runId: RunIdSchema,
  operatorId: OperatorIdSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  canary: z.object({
    durationSeconds: z.literal(604800),
    checkpoints: z.tuple(checkpointIds.map((id) => z.object({ id: z.literal(id), observedAt: TimestampSchema, status: z.literal("passed") }).strict())),
  }).strict(),
}).strict().superRefine((value, context) => {
  const start = Date.parse(value.startedAt);
  const completed = Date.parse(value.completedAt);
  if (completed - start !== 604800000 || value.canary.checkpoints[0].observedAt !== value.startedAt ||
    value.canary.checkpoints.at(-1).observedAt !== value.completedAt) {
    context.addIssue({ code: "custom", path: ["canary"], message: "Canary interval is not terminal." });
  }
});

export const ApplicationRollbackAuthorizationV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("application-rollback-authorization"),
  status: z.literal("authorized"),
  rollback: z.literal(true),
  currentProductionDeploymentEvidenceSha256: Sha256Schema,
  priorProductionDeploymentEvidenceSha256: Sha256Schema,
  priorPublicationEvidenceSha256: Sha256Schema,
  currentSchemaVersion: z.number().int().nonnegative(),
  priorMinimumCompatibleVersion: z.number().int().nonnegative(),
  priorMaximumCompatibleVersion: z.number().int().nonnegative(),
  operatorId: OperatorIdSchema,
  authorizedAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.priorMinimumCompatibleVersion > value.currentSchemaVersion ||
    value.currentSchemaVersion > value.priorMaximumCompatibleVersion ||
    Date.parse(value.authorizedAt) >= Date.parse(value.expiresAt)) {
    context.addIssue({ code: "custom", path: ["currentSchemaVersion"], message: "Rollback schema compatibility is invalid." });
  }
});

const serialize = (schema, value) => canonicalJson(schema.parse(value));
const checksum = (text) => sha256Bytes(new TextEncoder().encode(text));

export const canonicalSerializeProductionTarget = (value) => serialize(ProductionTargetV1Schema, value);
export const canonicalSerializeProductionPromotionAuthorization = (value) => serialize(ProductionPromotionAuthorizationV1Schema, value);
export const canonicalSerializeProductionDeploymentEvidence = (value) => serialize(ProductionDeploymentEvidenceV1Schema, value);
export const canonicalSerializeProductionPromotionEvidence = (value) => serialize(ProductionPromotionEvidenceV1Schema, value);
export const checksumProductionTarget = (value) => checksum(canonicalSerializeProductionTarget(value));
export const checksumProductionPromotionAuthorization = (value) => checksum(canonicalSerializeProductionPromotionAuthorization(value));
export const checksumProductionDeploymentEvidence = (value) => checksum(canonicalSerializeProductionDeploymentEvidence(value));
export const checksumProductionPromotionEvidence = (value) => checksum(canonicalSerializeProductionPromotionEvidence(value));
