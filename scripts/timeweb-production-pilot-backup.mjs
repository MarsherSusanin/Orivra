import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, link, lstat, open, rm } from "node:fs/promises";
import { authorizeBackupRetention } from "./backup-retention-authorization.mjs";
import { parseCanonicalBackupEvidence, sha256 } from "./backup-evidence-validation.mjs";
import { createCanonicalTimewebBackupEvidence } from "./timeweb-production-backup-evidence.mjs";
import { runSelectedTimewebProductionPitr, switchAndObserveProductionWalArchive } from "./timeweb-production-pitr.mjs";
import { bindFixedReplayBootstrapComposeInterpolationEnvironment } from "./timeweb-production-compose-environment.mjs";
import { validateTimewebProductionSecretInventory } from "./timeweb-production-secret-inventory.mjs";

const ROOT = "/opt/orivra/current";
const SELECTED = "/opt/orivra/evidence/recovery/backup-evidence.v1.json";
const FILES = ["compose.yaml", "deploy/compose.runtime.yaml", "deploy/compose.backup.yaml"];
const BACKUP_ID = /^base_[0-9A-F]{24}$/;
const WAL = /^[0-9A-F]{24}$/;

function failure(cause) {
  return Object.assign(new Error("TIMEWEB_PILOT_BACKUP_INVALID: Timeweb pilot backup is invalid"), {
    code: "TIMEWEB_PILOT_BACKUP_INVALID",
    cause,
  });
}

function compose(args, environment, maximum = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const command = ["compose"];
    for (const path of FILES) command.push("--file", `${ROOT}/${path}`);
    command.push("--project-name", "proofline-production-primary", ...args);
    const child = spawn("/usr/bin/docker", command, {
      cwd: ROOT,
      env: bindFixedReplayBootstrapComposeInterpolationEnvironment({
        ...environment, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC",
      }),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const output = [];
    let size = 0;
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > maximum) child.kill("SIGKILL");
      else target?.push(chunk);
    };
    child.stdout.on("data", collect(output));
    child.stderr.on("data", collect());
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 && !signal && size <= maximum
      ? resolve(Buffer.concat(output).toString("utf8"))
      : reject(new Error("backup command")));
  });
}

export async function loadTimewebProductionRuntimeEnvironment() {
  let handle;
  try {
    handle = await open("/opt/orivra/runtime.env", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 1 || stat.size > 64 * 1024) throw new Error("runtime environment");
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error("runtime environment");
    const result = {};
    for (const line of new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 1 || !/^[A-Z][A-Z0-9_]*$/.test(line.slice(0, index)) || line.slice(index + 1).includes("\0")) throw new Error("runtime environment");
      result[line.slice(0, index)] = line.slice(index + 1);
    }
    await validateTimewebProductionSecretInventory({ environment: result });
    return Object.freeze({ ...process.env, ...result });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function createTimewebPilotBackup({ environment } = {}) {
  try {
    environment ??= await loadTimewebProductionRuntimeEnvironment();
    await validateTimewebProductionSecretInventory({ environment });
    await compose(["run", "--rm", "--no-deps", "base-backup"], environment);
    const rows = JSON.parse(await compose(["run", "--rm", "--no-deps", "backup-status"], environment));
    const backupId = Array.isArray(rows) ? rows.at(-1)?.backup_name : undefined;
    if (!BACKUP_ID.test(backupId ?? "")) throw new Error("backup id");
    const archive = await switchAndObserveProductionWalArchive({ environment });
    if (archive?.status !== "passed" || !WAL.test(archive.switchedWalSegment ?? "") ||
      !Number.isSafeInteger(archive.archivePendingAgeSeconds) || archive.archivePendingAgeSeconds < 0 ||
      archive.archivePendingAgeSeconds > 60) throw new Error("archive");
    return Object.freeze({ status: "passed", backupId, archive });
  } catch (cause) {
    throw failure(cause);
  }
}

async function publishSelected(bytes) {
  await lstat(SELECTED).then(
    () => { throw new Error("selected backup exists"); },
    (cause) => { if (cause?.code !== "ENOENT") throw cause; },
  );
  const stage = `${SELECTED}.stage-${process.pid}`;
  let staged = false;
  try {
    const handle = await open(stage, "wx", 0o600);
    staged = true;
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await chmod(stage, 0o400);
    await link(stage, SELECTED);
  } finally {
    if (staged) await rm(stage, { force: true });
  }
}

export async function sealTimewebPilotBackupEvidence({ backupId, archive, environment } = {}) {
  try {
    if (!BACKUP_ID.test(backupId ?? "") || archive?.status !== "passed" || !WAL.test(archive.switchedWalSegment ?? "")) throw new Error("authority");
    environment ??= await loadTimewebProductionRuntimeEnvironment();
    const result = await createCanonicalTimewebBackupEvidence({ backupId, archive, environment });
    await publishSelected(result.bytes);
    return Object.freeze({ status: "passed", backupId, backupEvidenceSha256: result.sha256,
      archivePendingAgeSeconds: archive.archivePendingAgeSeconds, selectedPath: SELECTED });
  } catch (cause) {
    throw failure(cause);
  }
}

async function privateBytes(path, maximum = 4096) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 1 || stat.size > maximum) throw new Error("private file");
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error("private file");
    return bytes;
  } finally { await handle?.close().catch(() => undefined); }
}

export async function observeSealedTimewebPilotBackup({ backupEvidenceSha256, archivePendingAgeSeconds } = {}) {
  try {
    const bytes = await privateBytes(SELECTED, 1024 * 1024);
    const evidence = parseCanonicalBackupEvidence(bytes);
    if (sha256(bytes) !== backupEvidenceSha256 || evidence.database.slot !== "production" ||
      !Number.isSafeInteger(archivePendingAgeSeconds) || archivePendingAgeSeconds < 0 || archivePendingAgeSeconds > 60) throw new Error("binding");
    return Object.freeze({ status: "passed", backupId: evidence.backup.id, backupEvidenceSha256,
      archivePendingAgeSeconds, switchedWalArchived: true });
  } catch (cause) { throw failure(cause); }
}

export async function restoreSelectedTimewebPilotBackup({ productionRunId, backupEvidenceSha256, archivePendingAgeSeconds } = {}) {
  try {
    const environment = await loadTimewebProductionRuntimeEnvironment();
    const bytes = await privateBytes(SELECTED, 1024 * 1024);
    if (sha256(bytes) !== backupEvidenceSha256) throw new Error("binding");
    return await runSelectedTimewebProductionPitr({ productionRunId, backupEvidenceBytes: bytes, archivePendingAgeSeconds, environment });
  } catch (cause) { throw failure(cause); }
}

export async function retainAuthorizedTimewebPilotBackups({ backupEvidenceSha256, environment } = {}) {
  let evidenceBytes;
  let encryptionKeyBytes;
  try {
    environment ??= await loadTimewebProductionRuntimeEnvironment();
    await validateTimewebProductionSecretInventory({ environment });
    evidenceBytes = await privateBytes(SELECTED, 1024 * 1024);
    encryptionKeyBytes = await privateBytes(environment.PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE);
    const evidence = parseCanonicalBackupEvidence(evidenceBytes);
    authorizeBackupRetention({ backupEvidenceBytes: evidenceBytes, expectedBackupEvidenceSha256: backupEvidenceSha256,
      expectedPrefix: evidence.storage.prefix, encryptionKeyBytes });
    await compose(["run", "--rm", "--no-deps", "backup-retention"], {
      ...environment,
      PROOFLINE_BACKUP_EVIDENCE_FILE: SELECTED,
      PROOFLINE_BACKUP_EVIDENCE_SHA256: backupEvidenceSha256,
    });
    return Object.freeze({ status: "passed", retainedFull: 8, backupId: evidence.backup.id });
  } catch (cause) { throw failure(cause); }
  finally { evidenceBytes?.fill(0); encryptionKeyBytes?.fill(0); }
}
