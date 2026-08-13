import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { selectRecoveryBackupMetadata } from "./recovery-selected-backup-metadata.mjs";
import { parseCanonicalBackupEvidence } from "./backup-evidence-validation.mjs";
import { bindFixedReplayBootstrapComposeInterpolationEnvironment } from "./timeweb-production-compose-environment.mjs";
import { validateTimewebProductionSecretInventory } from "./timeweb-production-secret-inventory.mjs";

const RUN_ID = /^prod_[0-9A-Z]{26}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BASE_BACKUP = /^base_[0-9A-Z]{16,64}$/;
const ROOT = "/opt/orivra/current";
const PROJECT = "proofline-production-primary";
const FILES = ["compose.yaml", "deploy/compose.runtime.yaml", "deploy/compose.backup.yaml"];
const RECOVERY_FILE = "deploy/compose.production-recovery.yaml";
const WAL_SEGMENT = /^[0-9A-F]{24}$/;
const MAXIMUM_ARCHIVE_PENDING_SECONDS = 60;

function failure(cause) {
  return Object.assign(new Error("TIMEWEB_PRODUCTION_PITR_INVALID: Timeweb production PITR is invalid"), {
    code: "TIMEWEB_PRODUCTION_PITR_INVALID",
    cause,
  });
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function runDocker(arguments_, maximum = 1024 * 1024, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/docker", arguments_, {
      cwd: ROOT,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const stdout = []; let size = 0;
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); else stdout.push(chunk); });
    child.stderr.on("data", (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); });
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 && !signal && size <= maximum
      ? resolve(Buffer.concat(stdout).toString("utf8"))
      : reject(new Error("docker")));
  });
}

function compose(action, environment = {}, recovery = false) {
  const args = ["compose"];
  for (const file of FILES) args.push("--file", `${ROOT}/${file}`);
  if (recovery) args.push("--file", `${ROOT}/${RECOVERY_FILE}`);
  args.push("--project-name", PROJECT, ...action);
  const inherited = { ...process.env, ...environment };
  return runDocker(args, 1024 * 1024,
    bindFixedReplayBootstrapComposeInterpolationEnvironment(inherited));
}

function utcSeconds(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("timestamp");
  return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, ".000000Z");
}

async function switchProductionWal(environment = {}) {
  const switchedAt = Date.now();
  const switchedWalSegment = (await compose([
    "exec", "-T", "postgres", "psql", "-U", "proofline", "-d", "proofline",
    "-Atc", "SELECT pg_walfile_name(pg_switch_wal())",
  ], environment)).trim();
  if (!WAL_SEGMENT.test(switchedWalSegment)) throw new Error("wal switch");
  return { status: "passed", switchedWalSegment, switchedAt };
}

async function observeProductionWalArchived({ switchedWalSegment, switchedAt }, environment = {}) {
  if (!WAL_SEGMENT.test(switchedWalSegment ?? "") || !Number.isFinite(switchedAt)) {
    throw new Error("archive observation input");
  }
  for (;;) {
    const elapsedSeconds = Math.floor((Date.now() - switchedAt) / 1000);
    if (elapsedSeconds > MAXIMUM_ARCHIVE_PENDING_SECONDS) throw new Error("archive freshness");
    const output = (await compose([
      "exec", "-T", "postgres", "psql", "-U", "proofline", "-d", "proofline", "-Atc",
      "SELECT coalesce(last_archived_wal, ''), coalesce(to_char(last_archived_time AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'), '') FROM pg_stat_archiver",
    ], environment)).trim();
    const [lastArchivedWal = "", archivedAt = ""] = output.split("|");
    if (lastArchivedWal === switchedWalSegment && Number.isFinite(Date.parse(archivedAt))) {
      return {
        status: "passed",
        switchedWalSegment,
        archivedAt: utcSeconds(archivedAt),
        archivePendingAgeSeconds: elapsedSeconds,
        source: "postgres-archive-status",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

export async function switchAndObserveProductionWalArchive({
  environment = process.env,
  validateSecretInventory = validateTimewebProductionSecretInventory,
  switchWal = switchProductionWal,
  observeWal = observeProductionWalArchived,
} = {}) {
  const effectEnvironment = Object.freeze({ ...environment });
  await validateSecretInventory({ environment: effectEnvironment });
  const switched = await switchWal(effectEnvironment);
  return observeWal(switched, effectEnvironment);
}

async function defaultPhaseRunner(input) {
  const volumeId = `proofline-pitr-${input.productionRunId}`;
  if (input.phase === "create-base-backup") {
    await compose(["run", "--rm", "--no-deps", "base-backup"], input.environment);
    return { status: "passed" };
  }
  if (input.phase === "switch-wal-after-backup") {
    return switchProductionWal(input.environment);
  }
  if (input.phase === "observe-switched-wal-archived") {
    return observeProductionWalArchived(input.switched, input.environment);
  }
  if (input.phase === "select-backup") {
    return Promise.all([
      compose(["run", "--rm", "--no-deps", "backup-status"], input.environment),
      compose(["exec", "-T", "postgres", "psql", "-U", "proofline", "-d", "proofline", "-Atc", "SELECT system_identifier FROM pg_control_system()"], input.environment),
      compose(["exec", "-T", "postgres", "psql", "-U", "proofline", "-d", "proofline", "-Atc", "SELECT coalesce(to_char(last_archived_time AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'), '') FROM pg_stat_archiver"], input.environment),
    ]).then(([detailText, systemText, archivedText]) => {
      const backupIds = [...detailText.matchAll(/"backup_name"\s*:\s*"(base_[0-9A-F]{24})"/g)].map((match) => match[1]);
      const backupId = backupIds.at(-1);
      const systemIdentifier = systemText.trim();
      const lastArchivedAt = archivedText.trim();
      if (!backupId || !/^[1-9][0-9]*$/.test(systemIdentifier) || !Number.isFinite(Date.parse(lastArchivedAt))) throw new Error("backup metadata");
      const metadata = selectRecoveryBackupMetadata({ backupListDetailBytes: Buffer.from(detailText), selectedBackupId: backupId,
        expectedSystemIdentifier: systemIdentifier, postgresMajor: 17, walSegmentBytes: 16 * 1024 * 1024 });
      return { status: "passed", backupId, encrypted: true, backupCompletedAt: metadata.completedAt,
        lastArchivedAt: utcSeconds(lastArchivedAt), systemIdentifier, timeline: metadata.timeline };
    });
  }
  if (input.phase === "create-fresh-volume") {
    return runDocker(["volume", "inspect", volumeId], 64 * 1024, input.environment).then(
      () => { throw new Error("restore volume exists"); },
      () => runDocker(["volume", "create", "--label", "com.orivra.scope=production-pitr", volumeId], 64 * 1024, input.environment).then(() => ({ status: "passed", volumeId, wasAbsent: true })),
    );
  }
  const recoveryEnvironment = {
    ...input.environment,
    PROOFLINE_PITR_VOLUME_NAME: volumeId,
    PROOFLINE_RESTORE_BACKUP_ID: input.selected?.backupId ?? "",
    PROOFLINE_BACKUP_SYSTEM_IDENTIFIER: input.selected?.systemIdentifier ?? "",
    PROOFLINE_RECOVERY_TARGET_TIME: input.selected?.backupCompletedAt ?? "",
    PROOFLINE_RECOVERY_TARGET_TIMELINE: String(input.selected?.timeline ?? ""),
  };
  if (input.phase === "restore-selected-backup") {
    return compose(["--profile", "production-recovery", "run", "--rm", "--no-deps", "pitr-restore"], recoveryEnvironment, true)
      .then(() => ({ status: "passed", backupId: input.selected.backupId, volumeId }));
  }
  if (input.phase === "verify-restored-database") {
    return compose(["--profile", "production-recovery", "up", "--detach", "--no-build", "--pull", "never", "--wait", "pitr-postgres"], recoveryEnvironment, true)
      .then(() => compose(["--profile", "production-recovery", "run", "--rm", "--no-deps", "pitr-verify"], recoveryEnvironment, true))
      .then((text) => {
        const value = JSON.parse(text.trim());
        if (value?.status !== "passed" || value.schemaVersion !== 10 || value.pgIsInRecovery !== true || value.systemIdentifier !== input.selected.systemIdentifier) throw new Error("restore verification");
        return { status: "passed", restoreEvidenceSha256: `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`, schemaVersion: 10 };
      });
  }
  if (input.phase === "remove-fresh-volume") {
    return compose(["--profile", "production-recovery", "rm", "--stop", "--force", "pitr-verify", "pitr-postgres", "pitr-restore"], recoveryEnvironment, true)
      .catch(() => undefined)
      .then(() => runDocker(["volume", "rm", "--force", volumeId], 64 * 1024, input.environment).catch(() => undefined))
      .then(() => ({ status: "passed", removed: true }));
  }
  throw new Error("phase");
}

export async function runDefaultTimewebProductionPitr({
  productionRunId,
  runner = defaultPhaseRunner,
  clock = { now: () => new Date().toISOString() },
  environment = process.env,
  validateSecretInventory = validateTimewebProductionSecretInventory,
}) {
  let volumeCreated = false;
  let selected;
  let effectEnvironment;
  try {
    if (!RUN_ID.test(productionRunId ?? "")) throw new Error("run id");
    effectEnvironment = Object.freeze({ ...environment });
    await validateSecretInventory({ environment: effectEnvironment });
    const authority = { productionRunId, provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet", pathStyle: true };
    await runner({ ...authority, phase: "create-base-backup", environment: effectEnvironment });
    const switched = await runner({ ...authority, phase: "switch-wal-after-backup", environment: effectEnvironment });
    if (switched?.status !== "passed" || !WAL_SEGMENT.test(switched.switchedWalSegment ?? "")) {
      throw new Error("archive observation");
    }
    const archive = await runner({ ...authority, phase: "observe-switched-wal-archived", switched, environment: effectEnvironment });
    if (archive?.status !== "passed" || archive.source !== "postgres-archive-status" ||
      archive.switchedWalSegment !== switched.switchedWalSegment ||
      !Number.isSafeInteger(archive.archivePendingAgeSeconds) || archive.archivePendingAgeSeconds < 0 ||
      archive.archivePendingAgeSeconds > MAXIMUM_ARCHIVE_PENDING_SECONDS) {
      throw new Error("archive freshness");
    }
    selected = await runner({ ...authority, phase: "select-backup", archive, environment: effectEnvironment });
    if (selected?.status !== "passed" || !BASE_BACKUP.test(selected.backupId ?? "") || selected.encrypted !== true ||
      !Number.isFinite(Date.parse(selected.backupCompletedAt)) || !Number.isFinite(Date.parse(selected.lastArchivedAt)) ||
      !Number.isSafeInteger(selected.timeline) || selected.timeline < 1 || !/^[1-9][0-9]*$/.test(selected.systemIdentifier ?? "")) throw new Error("selected backup");
    const created = await runner({ ...authority, phase: "create-fresh-volume", selected, environment: effectEnvironment });
    if (created?.status !== "passed" || created.wasAbsent !== true || created.volumeId !== `proofline-pitr-${productionRunId}`) throw new Error("fresh volume");
    volumeCreated = true;
    const restored = await runner({ ...authority, phase: "restore-selected-backup", selected, volumeId: created.volumeId, environment: effectEnvironment });
    if (restored?.status !== "passed" || restored.backupId !== selected.backupId || restored.volumeId !== created.volumeId) throw new Error("restore");
    const verified = await runner({ ...authority, phase: "verify-restored-database", selected, volumeId: created.volumeId, environment: effectEnvironment });
    if (verified?.status !== "passed" || verified.schemaVersion !== 10 || !SHA256.test(verified.restoreEvidenceSha256 ?? "")) throw new Error("verify");
    const now = Date.parse(clock.now());
    const backupAt = Date.parse(selected.backupCompletedAt);
    const archivedAt = Date.parse(selected.lastArchivedAt);
    if (!Number.isFinite(now) || now < backupAt || now < archivedAt) throw new Error("clock");
    return Object.freeze({ status: "passed", provider: authority.provider, endpoint: authority.endpoint, region: authority.region,
      bucket: authority.bucket, pathStyle: true, baseBackupId: selected.backupId, restoreVolumeId: created.volumeId,
      volumeWasFresh: true, restoreEvidenceSha256: verified.restoreEvidenceSha256,
      backupAgeSeconds: Math.floor((now - backupAt) / 1000), archivePendingAgeSeconds: archive.archivePendingAgeSeconds });
  } catch (cause) {
    throw Object.assign(new Error("TIMEWEB_PRODUCTION_PITR_FAILED: Timeweb production PITR failed"), { code: "TIMEWEB_PRODUCTION_PITR_FAILED", cause });
  } finally {
    if (volumeCreated) await runner({ productionRunId, provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet", pathStyle: true, phase: "remove-fresh-volume", selected, environment: effectEnvironment }).catch(() => undefined);
  }
}

export async function runSelectedTimewebProductionPitr({
  productionRunId,
  backupEvidenceBytes,
  archivePendingAgeSeconds,
  runner = defaultPhaseRunner,
  clock = { now: () => new Date().toISOString() },
  environment = process.env,
  validateSecretInventory = validateTimewebProductionSecretInventory,
} = {}) {
  let volumeCreated = false;
  let selected;
  let effectEnvironment;
  try {
    if (!RUN_ID.test(productionRunId ?? "") || !Buffer.isBuffer(backupEvidenceBytes) ||
      !Number.isSafeInteger(archivePendingAgeSeconds) || archivePendingAgeSeconds < 0 ||
      archivePendingAgeSeconds > MAXIMUM_ARCHIVE_PENDING_SECONDS) throw new Error("authority");
    effectEnvironment = Object.freeze({ ...environment });
    await validateSecretInventory({ environment: effectEnvironment });
    const evidence = parseCanonicalBackupEvidence(backupEvidenceBytes);
    if (evidence.database.slot !== "production" || evidence.storage.provider !== "timeweb-s3" ||
      evidence.storage.endpointOrigin !== "https://s3.twcstorage.ru" || evidence.storage.region !== "ru-1" ||
      evidence.storage.bucket !== "orivra-backet" || evidence.storage.addressing !== "path-style" ||
      evidence.storage.authorityMode !== "shared-pilot") throw new Error("storage authority");
    selected = Object.freeze({
      status: "passed",
      backupId: evidence.backup.id,
      encrypted: true,
      backupCompletedAt: evidence.backup.completedAt,
      lastArchivedAt: evidence.backup.completedAt,
      systemIdentifier: evidence.database.systemIdentifier,
      timeline: evidence.backup.timeline,
    });
    const authority = { productionRunId, provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet", pathStyle: true };
    const created = await runner({ ...authority, phase: "create-fresh-volume", selected, environment: effectEnvironment });
    if (created?.status !== "passed" || created.wasAbsent !== true || created.volumeId !== `proofline-pitr-${productionRunId}`) throw new Error("fresh volume");
    volumeCreated = true;
    const restored = await runner({ ...authority, phase: "restore-selected-backup", selected, volumeId: created.volumeId, environment: effectEnvironment });
    if (restored?.status !== "passed" || restored.backupId !== selected.backupId || restored.volumeId !== created.volumeId) throw new Error("restore");
    const verified = await runner({ ...authority, phase: "verify-restored-database", selected, volumeId: created.volumeId, environment: effectEnvironment });
    if (verified?.status !== "passed" || verified.schemaVersion !== 10 || !SHA256.test(verified.restoreEvidenceSha256 ?? "")) throw new Error("verify");
    const age = Math.floor((Date.parse(clock.now()) - Date.parse(selected.backupCompletedAt)) / 1000);
    if (!Number.isSafeInteger(age) || age < 0) throw new Error("clock");
    return Object.freeze({
      status: "passed", provider: authority.provider, endpoint: authority.endpoint, region: authority.region,
      bucket: authority.bucket, pathStyle: true, baseBackupId: selected.backupId,
      restoreVolumeId: created.volumeId, volumeWasFresh: true,
      restoreEvidenceSha256: verified.restoreEvidenceSha256,
      backupAgeSeconds: age, archivePendingAgeSeconds,
    });
  } catch (cause) {
    throw Object.assign(new Error("TIMEWEB_PRODUCTION_PITR_FAILED: Timeweb production PITR failed"), { code: "TIMEWEB_PRODUCTION_PITR_FAILED", cause });
  } finally {
    if (volumeCreated) await runner({ productionRunId, provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet", pathStyle: true, phase: "remove-fresh-volume", selected, environment: effectEnvironment }).catch(() => undefined);
  }
}

function defaultAdapters() {
  return {
    async createBaseBackup() {
      await compose(["run", "--rm", "--no-deps", "base-backup"]);
      const statusText = await compose(["run", "--rm", "--no-deps", "backup-status"]);
      const rows = JSON.parse(statusText);
      const latest = Array.isArray(rows) ? rows.at(-1) : undefined;
      if (!BASE_BACKUP.test(latest?.backup_name ?? "")) throw new Error("backup metadata");
      const completed = Date.parse(latest.finish_time ?? latest.time ?? "");
      if (!Number.isFinite(completed)) throw new Error("backup time");
      return {
        status: "passed",
        baseBackupId: latest.backup_name,
        backupAgeSeconds: Math.max(0, Math.floor((Date.now() - completed) / 1000)),
        archivePendingAgeSeconds: 0,
      };
    },
    async restoreFreshVolume({ runId }) {
      const restoreProject = `proofline-production-pitr-${runId.toLowerCase()}`;
      const restoreVolumeId = `${restoreProject}_pitr_postgres_data`;
      const output = await runDocker(["volume", "inspect", restoreVolumeId], 64 * 1024).then(() => "present", () => "absent");
      if (output !== "absent") throw new Error("restore volume exists");
      throw new Error("Production Timeweb restore adapter requires selected-backup evidence before execution");
    },
  };
}

export async function runTimewebProductionPitr({ runId, adapters }) {
  try {
    if (!RUN_ID.test(runId ?? "")) throw new Error("run id");
    if (!adapters) {
      return await runDefaultTimewebProductionPitr({ productionRunId: runId, environment: process.env });
    }
    adapters ??= defaultAdapters();
    const authority = { provider: "timeweb-s3", endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet", pathStyle: true, runId };
    const backup = await adapters.createBaseBackup(authority);
    if (backup?.status !== "passed" || !BASE_BACKUP.test(backup.baseBackupId ?? "") ||
      !Number.isSafeInteger(backup.backupAgeSeconds) || backup.backupAgeSeconds < 0 ||
      !Number.isSafeInteger(backup.archivePendingAgeSeconds) || backup.archivePendingAgeSeconds < 0 ||
      backup.archivePendingAgeSeconds > MAXIMUM_ARCHIVE_PENDING_SECONDS) throw new Error("backup");
    const restored = await adapters.restoreFreshVolume({ ...authority, baseBackupId: backup.baseBackupId, restoreVolumePolicy: "fresh-only", productionVolumeReuse: false });
    if (restored?.status !== "passed" || restored.volumeWasFresh !== true || !SHA256.test(restored.restoreEvidenceSha256 ?? "") ||
      restored.restoreVolumeId !== `proofline-pitr-${runId}`) throw new Error("restore");
    return Object.freeze({ status: "passed", provider: authority.provider, endpoint: authority.endpoint, region: authority.region,
      bucket: authority.bucket, pathStyle: true, baseBackupId: backup.baseBackupId, restoreVolumeId: restored.restoreVolumeId,
      volumeWasFresh: true, restoreEvidenceSha256: restored.restoreEvidenceSha256,
      backupAgeSeconds: backup.backupAgeSeconds, archivePendingAgeSeconds: backup.archivePendingAgeSeconds });
  } catch (cause) { throw failure(cause); }
}

export async function runTimewebProductionPitrCli({ argv = process.argv.slice(2), stdout = process.stdout, runPitr = runTimewebProductionPitr } = {}) {
  if (argv.length !== 2 || argv[0] !== "--run-id") throw failure(new Error("arguments"));
  const result = await runPitr({ runId: argv[1] });
  stdout.write(`${canonicalJson(result)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runTimewebProductionPitrCli();
