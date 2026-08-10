import { constants } from "node:fs";
import { open } from "node:fs/promises";

const ERROR_CODE = "BACKUP_CONFIGURATION_INVALID";
const ERROR_MESSAGE = "Backup configuration is invalid";
const MAX_SECRET_BYTES = 4_096;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const UTC_MICROSECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BACKUP_ID = /^base_[0-9A-F]{24}$/;
const SECRET_FILE_NAMES = [
  "PROOFLINE_BACKUP_DATABASE_URL_FILE",
  "PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE",
];

export class BackupConfigurationError extends Error {
  code = ERROR_CODE;

  constructor() {
    super(ERROR_MESSAGE);
    this.name = "BackupConfigurationError";
  }
}

function invalidConfiguration() {
  throw new BackupConfigurationError();
}

function hasAmbientObjectStoreAuthority(environment) {
  return Object.keys(environment).some((name) =>
    /^(?:AWS|WALG|WALE)_(?:ACCESS|SECRET|SESSION|PROFILE|SHARED|CONFIG|ENDPOINT|S3|LIBSODIUM)/.test(
      name,
    ),
  );
}

function canonicalUtcMicroseconds(value) {
  if (typeof value !== "string" || !UTC_MICROSECONDS.test(value)) {
    invalidConfiguration();
  }
  const milliseconds = `${value.slice(0, -4)}Z`;
  if (Number.isNaN(Date.parse(milliseconds))) invalidConfiguration();
  return value;
}

export function parseProductionBackupConfiguration(environment = process.env) {
  try {
    if (hasAmbientObjectStoreAuthority(environment)) invalidConfiguration();
    const slot = environment.PROOFLINE_BACKUP_SLOT;
    const endpointValue = environment.PROOFLINE_BACKUP_ENDPOINT;
    const region = environment.PROOFLINE_BACKUP_REGION;
    const bucket = environment.PROOFLINE_BACKUP_BUCKET;
    if (
      (slot !== "staging" && slot !== "production") ||
      typeof endpointValue !== "string" ||
      !/^[a-z]{3}[0-9]$/.test(region ?? "") ||
      !/^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/.test(bucket ?? "") ||
      bucket.includes("..")
    ) {
      invalidConfiguration();
    }
    const endpoint = new URL(endpointValue);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== `${region}.digitaloceanspaces.com` ||
      endpoint.port ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.origin !== endpointValue
    ) {
      invalidConfiguration();
    }
    return Object.freeze({
      slot,
      endpoint: endpoint.origin,
      region,
      bucket,
    });
  } catch (cause) {
    if (cause instanceof BackupConfigurationError) throw cause;
    invalidConfiguration();
  }
}

export function parseQaBackupConfiguration(environment = process.env) {
  try {
    if (hasAmbientObjectStoreAuthority(environment)) invalidConfiguration();
    if (
      environment.PROOFLINE_BACKUP_SLOT !== "qa" ||
      environment.PROOFLINE_BACKUP_ENDPOINT !== "http://minio:9000" ||
      environment.PROOFLINE_BACKUP_REGION !== "us-east-1" ||
      !/^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/.test(
        environment.PROOFLINE_BACKUP_BUCKET ?? "",
      )
    ) {
      invalidConfiguration();
    }
    return Object.freeze({
      slot: "qa",
      endpoint: "http://minio:9000",
      region: "us-east-1",
      bucket: environment.PROOFLINE_BACKUP_BUCKET,
    });
  } catch (cause) {
    if (cause instanceof BackupConfigurationError) throw cause;
    invalidConfiguration();
  }
}

export function parseRestorePlan(environment = process.env) {
  try {
    const backupId = environment.PROOFLINE_RESTORE_BACKUP_ID;
    const backupEvidenceSha256 =
      environment.PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256;
    const targetTime = canonicalUtcMicroseconds(
      environment.PROOFLINE_RECOVERY_TARGET_TIME,
    );
    const timelineRaw = environment.PROOFLINE_RECOVERY_TARGET_TIMELINE;
    if (
      typeof backupId !== "string" ||
      !BACKUP_ID.test(backupId) ||
      backupId.includes("LATEST") ||
      typeof backupEvidenceSha256 !== "string" ||
      !SHA256.test(backupEvidenceSha256) ||
      typeof timelineRaw !== "string" ||
      !/^[1-9][0-9]*$/.test(timelineRaw)
    ) {
      invalidConfiguration();
    }
    const timeline = Number(timelineRaw);
    if (!Number.isSafeInteger(timeline) || timeline > 0xffff_ffff) {
      invalidConfiguration();
    }
    return Object.freeze({
      backupId,
      backupEvidenceSha256,
      targetTime,
      timeline,
    });
  } catch (cause) {
    if (cause instanceof BackupConfigurationError) throw cause;
    invalidConfiguration();
  }
}

async function readBoundedSecretFile(path) {
  let handle;
  try {
    if (typeof path !== "string" || !path.startsWith("/")) {
      invalidConfiguration();
    }
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const status = await handle.stat();
    if (!status.isFile() || status.size < 1 || status.size > MAX_SECRET_BYTES) {
      invalidConfiguration();
    }
    const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length < 1 || length > MAX_SECRET_BYTES) invalidConfiguration();
    const value = new TextDecoder("utf-8", { fatal: true })
      .decode(buffer.subarray(0, length))
      .trim();
    if (!value || value.includes("\0")) invalidConfiguration();
    return value;
  } catch (cause) {
    if (cause instanceof BackupConfigurationError) throw cause;
    invalidConfiguration();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function loadBackupSecretFiles(environment = process.env) {
  try {
    const result = {};
    for (const fileName of SECRET_FILE_NAMES) {
      const directName = fileName.slice(0, -5);
      if (
        Object.hasOwn(environment, directName) ||
        typeof environment[fileName] !== "string"
      ) {
        invalidConfiguration();
      }
      result[directName] = await readBoundedSecretFile(environment[fileName]);
    }
    return Object.freeze(result);
  } catch (cause) {
    if (cause instanceof BackupConfigurationError) throw cause;
    invalidConfiguration();
  }
}

export const backupSecretFileNames = Object.freeze([...SECRET_FILE_NAMES]);
