import { z } from "zod";
import { sha256Bytes } from "./sha256-runtime.mjs";
export { sha256Bytes };

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const ReleaseArtifactPathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/)
  .refine((value) => !value.startsWith("/") && !value.includes("//") &&
    !value.split("/").includes(".."));

const ProducerSchema = z.object({
  commitSha: CommitShaSchema,
  treeSha: CommitShaSchema,
  sourceSnapshotSha256: Sha256Schema,
  sourceDateEpoch: z.number().int().positive().safe(),
  verification: z.literal("verified"),
  releaseClaim: z.literal(true),
}).strict().refine((value) => value.commitSha !== value.treeSha, {
  path: ["treeSha"],
});

const imageDefinitions = [
  ["caddy", "proofline/caddy", "images/01-caddy.linux-amd64.oci.tar"],
  ["web", "proofline/web", "images/02-web.linux-amd64.oci.tar"],
  ["api", "proofline/api", "images/03-api.linux-amd64.oci.tar"],
  ["worker", "proofline/worker", "images/04-worker.linux-amd64.oci.tar"],
  [
    "postgres-recovery",
    "proofline/postgres-recovery",
    "images/05-postgres-recovery.linux-amd64.oci.tar",
  ],
];

function imageSchema([id, repository, archiveFilename]) {
  return z.object({
    id: z.literal(id),
    repository: z.literal(repository),
    reference: z.string(),
    platform: z.literal("linux/amd64"),
    archiveFilename: z.literal(archiveFilename),
    archiveFormat: z.literal("oci-image-layout-v1.0.0+ustar"),
    archiveSizeBytes: z.number().int().positive().safe(),
    archiveSha256: Sha256Schema,
    imageManifestDigest: Sha256Schema,
  }).strict().superRefine((value, context) => {
    if (value.archiveSha256 === value.imageManifestDigest) {
      context.addIssue({ code: "custom", path: ["archiveSha256"], message: "Release digest namespaces must be distinct." });
    }
    if (value.reference !== `${value.repository}@${value.imageManifestDigest}`) {
      context.addIssue({ code: "custom", path: ["reference"], message: "Release reference is not immutable." });
    }
  });
}

export const FrozenOciReleaseManifestV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("frozen-oci-release-manifest"),
  producer: ProducerSchema,
  database: z.object({
    migrationManifestPath: z.literal("apps/api/db/migrations/manifest.v1.json"),
    migrationManifestSha256: Sha256Schema,
    targetVersion: z.literal(10),
    minimumCompatibleVersion: z.literal(10),
    maximumCompatibleVersion: z.literal(10),
  }).strict(),
  action: z.object({
    metadataPath: z.literal("packages/action/action.yml"),
    metadataSha256: Sha256Schema,
    artifactPath: z.literal("packages/action/dist/index.js"),
    artifactSha256: Sha256Schema,
  }).strict(),
  recovery: z.object({
    walGVersion: z.literal("v3.0.8"),
    walGReleaseLockPath: z.literal("docker/wal-g-release.v1.json"),
    walGReleaseLockSha256: Sha256Schema,
    walGReceiptSha256: Sha256Schema,
    walGBinarySha256: Sha256Schema,
  }).strict(),
  images: z.tuple(imageDefinitions.map(imageSchema)),
}).strict();

const ReleaseArtifactSchema = z.object({
  filename: ReleaseArtifactPathSchema,
  sizeBytes: z.number().int().positive().safe(),
  sha256: Sha256Schema,
}).strict();

const expectedArtifactNames = [
  "frozen-release-manifest.v1.json",
  ...imageDefinitions.map(([, , filename]) => filename),
].sort();

export const FrozenOciReleaseReceiptV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("frozen-oci-release-receipt"),
  status: z.literal("passed"),
  verification: z.literal("verified"),
  releaseClaim: z.literal(true),
  producer: z.object({ commitSha: CommitShaSchema, treeSha: CommitShaSchema }).strict(),
  frozenReleaseManifestSha256: Sha256Schema,
  artifacts: z.array(ReleaseArtifactSchema).length(expectedArtifactNames.length),
  artifactInventorySha256: Sha256Schema,
}).strict().superRefine((value, context) => {
  const names = value.artifacts.map(({ filename }) => filename);
  if (JSON.stringify(names) !== JSON.stringify(expectedArtifactNames)) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "Release artifact inventory is not exact or sorted." });
  }
  const manifest = value.artifacts.find(({ filename }) => filename === "frozen-release-manifest.v1.json");
  if (manifest?.sha256 !== value.frozenReleaseManifestSha256) {
    context.addIssue({ code: "custom", path: ["frozenReleaseManifestSha256"], message: "Release manifest checksum is not bound." });
  }
}).refine(
  (value) => checksumReleaseArtifactInventory(value.artifacts) === value.artifactInventorySha256,
  { path: ["artifactInventorySha256"], message: "Release artifact inventory checksum is invalid." },
);

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function canonicalSerializeFrozenOciReleaseManifest(value) {
  return canonicalJson(FrozenOciReleaseManifestV1Schema.parse(value));
}

export function canonicalSerializeFrozenOciReleaseReceipt(value) {
  return canonicalJson(FrozenOciReleaseReceiptV1Schema.parse(value));
}

export function checksumFrozenOciReleaseManifest(value) {
  return sha256Bytes(new TextEncoder().encode(canonicalSerializeFrozenOciReleaseManifest(value)));
}

export function checksumReleaseArtifactInventory(value) {
  return sha256Bytes(new TextEncoder().encode(canonicalJson(value)));
}
