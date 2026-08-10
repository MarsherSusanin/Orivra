import {
  canonicalJson,
  parseCanonicalBackupEvidence,
  sha256,
  validCiphertextInventoryKey,
} from "./backup-evidence-validation.mjs";

const ERROR_CODE = "RECOVERY_INVENTORY_MISMATCH";
const ERROR_MESSAGE =
  "Recovery ciphertext inventory does not match backup evidence";

function mismatch() {
  throw Object.assign(new Error(ERROR_MESSAGE), { code: ERROR_CODE });
}

export async function collectCiphertextInventory({
  listObjects,
  readObject,
  maximumObjects,
  maximumTotalBytes,
} = {}) {
  try {
    if (
      typeof listObjects !== "function" ||
      typeof readObject !== "function" ||
      !Number.isSafeInteger(maximumObjects) ||
      maximumObjects < 1 ||
      maximumObjects > 100_000 ||
      !Number.isSafeInteger(maximumTotalBytes) ||
      maximumTotalBytes < 1
    ) mismatch();
    const listed = await listObjects();
    if (!Array.isArray(listed) || listed.length < 1 || listed.length > maximumObjects) {
      mismatch();
    }
    const seen = new Set();
    const entries = [];
    let totalBytes = 0;
    for (const listedObject of listed) {
      if (
        !listedObject ||
        typeof listedObject !== "object" ||
        Array.isArray(listedObject) ||
        !validCiphertextInventoryKey(listedObject.key) ||
        !Number.isSafeInteger(listedObject.size) ||
        listedObject.size < 1 ||
        seen.has(listedObject.key)
      ) mismatch();
      seen.add(listedObject.key);
      const bytes = await readObject(listedObject.key);
      if (!Buffer.isBuffer(bytes) || bytes.length !== listedObject.size) mismatch();
      totalBytes += bytes.length;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumTotalBytes) {
        mismatch();
      }
      entries.push({
        key: listedObject.key,
        size: bytes.length,
        sha256: sha256(bytes),
      });
    }
    entries.sort((left, right) => Buffer.from(left.key).compare(Buffer.from(right.key)));
    const inventory = {
      entries,
      objectCount: entries.length,
      totalBytes,
    };
    return {
      ...inventory,
      canonicalSha256: sha256(Buffer.from(canonicalJson(inventory), "utf8")),
    };
  } catch (cause) {
    if (cause?.code === ERROR_CODE) throw cause;
    mismatch();
  }
}

export async function verifyCiphertextInventory({
  backupEvidenceBytes,
  ...reader
} = {}) {
  try {
    const evidence = parseCanonicalBackupEvidence(backupEvidenceBytes);
    const actual = await collectCiphertextInventory(reader);
    if (canonicalJson(actual) !== canonicalJson(evidence.inventory)) mismatch();
    return actual;
  } catch (cause) {
    if (cause?.code === ERROR_CODE) throw cause;
    mismatch();
  }
}
