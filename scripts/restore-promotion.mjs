import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  BackupEvidenceV1Schema,
  canonicalJson,
} from "./backup-evidence-validation.mjs";
import {
  RecoveryEvidenceHandoffV1Schema,
  RestoreDrillEvidenceV1Schema,
  RestorePromotionAuthorizationV2Schema,
  canonicalSerializeRecoveryEvidenceHandoff,
  canonicalSerializeRestoreDrillEvidence,
} from "../packages/contracts/src/recovery-runtime.mjs";

const ERROR_CODE = "RESTORE_PROMOTION_FORBIDDEN";
const ERROR_MESSAGE = "Restore promotion is forbidden";
const MISMATCH_CODE = "RESTORE_PROMOTION_EVIDENCE_MISMATCH";
const MISMATCH_MESSAGE = "Restore promotion evidence does not match";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAXIMUM_BYTES = Object.freeze({
  handoff: 64 * 1024,
  backup: 32 * 1024 * 1024,
  restore: 1024 * 1024,
  authorization: 64 * 1024,
});

function forbidden() {
  throw Object.assign(new Error(ERROR_MESSAGE), { code: ERROR_CODE });
}

function evidenceMismatch() {
  throw Object.assign(new Error(MISMATCH_MESSAGE), { code: MISMATCH_CODE });
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireBytes(value, maximumBytes) {
  if (!Buffer.isBuffer(value) || value.length < 1 || value.length > maximumBytes) {
    forbidden();
  }
  return value;
}

function parseCanonical(bytes, schema, serialize, maximumBytes) {
  requireBytes(bytes, maximumBytes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = schema.parse(JSON.parse(text));
  if (serialize(value) !== text) forbidden();
  return value;
}

function parseCanonicalBackup(bytes) {
  requireBytes(bytes, MAXIMUM_BYTES.backup);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  const validation = structuredClone(value);
  if (!SHA256.test(validation?.inventory?.canonicalSha256 ?? "")) forbidden();
  validation.inventory.canonicalSha256 = sha256(Buffer.from(canonicalJson({
    entries: validation.inventory.entries,
    objectCount: validation.inventory.objectCount,
    totalBytes: validation.inventory.totalBytes,
  }), "utf8"));
  BackupEvidenceV1Schema.parse(validation);
  if (canonicalJson(value) !== text) forbidden();
  return value;
}

function exactProducer(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export async function authorizeRestorePromotion({
  handoffReceiptBytes,
  expectedHandoffReceiptSha256,
  backupEvidenceBytes,
  restoreEvidenceBytes,
  authorizationBytes,
  now,
  run = spawnSync,
} = {}) {
  try {
    if (!SHA256.test(expectedHandoffReceiptSha256 ?? "")) forbidden();
    requireBytes(handoffReceiptBytes, MAXIMUM_BYTES.handoff);
    if (sha256(handoffReceiptBytes) !== expectedHandoffReceiptSha256) {
      evidenceMismatch();
    }
    const handoff = parseCanonical(
      handoffReceiptBytes,
      RecoveryEvidenceHandoffV1Schema,
      canonicalSerializeRecoveryEvidenceHandoff,
      MAXIMUM_BYTES.handoff,
    );
    const backup = parseCanonicalBackup(backupEvidenceBytes);
    const restore = parseCanonical(
      restoreEvidenceBytes,
      RestoreDrillEvidenceV1Schema,
      canonicalSerializeRestoreDrillEvidence,
      MAXIMUM_BYTES.restore,
    );
    if (
      handoff.backup.sha256 !== sha256(backupEvidenceBytes) ||
      handoff.restore.sha256 !== sha256(restoreEvidenceBytes) ||
      restore.sourceBackupEvidenceSha256 !== sha256(backupEvidenceBytes) ||
      !exactProducer(handoff.producer, backup.producer) ||
      !exactProducer(handoff.producer, restore.producer)
    ) evidenceMismatch();
    const authorization = parseCanonical(
      authorizationBytes,
      RestorePromotionAuthorizationV2Schema,
      (value) => canonicalJson(value),
      MAXIMUM_BYTES.authorization,
    );
    if (
      authorization.recoveryEvidenceHandoffSha256 !==
        expectedHandoffReceiptSha256 ||
      authorization.restoreDrillEvidenceSha256 !== sha256(restoreEvidenceBytes)
    ) evidenceMismatch();
    if (handoff.verification !== "verified" || handoff.releaseClaim !== true) forbidden();
    if (typeof now !== "string") forbidden();
    const currentEpoch = Date.parse(`${now.slice(0, -4)}Z`);
    const authorizedEpoch = Date.parse(`${authorization.authorizedAt.slice(0, -4)}Z`);
    const expiresEpoch = Date.parse(`${authorization.expiresAt.slice(0, -4)}Z`);
    if (
      Number.isNaN(currentEpoch) || authorizedEpoch > currentEpoch ||
      expiresEpoch <= currentEpoch
    ) forbidden();
    const result = await run("psql", [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      "SELECT CASE WHEN pg_is_in_recovery() THEN pg_promote(true, 60) ELSE false END",
    ], { encoding: "utf8", stdio: "pipe" });
    if (result?.status !== 0 || result.stdout !== "t\n") forbidden();
  } catch (cause) {
    if (cause?.code === ERROR_CODE || cause?.code === MISMATCH_CODE) throw cause;
    forbidden();
  }
}
