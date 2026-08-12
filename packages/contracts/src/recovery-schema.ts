import { z } from "zod";
import {
  RestoreDrillEvidenceV1Schema,
  RestorePromotionAuthorizationV1Schema,
  RestorePromotionAuthorizationV2Schema,
  RecoveryEvidenceHandoffV1Schema,
  canonicalSerializeRecoveryEvidenceHandoff,
  canonicalSerializeRestoreDrillEvidence,
} from "./recovery-runtime.mjs";

export {
  RestoreDrillEvidenceV1Schema,
  RestorePromotionAuthorizationV1Schema,
  RestorePromotionAuthorizationV2Schema,
  RecoveryEvidenceHandoffV1Schema,
  canonicalSerializeRecoveryEvidenceHandoff,
  canonicalSerializeRestoreDrillEvidence,
};

const CommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CanonicalPositiveDecimalSchema = z.string().regex(/^[1-9][0-9]*$/);
const UtcMicrosecondsSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((value) => {
    const milliseconds = `${value.slice(0, -4)}Z`;
    return !Number.isNaN(Date.parse(milliseconds));
  });
const LsnSchema = z.string().regex(/^[0-9A-F]+\/[0-9A-F]+$/);
const WalSegmentSchema = z.string().regex(/^[0-9A-F]{24}$/);
const TimelineSchema = z.number().int().min(1).max(0xffff_ffff);

const ProducerSchema = z
  .object({
    commitSha: CommitShaSchema,
    treeSha: CommitShaSchema,
    postgresImageDigest: Sha256Schema,
    walGVersion: z.literal("v3.0.8"),
  })
  .strict()
  .refine((value) => value.commitSha !== value.treeSha, {
    path: ["treeSha"],
    message: "Producer commit and tree identities must be distinct.",
  });

const DatabaseSchema = z
  .object({
    slot: z.enum(["staging", "production", "qa"]),
    systemIdentifier: CanonicalPositiveDecimalSchema,
    postgresMajor: z.literal(17),
    schemaVersion: z.literal(10),
    migrationCount: z.literal(10),
    migrationManifestSha256: Sha256Schema,
  })
  .strict();

const StorageSharedFields = {
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/),
    prefix: z.string(),
    encryption: z.literal("wal-g-libsodium"),
    encryptionKeyIdSha256: Sha256Schema,
} as const;

const StorageSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("minio"),
      endpointOrigin: z.literal("http://minio:9000"),
      ...StorageSharedFields,
    })
    .strict(),
  z
    .object({
      provider: z.literal("digitalocean-spaces"),
      endpointOrigin: z
        .string()
        .regex(/^https:\/\/[a-z0-9]+\.digitaloceanspaces\.com$/),
      ...StorageSharedFields,
    })
    .strict(),
  z
    .object({
      provider: z.literal("timeweb-s3"),
      endpointOrigin: z.literal("https://s3.twcstorage.ru"),
      region: z.literal("ru-1"),
      addressing: z.literal("path-style"),
      authorityMode: z.literal("shared-pilot"),
      ...StorageSharedFields,
    })
    .strict(),
]);

const InventoryEntrySchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (value) =>
          /^(?:basebackups_005|wal_005)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(
            value,
          ) &&
          !value.split("/").includes("..") &&
          !value.includes("//"),
      ),
    size: z.number().int().positive().safe(),
    sha256: Sha256Schema,
  })
  .strict();

function compareLsn(left: string, right: string): bigint {
  const [leftHigh, leftLow] = left.split("/");
  const [rightHigh, rightLow] = right.split("/");
  const leftValue = (BigInt(`0x${leftHigh}`) << 32n) + BigInt(`0x${leftLow}`);
  const rightValue =
    (BigInt(`0x${rightHigh}`) << 32n) + BigInt(`0x${rightLow}`);
  return leftValue - rightValue;
}

const BackupEvidenceCoreSchema = z
  .object({
    version: z.literal("1"),
    kind: z.literal("base-backup"),
    producer: ProducerSchema,
    database: DatabaseSchema,
    storage: StorageSchema,
    backup: z
      .object({
        id: z.string().regex(/^base_[0-9A-F]{24}$/),
        startedAt: UtcMicrosecondsSchema,
        completedAt: UtcMicrosecondsSchema,
        startLsn: LsnSchema,
        stopLsn: LsnSchema,
        startWalSegment: WalSegmentSchema,
        stopWalSegment: WalSegmentSchema,
        timeline: TimelineSchema,
      })
      .strict(),
    inventory: z
      .object({
        entries: z.array(InventoryEntrySchema).min(1).max(100_000),
        objectCount: z.number().int().positive().safe(),
        totalBytes: z.number().int().nonnegative().safe(),
        canonicalSha256: Sha256Schema,
      })
      .strict(),
    status: z.literal("completed"),
  })
  .strict();

const BackupEvidenceRefinedSchema = BackupEvidenceCoreSchema.superRefine(
  (value, context) => {
    const expectedPrefix =
      `s3://${value.storage.bucket}/proofline/v1/${value.database.slot}/` +
      value.database.systemIdentifier;
    if (value.storage.prefix !== expectedPrefix) {
      context.addIssue({
        code: "custom",
        path: ["storage", "prefix"],
        message: "Storage prefix must be derived from evidence identity.",
      });
    }
    if (value.backup.completedAt < value.backup.startedAt) {
      context.addIssue({
        code: "custom",
        path: ["backup", "completedAt"],
        message: "Backup completion precedes its start.",
      });
    }
    const entries = value.inventory.entries;
    const sortedKeys = entries.map(({ key }) => key).sort();
    const ordered = entries.every((entry, index) => entry.key === sortedKeys[index]);
    const unique = new Set(entries.map(({ key }) => key)).size === entries.length;
    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (
      !ordered ||
      !unique ||
      value.inventory.objectCount !== entries.length ||
      value.inventory.totalBytes !== totalBytes ||
      !Number.isSafeInteger(totalBytes)
    ) {
      context.addIssue({
        code: "custom",
        path: ["inventory"],
        message: "Inventory aggregates or ordering are invalid.",
      });
    }
  },
);

const ExpectedProviderBySlot = {
  qa: "minio",
  staging: "digitalocean-spaces",
  production: "timeweb-s3",
} as const;

export const BackupEvidenceV1Schema = BackupEvidenceRefinedSchema
  .refine(
    (value) => compareLsn(value.backup.startLsn, value.backup.stopLsn) <= 0n,
    { path: ["backup"], message: "Backup LSN bounds are not ordered." },
  )
  .refine(
    (value) => value.backup.startWalSegment <= value.backup.stopWalSegment,
    { path: ["backup"], message: "Backup WAL segments are not ordered." },
  )
  .refine(
    (value) =>
      ExpectedProviderBySlot[value.database.slot] === value.storage.provider,
    { path: ["storage"], message: "Storage provider does not match the slot." },
  );

export type BackupEvidenceV1 = z.infer<typeof BackupEvidenceV1Schema>;

export type RestoreDrillEvidenceV1 = z.infer<
  typeof RestoreDrillEvidenceV1Schema
>;

export type RestorePromotionAuthorizationV1 = z.infer<
  typeof RestorePromotionAuthorizationV1Schema
>;

export type RestorePromotionAuthorizationV2 = z.infer<
  typeof RestorePromotionAuthorizationV2Schema
>;

export type RecoveryEvidenceHandoffV1 = z.infer<
  typeof RecoveryEvidenceHandoffV1Schema
>;

type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(input: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const schedule = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      schedule[index] =
        ((bytes[start]! << 24) | (bytes[start + 1]! << 16) |
          (bytes[start + 2]! << 8) | bytes[start + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = schedule[index - 15]!;
      const right = schedule[index - 2]!;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      schedule[index] =
        (schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const upper1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + upper1 + choose + constants[index]! + schedule[index]!) >>> 0;
      const upper0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (upper0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) {
      state[index] = (state[index]! + value!) >>> 0;
    }
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function canonicalSerializeBackupEvidence(value: unknown): string {
  return canonicalJson(BackupEvidenceV1Schema.parse(value) as JsonValue);
}

export function checksumBackupEvidence(value: unknown): string {
  return `sha256:${sha256Hex(canonicalSerializeBackupEvidence(value))}`;
}

export function checksumRestoreDrillEvidence(value: unknown): string {
  return `sha256:${sha256Hex(canonicalSerializeRestoreDrillEvidence(value))}`;
}

export function checksumRecoveryEvidenceHandoff(value: unknown): string {
  return `sha256:${sha256Hex(canonicalSerializeRecoveryEvidenceHandoff(value))}`;
}
