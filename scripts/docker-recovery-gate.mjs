import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  canonicalSerializeBackupEvidence,
} from "./backup-evidence-validation.mjs";
import {
  collectCiphertextInventory,
  verifyCiphertextInventory,
} from "./recovery-inventory.mjs";
import {
  deriveRestoreChecksFromPitrVerify,
  runRecoveryNegativeControls,
} from "./docker-recovery-gate-core.mjs";
import {
  createDockerRecoveryOrchestration,
  parsePitrVerifyOutput,
} from "./docker-recovery-gate-runtime.mjs";
import { createDockerRecoveryNegativeRuntime } from "./docker-recovery-negative-runtime.mjs";
import { createCredentialFreeRecoveryEnvironments } from "./recovery-gate-environment.mjs";
import { runBoundedRecoveryChild } from "./recovery-async-child.mjs";
import { finalizeRecoveryGate } from "./recovery-gate-lifecycle.mjs";
import { authorizeRestorePromotion } from "./restore-promotion.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPrefix = "proofline-027c-recovery";
const project = `${projectPrefix}-${process.pid}-${randomBytes(4).toString("hex")}`;
const timeoutMs = 15 * 60 * 1_000;
const negativeCaseTimeoutMs = 30_000;
const negativeCleanupTimeoutMs = 15_000;
const projectFinalizerTimeoutMs = 30_000;
const recoveryNegativeCaseIds = Object.freeze([
  "missing-wal-object",
  "corrupt-backup-object",
  "wrong-encryption-key",
  "future-recovery-target",
  "reused-restore-volume",
  "nonempty-restore-volume",
  "promotion-authorization-absent",
  "promotion-authorization-mismatch",
]);
const files = [
  "compose.yaml",
  "deploy/compose.runtime.yaml",
  "deploy/compose.backup.yaml",
  "deploy/compose.recovery.qa.yaml",
];

async function resolveComposeExecutable() {
  for (const candidate of [
    "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose",
    "/usr/local/lib/docker/cli-plugins/docker-compose",
    "/usr/libexec/docker/cli-plugins/docker-compose",
    "/usr/lib/docker/cli-plugins/docker-compose",
    "/opt/homebrew/lib/docker/cli-plugins/docker-compose",
  ]) {
    try {
      await access(candidate);
      return await realpath(candidate);
    } catch {}
  }
  throw new Error("Docker Compose plugin is unavailable");
}

const composeExecutable = await resolveComposeExecutable();

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function docker(args, environment, capture = false, allowFailure = false) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
    stdio: capture ? "pipe" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stderr.write(result.stdout.slice(-8192));
      if (result.stderr) process.stderr.write(result.stderr.slice(-8192));
    }
    throw new Error(`Recovery Docker command failed (${args.at(-1)})`);
  }
  return result;
}

function dockerBytes(args, environment, allowFailure = false, input) {
  const result = spawnSync("docker", args, {
    cwd: root,
    env: environment,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    input,
    stdio: "pipe",
  });
  if (!allowFailure && result.status !== 0) {
    if (result.stdout?.length) process.stderr.write(result.stdout.subarray(-8192));
    if (result.stderr?.length) process.stderr.write(result.stderr.subarray(-8192));
    throw new Error(`Recovery Docker command failed (${args.at(-1)})`);
  }
  return result;
}

async function asyncCommand(
  executable,
  args,
  environment,
  signal,
  deadline,
  allowFailure = false,
) {
  const remaining = Math.max(1, deadline - Date.now());
  const result = await runBoundedRecoveryChild({
    executable,
    args,
    cwd: root,
    environment,
    timeoutMs: remaining,
    killGraceMs: 1_000,
    maximumOutputBytes: 32 * 1024 * 1024,
    signal,
  });
  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`Recovery Docker command failed (${args.at(-1)})`);
  }
  return result;
}

async function finalizeRecoveryProject(environment, signal) {
  const deadline = Date.now() + projectFinalizerTimeoutMs;
  const composeCommand = ["--project-name", project];
  for (const file of files) composeCommand.push("--file", file);
  await asyncCommand(composeExecutable, [
    ...composeCommand,
    "down", "--volumes", "--remove-orphans",
  ], environment, signal, deadline, true);
  const leftovers = await Promise.all([
    asyncCommand("docker", [
      "ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`,
    ], environment, signal, deadline, true),
    asyncCommand("docker", [
      "network", "ls", "-q", "--filter",
      `label=com.docker.compose.project=${project}`,
    ], environment, signal, deadline, true),
    asyncCommand("docker", [
      "volume", "ls", "-q", "--filter",
      `label=com.docker.compose.project=${project}`,
    ], environment, signal, deadline, true),
  ]);
  if (leftovers.some(({ stdout }) => stdout.trim())) {
    throw new Error("Recovery cleanup is incomplete");
  }
}

function minioClient({
  environment,
  paths,
  authority,
  args,
  binary = false,
  input,
}) {
  const credentials = authority === "root"
    ? [paths.minio_root_user, paths.minio_root_password]
    : [paths.backup_reader_access_key_id, paths.backup_reader_secret_access_key];
  const command = [
    "run", "--rm", "--pull", "never", "--network",
    `${project}_recovery_internal`, "--platform", "linux/amd64",
    "--mount", `type=bind,src=${credentials[0]},dst=/run/secrets/access_key,readonly`,
    "--mount", `type=bind,src=${credentials[1]},dst=/run/secrets/secret_key,readonly`,
    "--entrypoint", "/bin/sh", environment.PROOFLINE_MINIO_CLIENT_IMAGE,
    "-eu", "-c",
    'access_key=$(cat /run/secrets/access_key); secret_key=$(cat /run/secrets/secret_key); mc alias set recovery http://minio:9000 "$access_key" "$secret_key" >/dev/null; exec mc "$@"',
    "proofline-mc",
    ...args,
  ];
  return binary
    ? dockerBytes(command, environment, false, input)
    : docker(command, environment, true);
}

function storageReader(environment, paths, systemIdentifier) {
  const relativePrefix = `proofline/v1/qa/${systemIdentifier}/`;
  const target = `recovery/proofline-recovery-qa/${relativePrefix.slice(0, -1)}`;
  return {
    async listObjects() {
      const output = minioClient({
        environment,
        paths,
        authority: "reader",
        args: ["ls", "--recursive", "--json", target],
      }).stdout;
      return output.split(/\r?\n/).filter(Boolean).map((line) => {
        const value = JSON.parse(line);
        let key = value.key;
        if (key.startsWith(relativePrefix)) key = key.slice(relativePrefix.length);
        if (key.startsWith(`${target}/`)) key = key.slice(target.length + 1);
        return { key, size: Number(value.size) };
      });
    },
    async readObject(key) {
      return minioClient({
        environment,
        paths,
        authority: "reader",
        args: ["cat", `${target}/${key}`],
        binary: true,
      }).stdout;
    },
  };
}

function compose(
  projectName,
  args,
  environment,
  capture = false,
  allowFailure = false,
) {
  const command = ["--project-name", projectName];
  for (const file of files) command.push("--file", file);
  const result = spawnSync(composeExecutable, [...command, ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    stdio: capture ? "pipe" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stderr.write(result.stdout.slice(-8192));
      if (result.stderr) process.stderr.write(result.stderr.slice(-8192));
    }
    throw new Error(`Recovery Compose command failed (${args.at(-1)})`);
  }
  return result;
}

function sql(projectName, statement, environment, service = "postgres") {
  return compose(projectName, [
    "exec", "-T", service, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", "proofline", "-d", "proofline", "-At", "-c", statement,
  ], environment, true).stdout.trim();
}

function parseComposePs(output) {
  const value = output.trim();
  if (!value) return [];
  return value.startsWith("[")
    ? JSON.parse(value)
    : value.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForJob(projectName, service, environment, deadline) {
  while (Date.now() < deadline) {
    const result = compose(
      projectName,
      ["ps", "--all", "--format", "json", service],
      environment,
      true,
      true,
    );
    const entry = parseComposePs(result.stdout).find(
      (item) => item.Service === service,
    );
    if (entry?.State === "exited") {
      if (Number(entry.ExitCode) !== 0) throw new Error(`${service} failed`);
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${service} exceeded the recovery gate deadline`);
}

async function waitForHealthy(projectName, service, environment, deadline) {
  while (Date.now() < deadline) {
    const result = compose(
      projectName,
      ["ps", "--all", "--format", "json", service],
      environment,
      true,
      true,
    );
    const entry = parseComposePs(result.stdout).find(
      (item) => item.Service === service,
    );
    if (entry?.Health === "healthy") return;
    if (entry?.State === "exited") {
      throw new Error(`${service} exited before healthy`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${service} exceeded the recovery gate deadline`);
}

async function waitForArchive(projectName, environment, expectedWal, deadline) {
  while (Date.now() < deadline) {
    const archived = sql(
      projectName,
      "SELECT coalesce(last_archived_wal, '') FROM pg_stat_archiver",
      environment,
    );
    if (archived >= expectedWal) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("missing-wal: archive completion was not observed");
}

async function prepareSecrets(directory) {
  const postgresPassword = randomBytes(24).toString("hex");
  const values = {
    postgres_password: postgresPassword,
    postgres_admin_database_url:
      `postgres://proofline:${postgresPassword}@postgres:5432/proofline`,
    migrator_database_url:
      `postgres://proofline_migrator_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    api_database_url:
      `postgres://proofline_api_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    worker_database_url:
      `postgres://proofline_worker_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    importer_database_url:
      `postgres://proofline_recording_importer_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    backup_database_url:
      `postgres://proofline_backup_login:${randomBytes(24).toString("hex")}@postgres:5432/proofline`,
    api_digest: randomBytes(32).toString("hex"),
    replay_bundle: "{}",
    replay_report: "{}",
    minio_root_user: `root${randomBytes(12).toString("hex")}`,
    minio_root_password: randomBytes(32).toString("base64url"),
    backup_writer_access_key_id:
      `writer${randomBytes(8).toString("hex")}`,
    backup_writer_secret_access_key: randomBytes(32).toString("base64url"),
    backup_reader_access_key_id:
      `reader${randomBytes(8).toString("hex")}`,
    backup_reader_secret_access_key: randomBytes(32).toString("base64url"),
    backup_retention_access_key_id:
      `retention${randomBytes(8).toString("hex")}`,
    backup_retention_secret_access_key: randomBytes(32).toString("base64url"),
    backup_encryption_key: randomBytes(32).toString("base64"),
    backup_evidence: "{}",
  };
  const paths = {};
  for (const [name, value] of Object.entries(values)) {
    const path = join(directory, name);
    await writeFile(path, value, { mode: 0o600 });
    paths[name] = path;
  }
  return paths;
}

async function environmentFor(directory) {
  const paths = await prepareSecrets(directory);
  const lock = JSON.parse(
    await readFile(join(root, "docker/base-images.json"), "utf8"),
  );
  const minio = lock.images.minio;
  const minioClient = lock.images.minioClient;
  const dockerConfigDirectory = join(directory, "docker-config");
  const homeDirectory = join(directory, "home");
  const xdgConfigDirectory = join(directory, "xdg");
  const temporaryDirectory = join(directory, "tmp");
  for (const path of [
    dockerConfigDirectory,
    homeDirectory,
    xdgConfigDirectory,
    temporaryDirectory,
  ]) await mkdir(path, { mode: 0o700 });
  await writeFile(
    join(dockerConfigDirectory, "config.json"),
    '{"auths":{}}\n',
    { mode: 0o600 },
  );
  const scopedEnvironment = {
    PROOFLINE_CADDY_IMAGE: "proofline/caddy:027a-qa",
    PROOFLINE_WEB_IMAGE: "proofline/web:027a-qa",
    PROOFLINE_API_IMAGE: "proofline/api:027a-qa",
    PROOFLINE_WORKER_IMAGE: "proofline/worker:027a-qa",
    PROOFLINE_POSTGRES_IMAGE: "proofline/postgres-recovery:027c-qa",
    PROOFLINE_MINIO_IMAGE: `${minio.repository}@${minio.linuxAmd64Digest}`,
    PROOFLINE_MINIO_CLIENT_IMAGE:
      `${minioClient.repository}@${minioClient.linuxAmd64Digest}`,
    PROOFLINE_PUBLIC_ORIGIN: "https://127.0.0.1",
    PROOFLINE_DEPLOYMENT_ID: `deployment_${randomBytes(32).toString("hex")}`,
    PROOFLINE_RELEASE_TREE_SHA: randomBytes(20).toString("hex"),
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000000000000000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA: "4",
    PROOFLINE_SAFE_CONSUMER_ADDRESS:
      "0x5555555555555555555555555555555555555555",
    PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE: paths.postgres_admin_database_url,
    PROOFLINE_MIGRATOR_DATABASE_URL_FILE: paths.migrator_database_url,
    PROOFLINE_API_DATABASE_URL_FILE: paths.api_database_url,
    PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: paths.api_digest,
    PROOFLINE_WORKER_DATABASE_URL_FILE: paths.worker_database_url,
    PROOFLINE_WORKER_REPLAY_BUNDLE_FILE: paths.replay_bundle,
    PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE: paths.replay_report,
    PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: paths.importer_database_url,
    PROOFLINE_POSTGRES_PASSWORD_FILE: paths.postgres_password,
    PROOFLINE_BACKUP_DATABASE_URL_FILE: paths.backup_database_url,
    PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE: paths.backup_writer_access_key_id,
    PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE:
      paths.backup_writer_secret_access_key,
    PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE: paths.backup_reader_access_key_id,
    PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE:
      paths.backup_reader_secret_access_key,
    PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE:
      paths.backup_retention_access_key_id,
    PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE:
      paths.backup_retention_secret_access_key,
    PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE: paths.backup_encryption_key,
    PROOFLINE_BACKUP_EVIDENCE_FILE: paths.backup_evidence,
    PROOFLINE_BACKUP_EVIDENCE_SHA256: sha256("pending"),
    PROOFLINE_MINIO_ROOT_USER_FILE: paths.minio_root_user,
    PROOFLINE_MINIO_ROOT_PASSWORD_FILE: paths.minio_root_password,
    PROOFLINE_BACKUP_SLOT: "qa",
    PROOFLINE_BACKUP_ENDPOINT: "http://minio:9000",
    PROOFLINE_BACKUP_REGION: "us-east-1",
    PROOFLINE_BACKUP_BUCKET: "proofline-recovery-qa",
    PROOFLINE_RESTORE_BACKUP_ID: "base_000000010000000000000001",
    PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256: sha256("pending"),
    PROOFLINE_RECOVERY_TARGET_TIME: "2026-08-10T00:00:00.000000Z",
    PROOFLINE_RECOVERY_TARGET_TIMELINE: "1",
    PROOFLINE_BACKUP_SYSTEM_IDENTIFIER: "1",
  };
  const profiles = createCredentialFreeRecoveryEnvironments({
    ambientEnvironment: { PATH: process.env.PATH },
    scopedEnvironment,
    dockerConfigDirectory,
    homeDirectory,
    xdgConfigDirectory,
    temporaryDirectory,
  });
  return {
    environment: {
      ...profiles.docker,
      PROOFLINE_OBSERVED_INVENTORY_SHA256: sha256("pending-observed"),
      PROOFLINE_EXPECTED_INVENTORY_SHA256: sha256("pending-expected"),
    },
    negativeChildEnvironment: profiles.negativeChild,
    paths,
    imageLock: lock,
  };
}

function exactPositiveChecks(value) {
  return value?.restore?.paused === true &&
    value.restore.inRecovery === true &&
    value.restore.promoted === false &&
    value?.checks?.systemIdentifierMatches === true &&
    value.checks.schemaVersion === 10 &&
    value.checks.migrationChecksums === 10 &&
    value.checks.beforeCutPresent === true &&
    value.checks.afterCutAbsent === true &&
    value.checks.inventorySha256Matches === true;
}

async function runRecovery(environment, paths, imageLock) {
  const deadline = Date.now() + timeoutMs;
  docker([
    "run", "--rm", "--pull", "never", "--network", "none",
    "--platform", "linux/amd64",
    "proofline/postgres-recovery:027c-qa", "wal-g", "--version",
  ], environment);
  compose(
    project,
    ["up", "--detach", "--pull", "never", "minio", "minio-init"],
    environment,
  );
  await waitForJob(project, "minio-init", environment, deadline);
  compose(project, [
    "up", "--detach", "--pull", "never",
    "postgres", "db-role-bootstrap", "migrator",
  ], environment);
  await waitForJob(project, "db-role-bootstrap", environment, deadline);
  await waitForJob(project, "migrator", environment, deadline);
  sql(
    project,
    "CREATE TABLE proofline_recovery_sentinel (cut_name text PRIMARY KEY); " +
      "INSERT INTO proofline_recovery_sentinel VALUES ('base');",
    environment,
  );
  const backupStartLsn = sql(
    project,
    "SELECT pg_current_wal_lsn()",
    environment,
  );
  compose(
    project,
    ["up", "--detach", "--pull", "never", "base-backup"],
    environment,
  );
  await waitForJob(project, "base-backup", environment, deadline);
  const backupList = compose(
    project,
    ["run", "--rm", "--no-deps", "backup-status"],
    environment,
    true,
  ).stdout;
  const backups = JSON.parse(backupList);
  const backupId = backups.at(-1)?.backup_name;
  if (!/^base_[0-9A-F]{24}$/.test(backupId ?? "")) {
    throw new Error("Exact backup id is absent");
  }
  sql(
    project,
    "INSERT INTO proofline_recovery_sentinel VALUES ('before-cut')",
    environment,
  );
  const beforeWal = sql(
    project,
    "SELECT pg_walfile_name(pg_switch_wal())",
    environment,
  );
  await waitForArchive(project, environment, beforeWal, deadline);
  const targetTime = sql(
    project,
    "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', " +
      `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    environment,
  );
  sql(
    project,
    "SELECT pg_sleep(0.01); " +
      "INSERT INTO proofline_recovery_sentinel VALUES ('after-cut')",
    environment,
  );
  const afterWal = sql(
    project,
    "SELECT pg_walfile_name(pg_switch_wal())",
    environment,
  );
  await waitForArchive(project, environment, afterWal, deadline);
  const timeline = String(Number.parseInt(afterWal.slice(0, 8), 16));
  const systemIdentifier = sql(
    project,
    "SELECT system_identifier FROM pg_control_system()",
    environment,
  );
  const backupStopLsn = sql(
    project,
    "SELECT pg_current_wal_lsn()",
    environment,
  );
  compose(project, ["stop", "postgres"], environment);
  const reader = storageReader(environment, paths, systemIdentifier);
  const expectedInventory = await collectCiphertextInventory({
    ...reader,
    maximumObjects: 100_000,
    maximumTotalBytes: 512 * 1024 * 1024,
  });
  const completedAt = canonicalMicroseconds(new Date());
  const evidence = {
    version: "1",
    kind: "base-backup",
    producer: {
      commitSha: environment.PROOFLINE_RELEASE_TREE_SHA,
      treeSha: environment.PROOFLINE_RELEASE_TREE_SHA,
      postgresImageDigest: imageLock.images.postgresRecovery.linuxAmd64Digest,
      walGVersion: "v3.0.8",
    },
    database: {
      slot: "qa",
      systemIdentifier,
      postgresMajor: 17,
      schemaVersion: 10,
      migrationCount: 10,
      migrationManifestSha256: sha256(
        await readFile(join(root, "apps/api/db/migrations/manifest.v1.json")),
      ),
    },
    storage: {
      provider: "minio",
      endpointOrigin: "http://minio:9000",
      bucket: "proofline-recovery-qa",
      prefix: `s3://proofline-recovery-qa/proofline/v1/qa/${systemIdentifier}`,
      encryption: "wal-g-libsodium",
      encryptionKeyIdSha256: sha256(await readFile(paths.backup_encryption_key)),
    },
    backup: {
      id: backupId,
      startedAt: canonicalMicroseconds(new Date(Date.now() - 1_000)),
      completedAt,
      startLsn: backupStartLsn,
      stopLsn: backupStopLsn,
      startWalSegment: backupId.slice("base_".length),
      stopWalSegment: afterWal,
      timeline: Number(timeline),
    },
    inventory: expectedInventory,
    status: "completed",
  };
  const backupEvidenceBytes = Buffer.from(
    canonicalSerializeBackupEvidence(evidence),
    "utf8",
  );
  await writeFile(paths.backup_evidence, backupEvidenceBytes, { mode: 0o600 });
  const backupEvidenceSha256 = sha256(backupEvidenceBytes);
  Object.assign(environment, {
    PROOFLINE_RESTORE_BACKUP_ID: backupId,
    PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256: backupEvidenceSha256,
    PROOFLINE_BACKUP_EVIDENCE_SHA256: backupEvidenceSha256,
    PROOFLINE_RECOVERY_TARGET_TIME: targetTime,
    PROOFLINE_RECOVERY_TARGET_TIMELINE: timeline,
    PROOFLINE_BACKUP_SYSTEM_IDENTIFIER: systemIdentifier,
  });
  const observedInventory = await verifyCiphertextInventory({
    backupEvidenceBytes,
    ...storageReader(environment, paths, systemIdentifier),
    maximumObjects: 100_000,
    maximumTotalBytes: 512 * 1024 * 1024,
  });
  Object.assign(environment, {
    PROOFLINE_OBSERVED_INVENTORY_SHA256: observedInventory.canonicalSha256,
    PROOFLINE_EXPECTED_INVENTORY_SHA256:
      evidence.inventory.canonicalSha256,
  });
  compose(project, ["up", "--pull", "never", "pitr-fetch"], environment);
  compose(
    project,
    ["up", "--detach", "--no-deps", "--pull", "never", "pitr-postgres"],
    environment,
  );
  await waitForHealthy(project, "pitr-postgres", environment, deadline);
  compose(
    project,
    ["up", "--detach", "--no-deps", "--pull", "never", "pitr-verify"],
    environment,
  );
  await waitForJob(project, "pitr-verify", environment, deadline);
  const directRecoveryState = sql(
    project,
    "SELECT pg_is_in_recovery()",
    environment,
    "pitr-postgres",
  );
  const verifyLog = compose(
    project,
    ["logs", "--no-color", "--no-log-prefix", "pitr-verify"],
    environment,
    true,
  ).stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  const verified = parsePitrVerifyOutput(verifyLog ?? "");
  if (verified.pgIsInRecovery !== directRecoveryState) {
    throw new Error("PITR recovery state observations disagree");
  }
  const restoreChecks = deriveRestoreChecksFromPitrVerify(verified);
  if (!exactPositiveChecks(restoreChecks)) {
    throw new Error("PITR machine-readable verification failed");
  }
  const sourceVolumeIdentitySha256 = sha256(`${project}:postgres_data`);
  const restoreVolumeIdentitySha256 = sha256(`${project}:pitr_postgres_data`);
  if (sourceVolumeIdentitySha256 === restoreVolumeIdentitySha256) {
    throw new Error("reused-volume identity");
  }
  const workerAbsent = compose(
    project,
    ["ps", "--all", "--format", "json", "worker"],
    environment,
    true,
    true,
  ).stdout.trim() === "";
  if (!workerAbsent) throw new Error("worker not-started invariant failed");
  return {
    restoreChecks,
    sourceVolumeIdentitySha256,
    restoreVolumeIdentitySha256,
    backupId,
    backupEvidenceSha256,
    beforeWal,
    afterWal,
    systemIdentifier,
    targetTime,
    timeline,
    evidence,
  };
}

function canonicalMicroseconds(date) {
  return date.toISOString().replace(/\.([0-9]{3})Z$/, ".$1000Z");
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), `${project}-`));
let environment;
let negativeChildEnvironment;
let paths;
let imageLock;
try {
  ({ environment, negativeChildEnvironment, paths, imageLock } =
    await environmentFor(temporaryDirectory));
  const positive = await runRecovery(environment, paths, imageLock);
  const orchestration = createDockerRecoveryOrchestration(
    createDockerRecoveryNegativeRuntime({
      root,
      project,
      environment,
      negativeChildEnvironment,
      paths,
      positive,
      authorizeRestorePromotion,
    }),
  );
  const negativeReport = await runRecoveryNegativeControls({
    orchestration,
    caseTimeoutMs: negativeCaseTimeoutMs,
    cleanupTimeoutMs: negativeCleanupTimeoutMs,
  });
  if (
    negativeReport.cases.map(({ id }) => id).join("\n") !==
    recoveryNegativeCaseIds.join("\n")
  ) {
    throw new Error("Recovery negative inventory is incomplete");
  }
  process.stdout.write(`${JSON.stringify(negativeReport)}\n`);
} catch (cause) {
  if (environment) {
    const diagnosticController = new AbortController();
    const diagnosticDeadline = Date.now() + 15_000;
    const command = ["--project-name", project];
    for (const file of files) command.push("--file", file);
    await asyncCommand(composeExecutable, [
      ...command, "ps", "--all",
    ], environment, diagnosticController.signal, diagnosticDeadline, true);
    await asyncCommand(composeExecutable, [
      ...command, "logs", "--no-color", "--tail", "100",
      "minio", "minio-init", "postgres", "db-role-bootstrap", "migrator",
      "base-backup", "backup-status", "pitr-fetch", "pitr-postgres",
      "pitr-verify",
    ], environment, diagnosticController.signal, diagnosticDeadline, true);
  }
  throw cause;
} finally {
  await finalizeRecoveryGate({
    temporaryDirectory,
    finalizerTimeoutMs: projectFinalizerTimeoutMs,
    finalizeProject: (signal) => environment
      ? finalizeRecoveryProject(environment, signal)
      : undefined,
    removeTemporaryDirectory: (path) => rm(path, { recursive: true, force: true }),
  });
}
