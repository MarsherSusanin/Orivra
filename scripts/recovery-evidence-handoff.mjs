import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  BackupEvidenceV1Schema,
  canonicalJson,
} from "./backup-evidence-validation.mjs";
import {
  RecoveryEvidenceHandoffV1Schema,
  RestoreDrillEvidenceV1Schema,
  canonicalSerializeRecoveryEvidenceHandoff,
  canonicalSerializeRestoreDrillEvidence,
} from "../packages/contracts/src/recovery-runtime.mjs";

export const RECOVERY_EVIDENCE_DIRECTORY_NAME = "recovery-evidence.v1";
export const RECOVERY_EVIDENCE_FILENAMES = Object.freeze({
  backup: "backup-evidence.v1.json",
  restore: "restore-drill-evidence.v1.json",
  handoff: "recovery-evidence-handoff.v1.json",
});

const HANDOFF_ERROR = "Recovery evidence handoff is invalid";
const DRAFT_ERROR = "Draft recovery evidence cannot be published";
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAXIMUM_FILE_BYTES = Object.freeze({
  backup: 32 * 1024 * 1024,
  restore: 1024 * 1024,
  handoff: 64 * 1024,
});

function fail(message = HANDOFF_ERROR) {
  throw new Error(message);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function checksumRecoveryEvidenceHandoff(value) {
  return sha256(Buffer.from(canonicalSerializeRecoveryEvidenceHandoff(value), "utf8"));
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validateProducerIdentity(producerIdentity, backup) {
  if (
    !exactObject(producerIdentity, [
      "commitSha", "treeSha", "verification", "releaseClaim",
    ]) ||
    !COMMIT_SHA.test(producerIdentity.commitSha ?? "") ||
    !COMMIT_SHA.test(producerIdentity.treeSha ?? "") ||
    producerIdentity.commitSha === producerIdentity.treeSha ||
    !(
      (producerIdentity.verification === "verified" && producerIdentity.releaseClaim === true) ||
      (producerIdentity.verification === "draft" && producerIdentity.releaseClaim === false)
    ) ||
    backup.producer.commitSha !== producerIdentity.commitSha ||
    backup.producer.treeSha !== producerIdentity.treeSha
  ) fail();
}

function parsePublicBackupEvidence(value) {
  const validationCopy = structuredClone(value);
  if (!SHA256.test(validationCopy?.inventory?.canonicalSha256 ?? "")) fail();
  validationCopy.inventory.canonicalSha256 = sha256(Buffer.from(canonicalJson({
    entries: validationCopy.inventory.entries,
    objectCount: validationCopy.inventory.objectCount,
    totalBytes: validationCopy.inventory.totalBytes,
  }), "utf8"));
  BackupEvidenceV1Schema.parse(validationCopy);
  return structuredClone(value);
}

async function validateOutputRoot(outputDirectory, requireFinalAbsent) {
  if (
    typeof outputDirectory !== "string" || !isAbsolute(outputDirectory) ||
    outputDirectory.includes("\0")
  ) fail();
  const metadata = await lstat(outputDirectory);
  if (
    !metadata.isDirectory() || metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700
  ) fail();
  if (requireFinalAbsent) {
    try {
      await lstat(join(outputDirectory, RECOVERY_EVIDENCE_DIRECTORY_NAME));
      fail();
    } catch (cause) {
      if (cause?.message === HANDOFF_ERROR || cause?.code !== "ENOENT") throw cause;
    }
  }
}

export async function validateRecoveryEvidenceOutputDirectory({ outputDirectory } = {}) {
  try {
    await validateOutputRoot(outputDirectory, true);
    return outputDirectory;
  } catch (cause) {
    if (cause?.message === HANDOFF_ERROR) throw cause;
    fail();
  }
}

function deriveRestoreEvidence({
  backup,
  backupSha256,
  pitrVerify,
  directRecoveryState,
  targetTime,
  timeline,
  sourceVolumeIdentitySha256,
  restoreVolumeIdentitySha256,
  startedAt,
  completedAt,
}) {
  if (
    !exactObject(pitrVerify, [
      "pgIsInRecovery", "pgIsWalReplayPaused", "systemIdentifier",
      "expectedSystemIdentifier", "schemaVersion", "migrationChecksumCount",
      "beforeCutCount", "afterCutCount", "inventorySha256",
      "expectedInventorySha256",
    ]) ||
    pitrVerify.pgIsInRecovery !== "t" || directRecoveryState !== "t" ||
    pitrVerify.pgIsWalReplayPaused !== "t" ||
    pitrVerify.systemIdentifier !== backup.database.systemIdentifier ||
    pitrVerify.expectedSystemIdentifier !== backup.database.systemIdentifier ||
    pitrVerify.schemaVersion !== "10" ||
    pitrVerify.migrationChecksumCount !== "10" ||
    pitrVerify.beforeCutCount !== "1" || pitrVerify.afterCutCount !== "0" ||
    pitrVerify.inventorySha256 !== backup.inventory.canonicalSha256 ||
    pitrVerify.expectedInventorySha256 !== backup.inventory.canonicalSha256 ||
    !SHA256.test(sourceVolumeIdentitySha256 ?? "") ||
    !SHA256.test(restoreVolumeIdentitySha256 ?? "")
  ) fail();
  return RestoreDrillEvidenceV1Schema.parse({
    version: "1",
    kind: "pitr-restore-drill",
    producer: backup.producer,
    sourceBackupEvidenceSha256: backupSha256,
    target: { targetTime, inclusive: true, timeline },
    restore: {
      sourceVolumeIdentitySha256,
      restoreVolumeIdentitySha256,
      paused: true,
      inRecovery: true,
      promoted: false,
    },
    checks: {
      systemIdentifierMatches: true,
      schemaVersion: 10,
      migrationChecksums: 10,
      beforeCutPresent: true,
      afterCutAbsent: true,
      inventorySha256Matches: true,
    },
    startedAt,
    completedAt,
    status: "passed",
  });
}

async function writeExactFile(path, bytes, maximumBytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximumBytes) fail();
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const metadata = await lstat(path);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600
  ) fail();
}

function boundedStageRoot(outputDirectory, stageRoot) {
  if (typeof stageRoot !== "string" || !isAbsolute(stageRoot)) fail();
  const relativePath = relative(outputDirectory, stageRoot);
  if (
    relativePath === "" || relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    !/^\.recovery-evidence\.[a-f0-9]{32}\.staging$/.test(relativePath)
  ) fail();
}

export async function stageRecoveryEvidenceHandoff({
  outputDirectory,
  producerIdentity,
  backupEvidence,
  pitrVerify,
  directRecoveryState,
  targetTime,
  timeline,
  sourceVolumeIdentitySha256,
  restoreVolumeIdentitySha256,
  startedAt,
  completedAt,
} = {}) {
  let stageRoot;
  try {
    await validateOutputRoot(outputDirectory, true);
    const backup = parsePublicBackupEvidence(backupEvidence);
    validateProducerIdentity(producerIdentity, backup);
    const backupBytes = Buffer.from(canonicalJson(backup), "utf8");
    const backupSha256 = sha256(backupBytes);
    const restore = deriveRestoreEvidence({
      backup,
      backupSha256,
      pitrVerify,
      directRecoveryState,
      targetTime,
      timeline,
      sourceVolumeIdentitySha256,
      restoreVolumeIdentitySha256,
      startedAt,
      completedAt,
    });
    const restoreBytes = Buffer.from(canonicalSerializeRestoreDrillEvidence(restore), "utf8");
    const handoff = RecoveryEvidenceHandoffV1Schema.parse({
      version: "1",
      kind: "recovery-evidence-handoff",
      status: "passed",
      verification: producerIdentity.verification,
      releaseClaim: producerIdentity.releaseClaim,
      producer: backup.producer,
      backup: { filename: RECOVERY_EVIDENCE_FILENAMES.backup, sha256: backupSha256 },
      restore: {
        filename: RECOVERY_EVIDENCE_FILENAMES.restore,
        sha256: sha256(restoreBytes),
      },
    });
    const handoffBytes = Buffer.from(
      canonicalSerializeRecoveryEvidenceHandoff(handoff),
      "utf8",
    );
    stageRoot = join(
      outputDirectory,
      `.recovery-evidence.${randomBytes(16).toString("hex")}.staging`,
    );
    await mkdir(stageRoot, { mode: 0o700 });
    await writeExactFile(join(stageRoot, RECOVERY_EVIDENCE_FILENAMES.backup), backupBytes, MAXIMUM_FILE_BYTES.backup);
    await writeExactFile(join(stageRoot, RECOVERY_EVIDENCE_FILENAMES.restore), restoreBytes, MAXIMUM_FILE_BYTES.restore);
    await writeExactFile(join(stageRoot, RECOVERY_EVIDENCE_FILENAMES.handoff), handoffBytes, MAXIMUM_FILE_BYTES.handoff);
    return Object.freeze({
      stageRoot,
      producerIdentity: Object.freeze({ ...producerIdentity }),
      backup: Object.freeze({ filename: RECOVERY_EVIDENCE_FILENAMES.backup, sha256: backupSha256 }),
      restore: Object.freeze({ filename: RECOVERY_EVIDENCE_FILENAMES.restore, sha256: sha256(restoreBytes) }),
      handoff: Object.freeze({ filename: RECOVERY_EVIDENCE_FILENAMES.handoff, sha256: sha256(handoffBytes) }),
    });
  } catch (cause) {
    if (stageRoot) await rm(stageRoot, { recursive: true, force: true });
    if ([HANDOFF_ERROR, DRAFT_ERROR].includes(cause?.message)) throw cause;
    fail();
  }
}

async function readCanonicalStage(stagedEvidence) {
  const names = (await readdir(stagedEvidence.stageRoot)).sort();
  if (names.join("\0") !== Object.values(RECOVERY_EVIDENCE_FILENAMES).sort().join("\0")) fail();
  const backupBytes = await readFile(join(stagedEvidence.stageRoot, RECOVERY_EVIDENCE_FILENAMES.backup));
  const restoreBytes = await readFile(join(stagedEvidence.stageRoot, RECOVERY_EVIDENCE_FILENAMES.restore));
  const handoffBytes = await readFile(join(stagedEvidence.stageRoot, RECOVERY_EVIDENCE_FILENAMES.handoff));
  const backup = parsePublicBackupEvidence(JSON.parse(backupBytes.toString("utf8")));
  const restore = RestoreDrillEvidenceV1Schema.parse(JSON.parse(restoreBytes.toString("utf8")));
  const handoff = RecoveryEvidenceHandoffV1Schema.parse(JSON.parse(handoffBytes.toString("utf8")));
  if (
    backupBytes.toString("utf8") !== canonicalJson(backup) ||
    restoreBytes.toString("utf8") !== canonicalSerializeRestoreDrillEvidence(restore) ||
    handoffBytes.toString("utf8") !== canonicalSerializeRecoveryEvidenceHandoff(handoff) ||
    handoff.backup.sha256 !== sha256(backupBytes) ||
    handoff.restore.sha256 !== sha256(restoreBytes) ||
    restore.sourceBackupEvidenceSha256 !== sha256(backupBytes) ||
    stagedEvidence.handoff.sha256 !== sha256(handoffBytes)
  ) fail();
  for (const filename of names) {
    const metadata = await lstat(join(stagedEvidence.stageRoot, filename));
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail();
  }
  return { handoff, handoffBytes };
}

export async function publishRecoveryEvidenceHandoff({
  outputDirectory,
  stagedEvidence,
  finalProducerIdentity,
} = {}) {
  try {
    await validateOutputRoot(outputDirectory, true);
    boundedStageRoot(outputDirectory, stagedEvidence?.stageRoot);
    const stageMetadata = await lstat(stagedEvidence.stageRoot);
    if (!stageMetadata.isDirectory() || stageMetadata.isSymbolicLink() || (stageMetadata.mode & 0o777) !== 0o700) fail();
    if (
      stagedEvidence.producerIdentity?.verification !== "verified" ||
      stagedEvidence.producerIdentity?.releaseClaim !== true ||
      finalProducerIdentity?.verification !== "verified" ||
      finalProducerIdentity?.releaseClaim !== true
    ) fail(DRAFT_ERROR);
    if (JSON.stringify(stagedEvidence.producerIdentity) !== JSON.stringify(finalProducerIdentity)) fail();
    const { handoff, handoffBytes } = await readCanonicalStage(stagedEvidence);
    if (handoff.verification !== "verified" || handoff.releaseClaim !== true) fail(DRAFT_ERROR);
    await rename(
      stagedEvidence.stageRoot,
      join(outputDirectory, RECOVERY_EVIDENCE_DIRECTORY_NAME),
    );
    return Object.freeze({
      ...handoff,
      handoff: Object.freeze({
        filename: RECOVERY_EVIDENCE_FILENAMES.handoff,
        sha256: checksumRecoveryEvidenceHandoff(handoff),
      }),
    });
  } catch (cause) {
    if ([HANDOFF_ERROR, DRAFT_ERROR].includes(cause?.message)) throw cause;
    fail();
  }
}

export async function discardRecoveryEvidenceHandoff({
  outputDirectory,
  stagedEvidence,
} = {}) {
  await validateOutputRoot(outputDirectory, false);
  if (stagedEvidence?.stageRoot) {
    boundedStageRoot(outputDirectory, stagedEvidence.stageRoot);
    await rm(stagedEvidence.stageRoot, { recursive: true, force: true });
  }
  await rm(join(outputDirectory, RECOVERY_EVIDENCE_DIRECTORY_NAME), {
    recursive: true,
    force: true,
  });
}

export async function cleanupRecoveryEvidenceHandoff({ outputDirectory } = {}) {
  try {
    await validateOutputRoot(outputDirectory, false);
    const finalDirectory = join(outputDirectory, RECOVERY_EVIDENCE_DIRECTORY_NAME);
    try {
      const metadata = await lstat(finalDirectory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail();
    } catch (cause) {
      if (cause?.code === "ENOENT") return;
      throw cause;
    }
    await rm(finalDirectory, { recursive: true, force: false });
  } catch (cause) {
    if (cause?.message === HANDOFF_ERROR) throw cause;
    fail();
  }
}
