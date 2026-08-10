import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  BackupEvidenceV1Schema,
  canonicalSerializeBackupEvidence,
  parseCanonicalBackupEvidence,
  sha256,
} from "./backup-evidence-validation.mjs";

const ERROR_CODE = "BACKUP_RETENTION_EVIDENCE_INVALID";
const ERROR_MESSAGE = "Backup retention evidence is invalid";
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function invalidEvidence() {
  throw Object.assign(new Error(ERROR_MESSAGE), { code: ERROR_CODE });
}

export function authorizeBackupRetention({
  backupEvidenceBytes,
  expectedBackupEvidenceSha256,
  expectedPrefix,
  encryptionKeyBytes,
} = {}) {
  try {
    const evidence = parseCanonicalBackupEvidence(backupEvidenceBytes);
    // Keep these exact shared authority names visible at the destructive boundary.
    BackupEvidenceV1Schema.parse(evidence);
    if (canonicalSerializeBackupEvidence(evidence) !== backupEvidenceBytes.toString("utf8")) {
      invalidEvidence();
    }
    if (
      !SHA256.test(expectedBackupEvidenceSha256 ?? "") ||
      sha256(backupEvidenceBytes) !== expectedBackupEvidenceSha256 ||
      typeof expectedPrefix !== "string" ||
      evidence.storage.prefix !== expectedPrefix ||
      !Buffer.isBuffer(encryptionKeyBytes) ||
      encryptionKeyBytes.length < 1 ||
      sha256(encryptionKeyBytes) !== evidence.storage.encryptionKeyIdSha256
    ) invalidEvidence();
    return Object.freeze({
      backupId: evidence.backup.id,
      evidenceSha256: expectedBackupEvidenceSha256,
      prefix: evidence.storage.prefix,
    });
  } catch (cause) {
    if (cause?.code === ERROR_CODE) throw cause;
    invalidEvidence();
  }
}

export async function runAuthorizedBackupRetention({ runWalG, ...input } = {}) {
  const authorization = authorizeBackupRetention(input);
  if (typeof runWalG !== "function") invalidEvidence();
  const result = await runWalG(["delete", "retain", "FULL", "8", "--confirm"]);
  if (!result || result.status !== 0) invalidEvidence();
  return authorization;
}

async function runCli() {
  const backupEvidenceBytes = await readFile(
    process.env.PROOFLINE_BACKUP_EVIDENCE_FILE ?? "",
  );
  const encryptionKeyBytes = await readFile(
    process.env.PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE ?? "",
  );
  authorizeBackupRetention({
    backupEvidenceBytes,
    expectedBackupEvidenceSha256:
      process.env.PROOFLINE_BACKUP_EVIDENCE_SHA256,
    expectedPrefix: process.env.WALG_S3_PREFIX,
    encryptionKeyBytes,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCli().catch(() => {
    process.stderr.write(`${ERROR_MESSAGE}\n`);
    process.exitCode = 64;
  });
}
