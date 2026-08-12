import { createHash } from "node:crypto";

const BACKUP_ID = /^base_[0-9A-Z]{16,64}$/;
const WAL_SEGMENT = /^[0-9A-F]{24}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function invalid(cause) {
  throw Object.assign(new Error("TIMEWEB_DAILY_BACKUP_INVALID: Timeweb daily backup or archive freshness is invalid"), {
    code: "TIMEWEB_DAILY_BACKUP_INVALID",
    cause,
  });
}

const checksum = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function runTimewebProductionDailyBackup({
  clock,
  createFullBackup,
  switchWal,
  observeArchive,
  readCanonicalBackupEvidence,
  authorizeRetention,
  runRetention,
} = {}) {
  try {
    const observedAt = clock?.now?.();
    if (!Number.isFinite(Date.parse(observedAt)) ||
      [createFullBackup, switchWal, observeArchive, readCanonicalBackupEvidence, authorizeRetention, runRetention]
        .some((entry) => typeof entry !== "function")) throw new Error("input");
    const backup = await createFullBackup();
    if (backup?.status !== "passed" || !BACKUP_ID.test(backup.backupId ?? "")) throw new Error("backup");
    const switched = await switchWal();
    if (switched?.status !== "passed" || !WAL_SEGMENT.test(switched.walSegment ?? "")) throw new Error("wal switch");
    const archive = await observeArchive({ walSegment: switched.walSegment, observedAt });
    if (archive?.status !== "passed" || archive.source !== "postgres-archive-status" ||
      archive.walSegment !== switched.walSegment || !Number.isSafeInteger(archive.archivePendingAgeSeconds) ||
      archive.archivePendingAgeSeconds < 0 || archive.archivePendingAgeSeconds > 60) throw new Error("archive freshness");
    const evidence = await readCanonicalBackupEvidence({ backup, archive });
    if (!Buffer.isBuffer(evidence?.bytes) || evidence.bytes.length < 1 || !SHA256.test(evidence.sha256 ?? "") ||
      checksum(evidence.bytes) !== evidence.sha256 || evidence.backupId !== backup.backupId) throw new Error("evidence");
    const authorization = await authorizeRetention({
      backupEvidenceBytes: evidence.bytes,
      backupEvidenceSha256: evidence.sha256,
      backupId: backup.backupId,
    });
    if (authorization?.status !== "authorized" || authorization.retainFull !== 8) throw new Error("retention authorization");
    const retained = await runRetention({
      authorization,
      backupEvidenceBytes: evidence.bytes,
      backupEvidenceSha256: evidence.sha256,
      args: ["delete", "retain", "FULL", "8", "--confirm"],
    });
    if (retained?.status !== "passed") throw new Error("retention");
    return Object.freeze({
      status: "passed",
      backupId: backup.backupId,
      backupEvidenceSha256: evidence.sha256,
      archivePendingAgeSeconds: archive.archivePendingAgeSeconds,
      retainedFull: 8,
    });
  } catch (cause) {
    if (cause?.code === "TIMEWEB_DAILY_BACKUP_INVALID") throw cause;
    invalid(cause);
  }
}
