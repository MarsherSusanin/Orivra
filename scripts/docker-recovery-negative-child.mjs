import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runBoundedRecoveryChild } from "./recovery-async-child.mjs";
import { selectCredentialFreeNegativeChildEnvironment } from "./recovery-gate-environment.mjs";

function failEntry(diagnosticId, caseId = "missing-wal-object") {
  process.stderr.write(`${JSON.stringify({
    version: "1",
    caseId,
    status: "diagnostic",
    diagnosticId,
  })}\n`);
  throw new Error("Recovery negative child entry failed closed");
}

let state;
try {
  state = JSON.parse(await readFile(process.argv[2] ?? "", "utf8"));
} catch {
  failEntry("missing-wal-state-invalid");
}

let environment;
try {
  environment = selectCredentialFreeNegativeChildEnvironment(process.env);
} catch {
  failEntry("missing-wal-environment-invalid", state.caseId);
}
const controller = new AbortController();
let activeDiagnosticId = "missing-wal-entry-failed";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

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

function recordDiagnostic(diagnosticId) {
  process.stderr.write(`${JSON.stringify({
    version: "1",
    caseId: state.caseId,
    status: "diagnostic",
    diagnosticId,
  })}\n`);
  process.exitCode = 65;
}

async function executePromotionCase() {
  const [backupEvidenceBytes, handoffReceiptBytes, restoreEvidenceBytes] = await Promise.all([
    readFile(state.backupEvidencePath),
    readFile(state.handoffReceiptPath),
    readFile(state.restoreEvidencePath),
  ]);
  if (
    sha256(backupEvidenceBytes) !== state.backupEvidenceSha256 ||
    sha256(handoffReceiptBytes) !== state.handoffReceiptSha256 ||
    sha256(restoreEvidenceBytes) !== state.restoreEvidenceSha256
  ) {
    throw new Error("Promotion evidence identity did not match");
  }
  let failureCode;
  if (state.caseId === "promotion-authorization-absent") {
    try {
      await readFile(state.authorizationPath);
    } catch (cause) {
      if (cause?.code === "ENOENT") failureCode = "RESTORE_PROMOTION_FORBIDDEN";
      else throw cause;
    }
  } else {
    const authorization = JSON.parse(
      await readFile(state.authorizationPath, "utf8"),
    );
    if (
      authorization?.version === "2" &&
      authorization.kind === "restore-promotion-authorization" &&
      authorization.recoveryEvidenceHandoffSha256 ===
        state.handoffReceiptSha256 &&
      authorization.restoreDrillEvidenceSha256 !==
        state.restoreEvidenceSha256
    ) {
      failureCode = "RESTORE_PROMOTION_EVIDENCE_MISMATCH";
    }
  }
  if (failureCode !== state.expectedFailureCode) {
    throw new Error("Promotion authorization did not fail with the expected code");
  }
  recordFailure(failureCode, { exitCode: 64, stdout: "", stderr: "" });
}

async function executeFetchCase() {
  activeDiagnosticId = "missing-wal-prestart-failed";
  const fetchCommand = ["corrupt-backup-object", "wrong-encryption-key"].includes(
    state.caseId,
  )
    ? ["/usr/bin/timeout", "10s", "/usr/local/bin/proofline-pitr-fetch.sh"]
    : ["/usr/local/bin/proofline-pitr-fetch.sh"];
  const fetch = state.caseId === "missing-wal-object"
    ? null
    : await docker([
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
    if (!fetch) throw new Error("Adverse pitr-fetch was not executed");
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
  if (fetch && fetch.exitCode !== 0) {
    throw new Error("pitr-fetch failed before the intended PostgreSQL recovery sink");
  }

  const containerName = `${state.caseProject}-pitr-postgres`;
  const postgresCommand = state.caseId === "missing-wal-object"
    ? [
        "/usr/bin/timeout", "--signal=TERM", "--kill-after=1s", "6s", "postgres",
      ]
    : ["postgres"];
  let start;
  activeDiagnosticId = "missing-wal-start-failed";
  try {
    start = await docker([
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
      ...postgresCommand,
    ]);
  } catch {
    if (state.caseId === "missing-wal-object") {
      return recordDiagnostic("missing-wal-start-failed");
    }
    throw new Error("Negative pitr-postgres did not start");
  }
  if (start.exitCode !== 0) {
    if (state.caseId === "missing-wal-object") {
      return recordDiagnostic("missing-wal-start-failed");
    }
    throw new Error("Negative pitr-postgres did not start");
  }

  let status = "";
  let waitedExitCode;
  if (state.caseId === "missing-wal-object") {
    activeDiagnosticId = "missing-wal-wait-failed";
    let waited;
    try {
      waited = await docker(["wait", containerName]);
    } catch {
      return recordDiagnostic("missing-wal-wait-failed");
    }
    waitedExitCode = Number(waited.stdout.trim());
    if (
      waited.exitCode !== 0 ||
      !Number.isSafeInteger(waitedExitCode) ||
      waitedExitCode < 1
    ) return recordDiagnostic("missing-wal-wait-failed");
    status = "exited";
  } else {
    activeDiagnosticId = "missing-wal-inspect-failed";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      try {
        status = (await docker([
          "inspect",
          "--format",
          "{{.State.Status}}",
          containerName,
        ])).stdout.trim();
      } catch {
        throw new Error("Negative pitr-postgres inspection failed");
      }
      if (status === "exited") break;
    }
  }
  let logs;
  activeDiagnosticId = "missing-wal-logs-failed";
  try {
    logs = await docker(["logs", containerName]);
  } catch {
    if (state.caseId === "missing-wal-object") {
      return recordDiagnostic("missing-wal-logs-failed");
    }
    throw new Error("Negative pitr-postgres logs failed");
  }
  const output = `${logs.stdout}${logs.stderr}`;
  activeDiagnosticId = "missing-wal-terminal-failed";
  if (state.caseId === "missing-wal-object") {
    const walSegment = state.objectKey.split("/").at(-1).replace(/\.lz4$/, "");
    if (status !== "exited") return recordDiagnostic("missing-wal-nonterminal");
    if (!output.includes(walSegment)) {
      return recordDiagnostic("missing-wal-segment-unobserved");
    }
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

try {
  if (state.caseId.startsWith("promotion-authorization-")) {
    await executePromotionCase();
  } else {
    await executeFetchCase();
  }
} catch {
  if (state.caseId === "missing-wal-object") {
    recordDiagnostic(activeDiagnosticId);
  } else {
    throw new Error("Recovery negative child failed closed");
  }
}
