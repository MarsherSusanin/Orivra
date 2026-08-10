import { z } from "zod";

const CommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const UtcMicrosecondsSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((value) => {
    const milliseconds = `${value.slice(0, -4)}Z`;
    return !Number.isNaN(Date.parse(milliseconds));
  });
const TimelineSchema = z.number().int().min(1).max(0xffff_ffff);

const ProducerSchema = z
  .object({
    commitSha: CommitShaSchema,
    treeSha: CommitShaSchema,
    postgresImageDigest: Sha256Schema,
    walGVersion: z.literal("v3.0.8"),
  })
  .strict();

const RestoreDrillEvidenceCoreSchema = z
  .object({
    version: z.literal("1"),
    kind: z.literal("pitr-restore-drill"),
    producer: ProducerSchema,
    sourceBackupEvidenceSha256: Sha256Schema,
    target: z
      .object({
        targetTime: UtcMicrosecondsSchema,
        inclusive: z.literal(true),
        timeline: TimelineSchema,
      })
      .strict(),
    restore: z
      .object({
        sourceVolumeIdentitySha256: Sha256Schema,
        restoreVolumeIdentitySha256: Sha256Schema,
        paused: z.literal(true),
        inRecovery: z.literal(true),
        promoted: z.literal(false),
      })
      .strict(),
    checks: z
      .object({
        systemIdentifierMatches: z.literal(true),
        schemaVersion: z.literal(10),
        migrationChecksums: z.literal(10),
        beforeCutPresent: z.literal(true),
        afterCutAbsent: z.literal(true),
        inventorySha256Matches: z.literal(true),
      })
      .strict(),
    startedAt: UtcMicrosecondsSchema,
    completedAt: UtcMicrosecondsSchema,
    status: z.literal("passed"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.restore.sourceVolumeIdentitySha256 ===
      value.restore.restoreVolumeIdentitySha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["restore", "restoreVolumeIdentitySha256"],
        message: "Restore volume must be distinct.",
      });
    }
  });

export const RestoreDrillEvidenceV1Schema = RestoreDrillEvidenceCoreSchema.refine(
  (value) => value.completedAt >= value.startedAt,
  { path: ["completedAt"], message: "Restore completion precedes its start." },
);

export const RestorePromotionAuthorizationV1Schema = z
  .object({
    version: z.literal("1"),
    kind: z.literal("restore-promotion-authorization"),
    restoreDrillEvidenceSha256: Sha256Schema,
    operator: z.string().regex(/^operator_[a-z0-9]{16,64}$/),
    authorizedAt: UtcMicrosecondsSchema,
    expiresAt: UtcMicrosecondsSchema,
    promote: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt <= value.authorizedAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Promotion authorization must expire after issuance.",
      });
    }
  });

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function canonicalSerializeRestoreDrillEvidence(value) {
  return canonicalJson(RestoreDrillEvidenceV1Schema.parse(value));
}
