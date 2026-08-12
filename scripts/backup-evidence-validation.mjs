import { createHash } from "node:crypto";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const UTC_MICROSECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const LSN = /^[0-9A-F]+\/[0-9A-F]+$/;
const WAL_SEGMENT = /^[0-9A-F]{24}$/;
const INVENTORY_KEY = /^(?:basebackups_005|wal_005)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function exactObject(value, keys) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validUtc(value) {
  if (typeof value !== "string" || !UTC_MICROSECONDS.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value.slice(0, -4)}Z`));
}

function lsnValue(value) {
  const [high, low] = value.split("/");
  return (BigInt(`0x${high}`) << 32n) + BigInt(`0x${low}`);
}

function validInventoryKey(value) {
  return typeof value === "string" &&
    value.length <= 1024 &&
    INVENTORY_KEY.test(value) &&
    !value.includes("//") &&
    !value.split("/").includes("..");
}

function validInventory(inventory) {
  if (
    !exactObject(inventory, [
      "entries",
      "objectCount",
      "totalBytes",
      "canonicalSha256",
    ]) ||
    !Array.isArray(inventory.entries) ||
    inventory.entries.length < 1 ||
    inventory.entries.length > 100_000 ||
    inventory.objectCount !== inventory.entries.length ||
    !Number.isSafeInteger(inventory.totalBytes) ||
    inventory.totalBytes < 1 ||
    !SHA256.test(inventory.canonicalSha256 ?? "")
  ) return false;

  let totalBytes = 0;
  const keys = [];
  for (const entry of inventory.entries) {
    if (
      !exactObject(entry, ["key", "size", "sha256"]) ||
      !validInventoryKey(entry.key) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 1 ||
      !SHA256.test(entry.sha256 ?? "")
    ) return false;
    totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes)) return false;
    keys.push(entry.key);
  }
  if (totalBytes !== inventory.totalBytes || new Set(keys).size !== keys.length) {
    return false;
  }
  const sorted = [...keys].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)));
  if (keys.some((key, index) => key !== sorted[index])) return false;
  const canonicalInventory = {
    entries: inventory.entries,
    objectCount: inventory.objectCount,
    totalBytes: inventory.totalBytes,
  };
  return sha256(Buffer.from(canonicalJson(canonicalInventory), "utf8")) ===
    inventory.canonicalSha256;
}

function validStorage(storage, database) {
  const shared = [
    "provider",
    "endpointOrigin",
    "bucket",
    "prefix",
    "encryption",
    "encryptionKeyIdSha256",
  ];
  const expectedKeys = storage?.provider === "timeweb-s3"
    ? [...shared, "region", "addressing", "authorityMode"]
    : shared;
  if (
    !exactObject(storage, expectedKeys) ||
    typeof storage.bucket !== "string" ||
    storage.bucket.length < 3 ||
    storage.bucket.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(storage.bucket) ||
    storage.encryption !== "wal-g-libsodium" ||
    !SHA256.test(storage.encryptionKeyIdSha256 ?? "")
  ) return false;
  const providerMatches = database.slot === "qa"
    ? storage.provider === "minio" && storage.endpointOrigin === "http://minio:9000"
    : storage.provider === "timeweb-s3" && storage.endpointOrigin === "https://s3.twcstorage.ru" &&
      storage.region === "ru-1" && storage.addressing === "path-style" && storage.authorityMode === "shared-pilot" &&
      storage.bucket === "orivra-backet";
  return providerMatches && storage.prefix ===
    `s3://${storage.bucket}/proofline/v1/${database.slot}/${database.systemIdentifier}`;
}

function parseBackupEvidence(value) {
  if (
    !exactObject(value, [
      "version",
      "kind",
      "producer",
      "database",
      "storage",
      "backup",
      "inventory",
      "status",
    ]) ||
    value.version !== "1" ||
    value.kind !== "base-backup" ||
    value.status !== "completed" ||
    !exactObject(value.producer, [
      "commitSha",
      "treeSha",
      "postgresImageDigest",
      "walGVersion",
    ]) ||
    !COMMIT_SHA.test(value.producer.commitSha ?? "") ||
    !COMMIT_SHA.test(value.producer.treeSha ?? "") ||
    !SHA256.test(value.producer.postgresImageDigest ?? "") ||
    value.producer.walGVersion !== "v3.0.8" ||
    !exactObject(value.database, [
      "slot",
      "systemIdentifier",
      "postgresMajor",
      "schemaVersion",
      "migrationCount",
      "migrationManifestSha256",
    ]) ||
    !["staging", "production", "qa"].includes(value.database.slot) ||
    !POSITIVE_DECIMAL.test(value.database.systemIdentifier ?? "") ||
    value.database.postgresMajor !== 17 ||
    value.database.schemaVersion !== 10 ||
    value.database.migrationCount !== 10 ||
    !SHA256.test(value.database.migrationManifestSha256 ?? "") ||
    !validStorage(value.storage, value.database) ||
    !exactObject(value.backup, [
      "id",
      "startedAt",
      "completedAt",
      "startLsn",
      "stopLsn",
      "startWalSegment",
      "stopWalSegment",
      "timeline",
    ]) ||
    !/^base_[0-9A-F]{24}$/.test(value.backup.id ?? "") ||
    !validUtc(value.backup.startedAt) ||
    !validUtc(value.backup.completedAt) ||
    value.backup.completedAt < value.backup.startedAt ||
    !LSN.test(value.backup.startLsn ?? "") ||
    !LSN.test(value.backup.stopLsn ?? "") ||
    lsnValue(value.backup.startLsn) > lsnValue(value.backup.stopLsn) ||
    !WAL_SEGMENT.test(value.backup.startWalSegment ?? "") ||
    !WAL_SEGMENT.test(value.backup.stopWalSegment ?? "") ||
    value.backup.startWalSegment > value.backup.stopWalSegment ||
    !Number.isSafeInteger(value.backup.timeline) ||
    value.backup.timeline < 1 ||
    value.backup.timeline > 0xffff_ffff ||
    !validInventory(value.inventory)
  ) throw new Error("BackupEvidenceV1 is invalid");
  return value;
}

export const BackupEvidenceV1Schema = Object.freeze({
  parse(value) {
    return parseBackupEvidence(value);
  },
});

export function canonicalSerializeBackupEvidence(value) {
  return canonicalJson(BackupEvidenceV1Schema.parse(value));
}

export function parseCanonicalBackupEvidence(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1_048_576) {
    throw new Error("Backup evidence bytes are invalid");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = BackupEvidenceV1Schema.parse(JSON.parse(text));
  if (canonicalSerializeBackupEvidence(value) !== text) {
    throw new Error("Backup evidence is not canonical");
  }
  return value;
}

export function validCiphertextInventoryKey(value) {
  return validInventoryKey(value);
}
