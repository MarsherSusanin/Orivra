import { readFile } from "node:fs/promises";
import { authorizeRestorePromotion } from "./restore-promotion.mjs";
import { runBoundedRecoveryChild } from "./recovery-async-child.mjs";
import { selectCredentialFreeNegativeChildEnvironment } from "./recovery-gate-environment.mjs";

const state = JSON.parse(await readFile(process.argv[2] ?? "", "utf8"));

const environment = selectCredentialFreeNegativeChildEnvironment(process.env);
const controller = new AbortController();

async function docker(args) {
  return runBoundedRecoveryChild({
    executable: "docker",
    args,
    cwd: process.cwd(),
    environment,
    timeoutMs: 20_000,
    killGraceMs: 1_000,
    maximumOutputBytes: 32 * 1024 * 1024,
    signal: controller.signal,
  });
}

function secretMount(source, target) {
  return ["--mount", `type=bind,src=${source},dst=${target},readonly`];
}

function recoveryEnvironment(overrides = {}) {
  const values = {
    PGDATA: "/var/lib/postgresql/data",
    PROOFLINE_BACKUP_SLOT: "qa",
    PROOFLINE_BACKUP_ENDPOINT: "http://minio:9000",
    PROOFLINE_BACKUP_REGION: "us-east-1",
    PROOFLINE_BACKUP_BUCKET: "proofline-recovery-qa",
    PROOFLINE_BACKUP_QA: "true",
    PROOFLINE_BACKUP_SYSTEM_IDENTIFIER: state.systemIdentifier,
    PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE: "/run/secrets/backup_encryption_key",
    PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE:
      "/run/secrets/backup_reader_access_key_id",
    PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE:
      "/run/secrets/backup_reader_secret_access_key",
    PROOFLINE_RESTORE_BACKUP_ID: state.backupId,
    PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256: state.backupEvidenceSha256,
    PROOFLINE_RECOVERY_TARGET_TIME: state.targetTime,
    PROOFLINE_RECOVERY_TARGET_TIMELINE: state.timeline,
    recovery_target_inclusive: "on",
    recovery_target_action: "pause",
    recovery_target_timeline: state.timeline,
    WALG_BACKUP_DOWNLOAD_MAX_RETRY: "1",
    WALG_DOWNLOAD_FILE_RETRIES: "1",
    WALG_NETWORK_MAX_RETRIES: "1",
    ...overrides,
  };
  return Object.entries(values).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
}

function recoveryMounts() {
  return [
    ...secretMount(
      environment.PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE,
      "/run/secrets/backup_reader_access_key_id",
    ),
    ...secretMount(
      environment.PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE,
      "/run/secrets/backup_reader_secret_access_key",
    ),
    ...secretMount(
      state.encryptionKeyPath ?? environment.PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE,
      "/run/secrets/backup_encryption_key",
    ),
  ];
}

function baseRunArguments(name, serviceName) {
  return [
    "run",
    "--name",
    name,
    "--label",
    `com.docker.compose.project=${state.caseProject}`,
    "--label",
    `com.docker.compose.service=${serviceName}`,
    "--pull",
    "never",
    "--platform",
    "linux/amd64",
    "--network",
    `${state.mainProject}_recovery_internal`,
    "--user",
    "999:999",
    "--read-only",
    "--tmpfs",
    "/tmp:size=32m,mode=1777",
    "--mount",
    `type=volume,src=${state.restoreVolume},dst=/var/lib/postgresql/data`,
    ...recoveryMounts(),
    ...recoveryEnvironment(),
  ];
}

function recordFailure(failureCode, execution) {
  if (execution.stdout) process.stderr.write(execution.stdout.slice(-8192));
  if (execution.stderr) process.stderr.write(execution.stderr.slice(-8192));
  process.stderr.write(`${JSON.stringify({
    version: "1",
    caseId: state.caseId,
    status: "failed",
    failureCode,
  })}\n`);
  process.exitCode = 64;
}

async function executePromotionCase() {
  let failureCode;
  try {
    await authorizeRestorePromotion({
      restoreEvidencePath: state.restoreEvidencePath,
      authorizationPath: state.authorizationPath,
      currentTime: new Date(state.currentTime),
      run() {
        throw new Error("pg_promote must not be called by a negative case");
      },
    });
  } catch (cause) {
    failureCode = cause?.code;
  }
  if (failureCode !== state.expectedFailureCode) {
    throw new Error("Promotion authorization did not fail with the expected code");
  }
  recordFailure(failureCode, { exitCode: 64, stdout: "", stderr: "" });
}

async function executeFetchCase() {
  const fetchCommand = ["corrupt-backup-object", "wrong-encryption-key"].includes(
    state.caseId,
  )
    ? ["/usr/bin/timeout", "10s", "/usr/local/bin/proofline-pitr-fetch.sh"]
    : ["/usr/local/bin/proofline-pitr-fetch.sh"];
  const fetch = await docker([
    ...baseRunArguments(`${state.caseProject}-pitr-fetch`, "pitr-fetch"),
    environment.PROOFLINE_POSTGRES_IMAGE,
    ...fetchCommand,
  ]);
  if ([
    "corrupt-backup-object",
    "wrong-encryption-key",
    "reused-restore-volume",
    "nonempty-restore-volume",
  ].includes(state.caseId)) {
    if (fetch.exitCode === 0) throw new Error("Adverse pitr-fetch unexpectedly succeeded");
    const output = `${fetch.stdout}${fetch.stderr}`;
    if (["reused-restore-volume", "nonempty-restore-volume"].includes(
      state.caseId,
    )) {
      if (!output.includes("RESTORE_VOLUME_NONEMPTY")) {
        throw new Error("Restore volume preflight was not reached");
      }
    } else if (
      !output.includes("Selecting the backup with name") ||
      !output.includes("Backup to fetch will be searched in storages")
    ) {
      throw new Error("WAL-G backup-fetch sink was not reached");
    }
    recordFailure(state.expectedFailureCode, fetch);
    return;
  }
  if (fetch.exitCode !== 0) {
    throw new Error("pitr-fetch failed before the intended PostgreSQL recovery sink");
  }

  const containerName = `${state.caseProject}-pitr-postgres`;
  const start = await docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--label",
    `com.docker.compose.project=${state.caseProject}`,
    "--label",
    "com.docker.compose.service=pitr-postgres",
    "--pull",
    "never",
    "--platform",
    "linux/amd64",
    "--network",
    `${state.mainProject}_recovery_internal`,
    "--user",
    "999:999",
    "--mount",
    `type=volume,src=${state.restoreVolume},dst=/var/lib/postgresql/data`,
    ...recoveryMounts(),
    ...recoveryEnvironment(),
    environment.PROOFLINE_POSTGRES_IMAGE,
    "postgres",
  ]);
  if (start.exitCode !== 0) throw new Error("Negative pitr-postgres did not start");

  let status = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    status = (await docker([
      "inspect",
      "--format",
      "{{.State.Status}}",
      containerName,
    ])).stdout.trim();
    if (status === "exited") break;
  }
  const logs = await docker(["logs", containerName]);
  const output = `${logs.stdout}${logs.stderr}`;
  if (state.caseId === "missing-wal-object" && status !== "exited") {
    throw new Error("Missing WAL did not stop the recovery server");
  }
  if (
    state.caseId === "future-recovery-target" &&
    (status !== "exited" ||
      !output.includes("recovery ended before configured recovery target was reached"))
  ) {
    throw new Error("Future recovery target did not reach its terminal sink");
  }
  recordFailure(state.expectedFailureCode, {
    exitCode: status === "exited" ? 1 : 124,
    stdout: logs.stdout,
    stderr: logs.stderr,
  });
}

if (state.caseId.startsWith("promotion-authorization-")) {
  await executePromotionCase();
} else {
  await executeFetchCase();
}
