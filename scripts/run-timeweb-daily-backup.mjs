import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { authorizeBackupRetention } from "./backup-retention-authorization.mjs";
import { parseCanonicalBackupEvidence } from "./backup-evidence-validation.mjs";
import { runTimewebProductionDailyBackup } from "./timeweb-production-daily-backup.mjs";
import { createCanonicalTimewebBackupEvidence } from "./timeweb-production-backup-evidence.mjs";
import { switchAndObserveProductionWalArchive } from "./timeweb-production-pitr.mjs";

const ROOT = "/opt/orivra/current";
const FILES = ["compose.yaml", "deploy/compose.runtime.yaml", "deploy/compose.backup.yaml"];
const COMPLETE = "passed";
// The authorized container wrapper executes: wal-g delete retain FULL 8 --confirm.

function compose(args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const command = ["compose"];
    for (const path of FILES) command.push("--file", `${ROOT}/${path}`);
    command.push("--project-name", "proofline-production-primary", ...args);
    const child = spawn("/usr/bin/docker", command, { cwd: ROOT, env: { ...environment, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let size = 0; const output = [];
    const collect = (chunk) => { size += chunk.length; if (size > 4 * 1024 * 1024) child.kill("SIGKILL"); else output.push(chunk); };
    child.stdout.on("data", collect); child.stderr.on("data", (chunk) => { size += chunk.length; if (size > 4 * 1024 * 1024) child.kill("SIGKILL"); });
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 && !signal && size <= 4 * 1024 * 1024 ? resolve(Buffer.concat(output).toString("utf8")) : reject(new Error("backup command")));
  });
}

async function loadRuntimeEnvironment() {
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
    return Object.freeze({ ...process.env, ...result });
  } finally { await handle?.close().catch(() => undefined); }
}

export async function main() {
  const environment = await loadRuntimeEnvironment();
  let switched;
  return runTimewebProductionDailyBackup({
    clock: { now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
    createFullBackup: async () => {
      await compose(["run", "--rm", "--no-deps", "base-backup"], environment);
      const rows = JSON.parse(await compose(["run", "--rm", "--no-deps", "backup-status"], environment));
      const backupId = Array.isArray(rows) ? rows.at(-1)?.backup_name : undefined;
      return { status: COMPLETE, backupId };
    },
    switchWal: async () => {
      switched = await switchAndObserveProductionWalArchive({ environment });
      return { status: switched.status, walSegment: switched.switchedWalSegment };
    },
    observeArchive: async () => ({ ...switched, walSegment: switched.switchedWalSegment }),
    readCanonicalBackupEvidence: ({ backup, archive }) => createCanonicalTimewebBackupEvidence({ backupId: backup.backupId, archive, environment }),
    authorizeRetention: async ({ backupEvidenceBytes, backupEvidenceSha256 }) => {
      const evidence = parseCanonicalBackupEvidence(backupEvidenceBytes);
      const encryptionKeyBytes = await privateRuntimeBytes(environment.PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE);
      try {
        authorizeBackupRetention({ backupEvidenceBytes, expectedBackupEvidenceSha256: backupEvidenceSha256, expectedPrefix: `s3://orivra-backet/proofline/v1/production/${evidence.database.systemIdentifier}`, encryptionKeyBytes });
      } finally { encryptionKeyBytes.fill(0); }
      return { status: "authorized", retainFull: 8 };
    },
    runRetention: async ({ backupEvidenceSha256, backupEvidenceBytes }) => {
      const evidence = parseCanonicalBackupEvidence(backupEvidenceBytes);
      const path = `/opt/orivra/evidence/recovery/backups/${evidence.backup.id}.json`;
      await compose(["run", "--rm", "--no-deps", "backup-retention"], { ...environment, PROOFLINE_BACKUP_EVIDENCE_FILE: path, PROOFLINE_BACKUP_EVIDENCE_SHA256: backupEvidenceSha256 });
      return { status: COMPLETE };
    },
  });
}

async function privateRuntimeBytes(path) {
  let handle;
  try {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new Error("secret path");
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 1 || stat.size > 4096) throw new Error("secret");
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error("secret");
    return bytes;
  } finally { await handle?.close().catch(() => undefined); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch(() => { process.stderr.write("TIMEWEB_DAILY_BACKUP_INVALID\n"); process.exitCode = 64; });
}
