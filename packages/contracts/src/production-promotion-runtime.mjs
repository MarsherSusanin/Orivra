import { z } from "zod";
import { canonicalJson, sha256Bytes } from "./canonical-runtime.mjs";
import {
  SafeConsumerRegistryV1Schema,
  canonicalSerializeSafeConsumerRegistry,
  checksumSafeConsumerRegistry,
} from "./safe-consumer-registry-runtime.mjs";

export { SafeConsumerRegistryV1Schema, canonicalSerializeSafeConsumerRegistry, checksumSafeConsumerRegistry };

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

const OpenMeteoManifestSha256 = "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8";
const EthUsdManifestSha256 = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";

const ConsumerDeploymentSchema = (templateId, manifestSha256, contractName) => z.object({
  templateId: z.literal(templateId),
  revision: z.literal(1),
  manifestSha256: z.literal(manifestSha256),
  consumerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((value) => !/^0x0{40}$/.test(value)),
  contractName: z.literal(contractName),
  compiledSourceSha256: Sha256Schema,
  bytecodeSha256: Sha256Schema,
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  blockNumber: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
  runtimeCodeSha256: Sha256Schema,
}).strict();

export const SafeConsumerDeploymentEvidenceV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("safe-consumer-deployment-evidence"),
  status: z.literal("passed"),
  chainId: z.literal(114),
  compiler: z.object({
    name: z.literal("solc"),
    version: z.literal("0.8.36"),
    importAuthority: z.literal("official-coston2-contract-registry"),
  }).strict(),
  relayer: z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((value) => !/^0x0{40}$/.test(value)),
    balanceBeforeWei: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    requiredBalanceWei: z.string().regex(/^[1-9][0-9]*$/),
  }).strict(),
  registrySha256: Sha256Schema,
  deployments: z.tuple([
    ConsumerDeploymentSchema("open-meteo-current-weather", OpenMeteoManifestSha256, "OrivraOpenMeteoCurrentWeatherConsumer"),
    ConsumerDeploymentSchema("eth-usd", EthUsdManifestSha256, "OrivraEthUsdConsumer"),
  ]),
  completedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const registry = {
    version: "1",
    kind: "safe-consumer-registry",
    chainId: 114,
    entries: value.deployments.map(({ templateId, revision, manifestSha256, consumerAddress }) => ({
      templateId, revision, manifestSha256, consumerAddress,
    })),
  };
  if (value.deployments[0].consumerAddress.toLowerCase() === value.deployments[1].consumerAddress.toLowerCase() ||
    value.registrySha256 !== checksumSafeConsumerRegistry(registry)) {
    context.addIssue({ code: "custom", path: ["registrySha256"], message: "Safe consumer registry binding is invalid." });
  }
});

export const TimewebS3PilotAuthorityV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("timeweb-s3-pilot-authority"),
  provider: z.literal("timeweb-s3"),
  endpoint: z.literal("https://s3.twcstorage.ru"),
  region: z.literal("ru-1"),
  bucket: z.literal("orivra-backet"),
  pathStyle: z.literal(true),
  authorityMode: z.literal("shared-pilot"),
  credentialDelivery: z.literal("secret-files"),
  qaProvider: z.literal("minio-only"),
  swiftRuntime: z.literal(false),
}).strict();


export const ProductionTargetV2Schema = z.object({
  version: z.literal("2"),
  kind: z.literal("digitalocean-production-target"),
  provider: z.literal("digitalocean"),
  environment: z.literal("production"),
  deploymentMode: z.literal("direct-pilot"),
  deploymentId: z.string().regex(/^orivra-production-[a-z0-9-]+$/),
  composeProject: z.string().regex(/^proofline-production-[a-z0-9-]+$/),
  publicOrigin: z.string().url(),
  dnsName: z.string().regex(/^[a-z0-9.-]+$/),
  sshEndpoint: z.object({ host: z.string().min(1).max(253), port: z.literal(22), hostKeySha256: Sha256Schema }).strict(),
  ingress: z.tuple([z.literal(80), z.literal(443)]),
  objectStore: TimewebS3PilotAuthorityV1Schema,
}).strict().superRefine((value, context) => {
  const origin = new URL(value.publicOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash || origin.pathname !== "/" ||
    origin.search || origin.hostname !== value.dnsName || origin.origin !== value.publicOrigin) {
    context.addIssue({ code: "custom", path: ["publicOrigin"], message: "Production origin is not canonical." });
  }
});

export const ProductionPromotionAuthorizationV2Schema = z.object({
  version: z.literal("2"),
  kind: z.literal("production-promotion-authorization"),
  status: z.literal("authorized"),
  promote: z.literal(true),
  deploymentMode: z.literal("direct-pilot"),
  publicationEvidenceSha256: Sha256Schema,
  productionTargetSha256: Sha256Schema,
  objectStoreAuthoritySha256: Sha256Schema,
  operatorId: OperatorIdSchema,
  authorizedAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).strict().refine((value) => Date.parse(value.authorizedAt) < Date.parse(value.expiresAt), { path: ["expiresAt"] });

const ProductionGhcrPreflightImagesSchema = z.tuple([
  ["caddy", "ghcr.io/marshersusanin/orivra-caddy"],
  ["web", "ghcr.io/marshersusanin/orivra-web"],
  ["api", "ghcr.io/marshersusanin/orivra-api"],
  ["worker", "ghcr.io/marshersusanin/orivra-worker"],
  ["postgres-recovery", "ghcr.io/marshersusanin/orivra-postgres-recovery"],
].map(([id, repository]) => z.object({
  id: z.literal(id),
  remoteReference: z.string().refine((value) => value.startsWith(`${repository}@sha256:`) && value.length === repository.length + 72),
  remoteDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.remoteReference !== `${repository}@${value.remoteDigest}`) {
    context.addIssue({ code: "custom", path: ["remoteReference"], message: "GHCR reference must bind the exact digest." });
  }
})));

const PreflightChecksSchema = z.tuple([
  z.object({ check: z.literal("dns-target"), status: z.literal("passed"), dnsName: z.string(), addresses: z.tuple([z.literal("72.56.81.28")]) }).strict(),
  z.object({ check: z.literal("ssh-host-key"), status: z.literal("passed"), host: z.string(), port: z.literal(22), expectedHostKeySha256: Sha256Schema, observedHostKeySha256: Sha256Schema }).strict()
    .refine((value) => value.expectedHostKeySha256 === value.observedHostKeySha256, { path: ["observedHostKeySha256"] }),
  z.object({ check: z.literal("read-only-ghcr"), status: z.literal("passed"), registry: z.literal("ghcr.io"), access: z.literal("read-only"),
    images: ProductionGhcrPreflightImagesSchema }).strict(),
  z.object({ check: z.literal("secret-files"), status: z.literal("passed"), fileIdsSha256: Sha256Schema, valuesExposed: z.literal(false) }).strict(),
  z.object({ check: z.literal("timeweb-s3-authority"), status: z.literal("passed"), authoritySha256: Sha256Schema, authorityMode: z.literal("shared-pilot"),
    endpoint: z.literal("https://s3.twcstorage.ru"), region: z.literal("ru-1"), bucket: z.literal("orivra-backet"), pathStyle: z.literal(true),
    capabilities: z.tuple(["PUT", "HEAD", "LIST", "GET", "DELETE"].map((operation) =>
      z.object({ operation: z.literal(operation), status: z.literal("passed") }).strict())) }).strict(),
  z.object({ check: z.literal("replay-bundle"), status: z.literal("passed"), bundleSha256: Sha256Schema, reportSha256: Sha256Schema }).strict(),
  z.object({ check: z.literal("safe-consumer-manifests"), status: z.literal("passed"), registrySha256: Sha256Schema, manifests: z.tuple([
    z.tuple([z.literal("open-meteo-current-weather"), z.literal(OpenMeteoManifestSha256)]),
    z.tuple([z.literal("eth-usd"), z.literal(EthUsdManifestSha256)]),
  ]) }).strict(),
  z.object({ check: z.literal("live-coston2"), status: z.literal("passed"), chainId: z.literal(114),
    rpcUrl: z.literal("https://coston2-api.flare.network/ext/C/rpc"),
    dataAvailabilityUrl: z.literal("https://ctn2-data-availability.flare.network"),
    relayerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/), balanceWei: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    authorization: z.literal("configured") }).strict(),
]);

export const ProductionPilotPreflightEvidenceV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("production-pilot-preflight-evidence"),
  status: z.literal("passed"),
  targetSha256: Sha256Schema,
  objectStoreAuthoritySha256: Sha256Schema,
  checks: PreflightChecksSchema,
}).strict();

const RunV2Schema = z.object({ runId: RunIdSchema, operatorId: OperatorIdSchema, completedAt: TimestampSchema }).strict();
const LiveRunIdsSchema = z.tuple([RunIdSchema, RunIdSchema]).refine(([left, right]) => left !== right);

export const ProductionDeploymentEvidenceV2Schema = z.object({
  version: z.literal("2"), kind: z.literal("digitalocean-production-deployment-evidence"), status: z.literal("passed"),
  verification: z.literal("verified"), productionClaim: z.literal(true), producer: ProducerSchema,
  publicationEvidenceSha256: Sha256Schema, frozenReleaseManifestSha256: Sha256Schema,
  promotionAuthorizationSha256: Sha256Schema, preflightEvidenceSha256: Sha256Schema,
  target: ProductionTargetV2Schema, run: RunV2Schema,
  pullCredential: z.object({ registry: z.literal("ghcr.io"), access: z.literal("read-only") }).strict(),
  images: z.tuple(imageIds.map(ProductionImageSchema)),
  topology: z.object({ publicService: z.literal("caddy"), publicPorts: z.tuple([z.literal(80), z.literal(443)]),
    privateServices: z.tuple([z.literal("web"), z.literal("api"), z.literal("worker"), z.literal("postgres")]),
    forbiddenPublicPorts: z.tuple([z.literal(5432), z.literal(8080)]), dockerSocketMounted: z.literal(false) }).strict(),
  database: z.object({ migrationManifestSha256: Sha256Schema, targetVersion: z.literal(10), schemaVersion: z.literal(10),
    roleBootstrap: PassedSchema, migration: PassedSchema }).strict(),
  objectStore: TimewebS3PilotAuthorityV1Schema,
  safeConsumers: SafeConsumerRegistryV1Schema,
  checks: z.object({
    exactDigestPull: PassedSchema,
    readyz: PassedSchema,
    workerHeartbeat: z.object({ status: z.literal("current") }).strict(),
    timewebPitr: z.object({ status: z.literal("passed"), restoreEvidenceSha256: Sha256Schema, backupAgeSeconds: z.number().int().nonnegative(), archivePendingAgeSeconds: z.number().int().nonnegative().max(60) }).strict(),
    liveCoston2: z.object({ status: z.literal("persisted"), runIds: LiveRunIdsSchema, manifests: z.tuple([z.literal(OpenMeteoManifestSha256), z.literal(EthUsdManifestSha256)]) }).strict(),
  }).strict(),
  cutover: z.object({
    status: z.literal("passed"),
    publicOrigin: z.literal("https://orivra.xyz"),
    activatedAt: TimestampSchema,
  }).strict(),
}).strict();

const CanaryChecksV2Schema = z.object({
  healthz: PassedSchema, readyz: PassedSchema,
  workerHeartbeat: z.object({ status: z.literal("current") }).strict(),
  objectStore: z.object({ status: z.literal("passed"), backupAgeSeconds: z.number().int().nonnegative(), archivePendingAgeSeconds: z.number().int().nonnegative().max(60) }).strict(),
  diskPressure: PassedSchema, hostedBrowserSmoke: PassedSchema,
  liveCoston2: z.object({ status: z.literal("persisted"), runIds: LiveRunIdsSchema }).strict(),
  clock: z.object({ status: z.literal("synchronized"), source: z.literal("production-host"),
    maximumSkewSeconds: z.literal(5), observedSkewSeconds: z.number().int().min(0).max(5) }).strict(),
}).strict();
const CanaryIdV2Schema = z.enum(["cutover", "post-cutover-15m", "post-cutover-1h", "post-cutover-24h"]);

export const ProductionCanaryCheckpointV2Schema = z.object({
  version: z.literal("2"), kind: z.literal("production-canary-checkpoint"), id: CanaryIdV2Schema,
  dueAt: TimestampSchema, observedAt: TimestampSchema, status: z.literal("passed"), checks: CanaryChecksV2Schema,
}).strict().refine((value) => Date.parse(value.observedAt) >= Date.parse(value.dueAt), { path: ["observedAt"] });

const CanaryTupleV2Schema = z.tuple([
  ProductionCanaryCheckpointV2Schema.refine(({ id }) => id === "cutover"),
  ProductionCanaryCheckpointV2Schema.refine(({ id }) => id === "post-cutover-15m"),
  ProductionCanaryCheckpointV2Schema.refine(({ id }) => id === "post-cutover-1h"),
  ProductionCanaryCheckpointV2Schema.refine(({ id }) => id === "post-cutover-24h"),
]);

export const ProductionPromotionEvidenceV2Schema = z.object({
  version: z.literal("2"), kind: z.literal("digitalocean-production-promotion-evidence"), status: z.literal("passed"),
  verification: z.literal("verified"), promotionClaim: z.literal(true), producer: ProducerSchema,
  publicationEvidenceSha256: Sha256Schema, productionDeploymentEvidenceSha256: Sha256Schema,
  runId: RunIdSchema, operatorId: OperatorIdSchema,
  cutover: z.object({ status: z.literal("passed"), publicOrigin: z.string().url(), activatedAt: TimestampSchema }).strict(),
  canary: z.object({ durationSeconds: z.literal(86400), checkpoints: CanaryTupleV2Schema }).strict(),
  completedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const checkpoints = value.canary.checkpoints;
  const started = Date.parse(checkpoints[0].dueAt);
  const completed = Date.parse(value.completedAt);
  const expectedDue = [0, 900, 3600, 86400];
  const invalidChecks = [
    completed - started < 86400000,
    checkpoints.at(-1).observedAt !== value.completedAt,
    value.cutover.activatedAt !== checkpoints[0].dueAt,
    checkpoints.some((entry, index) => Date.parse(entry.dueAt) !== started + expectedDue[index] * 1000),
  ];
  if (invalidChecks.includes(true)) {
    context.addIssue({ code: "custom", path: ["canary"], message: "Canary interval is not terminal." });
  }
});

export const ApplicationRollbackAuthorizationV2Schema = z.object({
  version: z.literal("2"), kind: z.literal("application-rollback-authorization"), status: z.literal("authorized"), rollback: z.literal(true),
  currentProductionDeploymentEvidenceSha256: Sha256Schema, priorProductionDeploymentEvidenceSha256: Sha256Schema,
  currentPublicationEvidenceSha256: Sha256Schema, priorPublicationEvidenceSha256: Sha256Schema,
  currentSchemaVersion: z.number().int().nonnegative(), priorMinimumCompatibleVersion: z.number().int().nonnegative(), priorMaximumCompatibleVersion: z.number().int().nonnegative(),
  operatorId: OperatorIdSchema, authorizedAt: TimestampSchema, expiresAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const invalidChecks = [
    value.priorMinimumCompatibleVersion > value.currentSchemaVersion,
    value.currentSchemaVersion > value.priorMaximumCompatibleVersion,
    Date.parse(value.authorizedAt) >= Date.parse(value.expiresAt),
  ];
  if (invalidChecks.includes(true)) {
    context.addIssue({ code: "custom", path: ["currentSchemaVersion"], message: "Rollback schema compatibility is invalid." });
  }
});

const serialize = (schema, value) => canonicalJson(schema.parse(value));
const checksum = (text) => sha256Bytes(new TextEncoder().encode(text));

export const canonicalSerializeProductionTarget = (value) => serialize(ProductionTargetV1Schema, value);
export const canonicalSerializeProductionPromotionAuthorization = (value) => serialize(ProductionPromotionAuthorizationV1Schema, value);
export const canonicalSerializeProductionDeploymentEvidence = (value) => serialize(ProductionDeploymentEvidenceV1Schema, value);
export const canonicalSerializeProductionPromotionEvidence = (value) => serialize(ProductionPromotionEvidenceV1Schema, value);
export const canonicalSerializeApplicationRollbackAuthorization = (value) => serialize(ApplicationRollbackAuthorizationV1Schema, value);
export const checksumProductionTarget = (value) => checksum(canonicalSerializeProductionTarget(value));
export const checksumProductionPromotionAuthorization = (value) => checksum(canonicalSerializeProductionPromotionAuthorization(value));
export const checksumProductionDeploymentEvidence = (value) => checksum(canonicalSerializeProductionDeploymentEvidence(value));
export const checksumProductionPromotionEvidence = (value) => checksum(canonicalSerializeProductionPromotionEvidence(value));
export const checksumApplicationRollbackAuthorization = (value) => checksum(canonicalSerializeApplicationRollbackAuthorization(value));
export const canonicalSerializeTimewebS3PilotAuthority = (value) => serialize(TimewebS3PilotAuthorityV1Schema, value);
export const canonicalSerializeSafeConsumerDeploymentEvidence = (value) => serialize(SafeConsumerDeploymentEvidenceV1Schema, value);
export const canonicalSerializeProductionPilotPreflightEvidence = (value) => serialize(ProductionPilotPreflightEvidenceV1Schema, value);
export const canonicalSerializeProductionTargetV2 = (value) => serialize(ProductionTargetV2Schema, value);
export const canonicalSerializeProductionPromotionAuthorizationV2 = (value) => serialize(ProductionPromotionAuthorizationV2Schema, value);
export const canonicalSerializeProductionDeploymentEvidenceV2 = (value) => serialize(ProductionDeploymentEvidenceV2Schema, value);
export const canonicalSerializeProductionCanaryCheckpointV2 = (value) => serialize(ProductionCanaryCheckpointV2Schema, value);
export const canonicalSerializeProductionPromotionEvidenceV2 = (value) => serialize(ProductionPromotionEvidenceV2Schema, value);
export const canonicalSerializeApplicationRollbackAuthorizationV2 = (value) => serialize(ApplicationRollbackAuthorizationV2Schema, value);
export const checksumTimewebS3PilotAuthority = (value) => checksum(canonicalSerializeTimewebS3PilotAuthority(value));
export const checksumSafeConsumerDeploymentEvidence = (value) => checksum(canonicalSerializeSafeConsumerDeploymentEvidence(value));
export const checksumProductionPilotPreflightEvidence = (value) => checksum(canonicalSerializeProductionPilotPreflightEvidence(value));
export const checksumProductionTargetV2 = (value) => checksum(canonicalSerializeProductionTargetV2(value));
export const checksumProductionPromotionAuthorizationV2 = (value) => checksum(canonicalSerializeProductionPromotionAuthorizationV2(value));
export const checksumProductionDeploymentEvidenceV2 = (value) => checksum(canonicalSerializeProductionDeploymentEvidenceV2(value));
export const checksumProductionCanaryCheckpointV2 = (value) => checksum(canonicalSerializeProductionCanaryCheckpointV2(value));
export const checksumProductionPromotionEvidenceV2 = (value) => checksum(canonicalSerializeProductionPromotionEvidenceV2(value));
export const checksumApplicationRollbackAuthorizationV2 = (value) => checksum(canonicalSerializeApplicationRollbackAuthorizationV2(value));
