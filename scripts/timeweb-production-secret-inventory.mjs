import { timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

const SECRET_ROOT = "/opt/orivra/secrets";
const MAXIMUM_SECRET_BYTES = 65_536;

export const TIMEWEB_PRODUCTION_SECRET_FILE_AUTHORITY = Object.freeze({
  PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE: Object.freeze(["postgres_admin_database_url", 1000]),
  PROOFLINE_MIGRATOR_DATABASE_URL_FILE: Object.freeze(["migrator_database_url", 1000]),
  PROOFLINE_API_DATABASE_URL_FILE: Object.freeze(["api_database_url", 1000]),
  PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: Object.freeze(["api_token_digest_key", 1000]),
  PROOFLINE_WORKER_DATABASE_URL_FILE: Object.freeze(["worker_database_url", 1000]),
  PROOFLINE_WORKER_VERIFIER_API_KEY_FILE: Object.freeze(["worker_verifier_api_key", 1000]),
  PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE: Object.freeze(["worker_coston2_private_key", 1000]),
  PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: Object.freeze(["recording_importer_database_url", 1000]),
  PROOFLINE_BACKUP_BOOTSTRAP_DATABASE_URL_FILE: Object.freeze(["backup_bootstrap_database_url", 1000]),
  PROOFLINE_POSTGRES_PASSWORD_FILE: Object.freeze(["postgres_password", 999]),
  PROOFLINE_BACKUP_DATABASE_URL_FILE: Object.freeze(["backup_database_url", 999]),
  PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE: Object.freeze(["backup_writer_access_key_id", 999]),
  PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE: Object.freeze(["backup_writer_secret_access_key", 999]),
  PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE: Object.freeze(["backup_reader_access_key_id", 999]),
  PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE: Object.freeze(["backup_reader_secret_access_key", 999]),
  PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE: Object.freeze(["backup_retention_access_key_id", 999]),
  PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE: Object.freeze(["backup_retention_secret_access_key", 999]),
  PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE: Object.freeze(["backup_encryption_key", 999]),
});

function invalid() {
  return Object.assign(new Error("TIMEWEB_PRODUCTION_SECRET_INVENTORY_INVALID: Production secret inventory is invalid"), {
    code: "TIMEWEB_PRODUCTION_SECRET_INVENTORY_INVALID",
  });
}

async function captureSecretFile(path) {
  let handle;
  let bytes;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile() || status.isSymbolicLink?.() || status.size < 1 || status.size > MAXIMUM_SECRET_BYTES) {
      throw invalid();
    }
    bytes = Buffer.alloc(status.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw invalid();
    return { status, bytes };
  } catch (cause) {
    bytes?.fill(0);
    throw cause;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function equalBytes(entries, names) {
  const first = entries.get(names[0]);
  return names.slice(1).every((name) => {
    const candidate = entries.get(name);
    return first.length === candidate.length && timingSafeEqual(first, candidate);
  });
}

export async function validateTimewebProductionSecretInventory({
  environment = process.env,
  inspectSecretRoot = () => lstat(SECRET_ROOT),
  captureSecretFile: capture = captureSecretFile,
} = {}) {
  const captured = new Map();
  try {
    const root = await inspectSecretRoot(SECRET_ROOT);
    if (!root.isDirectory() || root.isSymbolicLink?.() || (root.mode & 0o777) !== 0o500 || root.uid !== 0 || root.gid !== 0) {
      throw invalid();
    }
    const paths = new Set();
    const identities = new Set();
    for (const [name, [basename, uid]] of Object.entries(TIMEWEB_PRODUCTION_SECRET_FILE_AUTHORITY)) {
      const expectedPath = `${SECRET_ROOT}/${basename}`;
      if (environment[name] !== expectedPath || paths.has(expectedPath)) throw invalid();
      paths.add(expectedPath);
      const record = await capture(expectedPath, name);
      const status = record?.status;
      const bytes = record?.bytes;
      if (Buffer.isBuffer(bytes)) captured.set(name, bytes);
      if (!status?.isFile?.() || status.isSymbolicLink?.() || (status.mode & 0o777) !== 0o400 ||
        status.uid !== uid || status.gid !== uid || !Buffer.isBuffer(bytes) || bytes.length < 1 ||
        bytes.length > MAXIMUM_SECRET_BYTES || bytes.length !== status.size) {
        throw invalid();
      }
      if (Number.isSafeInteger(status.dev) && Number.isSafeInteger(status.ino)) {
        const identity = `${status.dev}:${status.ino}`;
        if (identities.has(identity)) throw invalid();
        identities.add(identity);
      }
    }
    for (const names of [
      ["PROOFLINE_BACKUP_BOOTSTRAP_DATABASE_URL_FILE", "PROOFLINE_BACKUP_DATABASE_URL_FILE"],
      ["PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE", "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE", "PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE"],
      ["PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE", "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE", "PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE"],
    ]) if (!equalBytes(captured, names)) throw invalid();
    return Object.freeze({ status: "passed", secretRoot: SECRET_ROOT, fileCount: captured.size, authorityMode: "split-uid-private" });
  } catch {
    throw invalid();
  } finally {
    for (const bytes of captured.values()) bytes.fill(0);
  }
}
