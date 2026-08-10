import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBoundedRecoveryChild } from "./recovery-async-child.mjs";
import { selectCredentialFreeNegativeChildEnvironment } from "./recovery-gate-environment.mjs";
import { observeFutureTargetParentTerminalFailure } from "./recovery-future-target-parent-probe.mjs";
import {
  createRecoveryNegativeParentObserver,
  createRecoveryNegativeProbeIdentity,
} from "./recovery-negative-parent-observer.mjs";

const MAXIMUM_OUTPUT_BYTES = 32 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 25_000;
const KILL_GRACE_MS = 1_000;

const FAILURE_CODE_BY_CASE = Object.freeze({
  "missing-wal-object": "RECOVERY_MISSING_OBJECT",
  "corrupt-backup-object": "RECOVERY_CORRUPT_OBJECT",
  "wrong-encryption-key": "RECOVERY_ENCRYPTION_KEY_INVALID",
  "future-recovery-target": "RECOVERY_TARGET_UNAVAILABLE",
  "reused-restore-volume": "RECOVERY_VOLUME_REUSED",
  "nonempty-restore-volume": "RECOVERY_VOLUME_NOT_EMPTY",
  "promotion-authorization-absent": "RESTORE_PROMOTION_FORBIDDEN",
  "promotion-authorization-mismatch": "RESTORE_PROMOTION_EVIDENCE_MISMATCH",
});

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalMicroseconds(date) {
  return date.toISOString().replace(/\.([0-9]{3})Z$/, ".$1000Z");
}

function countLines(value) {
  return value.trim() ? value.trim().split(/\r?\n/).length : 0;
}

function cleanResult() {
  return { containers: 0, networks: 0, volumes: 0, temporaryPaths: 0 };
}

function promotionEvidence() {
  return {
    version: "1",
    kind: "pitr-restore-drill",
    producer: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      postgresImageDigest: `sha256:${"c".repeat(64)}`,
      walGVersion: "v3.0.8",
    },
    sourceBackupEvidenceSha256: `sha256:${"d".repeat(64)}`,
    target: {
      targetTime: "2026-08-10T00:00:00.000000Z",
      inclusive: true,
      timeline: 1,
    },
    restore: {
      sourceVolumeIdentitySha256: `sha256:${"e".repeat(64)}`,
      restoreVolumeIdentitySha256: `sha256:${"f".repeat(64)}`,
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
    startedAt: "2026-08-10T00:00:00.000000Z",
    completedAt: "2026-08-10T00:01:00.000000Z",
    status: "passed",
  };
}

export function createDockerRecoveryNegativeRuntime({
  root,
  project,
  environment,
  negativeChildEnvironment,
  paths,
  positive,
  authorizeRestorePromotion,
} = {}) {
  if (
    typeof root !== "string" ||
    typeof project !== "string" ||
    !environment ||
    !negativeChildEnvironment ||
    !paths ||
    !positive ||
    typeof authorizeRestorePromotion !== "function"
  ) {
    throw new TypeError("A recovery negative runtime configuration is required");
  }
  const childEnvironment = selectCredentialFreeNegativeChildEnvironment(
    negativeChildEnvironment,
  );
  const states = new Map();

  async function runDocker(args, signal, { allowFailure = false, input } = {}) {
    const result = await runBoundedRecoveryChild({
      executable: "docker",
      args,
      cwd: root,
      environment,
      timeoutMs: CHILD_TIMEOUT_MS,
      killGraceMs: KILL_GRACE_MS,
      maximumOutputBytes: MAXIMUM_OUTPUT_BYTES,
      signal,
      input,
    });
    if (!allowFailure && result.exitCode !== 0) {
      throw new Error(`Recovery Docker command failed (${args.at(-1)})`);
    }
    return result;
  }

  function objectTarget(key) {
    return `recovery/proofline-recovery-qa/proofline/v1/qa/` +
      `${positive.systemIdentifier}/${key}`;
  }

  async function minio(args, signal, { input, allowFailure = false } = {}) {
    return runDocker([
      "run", "--rm",
      ...(input === undefined ? [] : ["--interactive"]),
      "--pull", "never", "--network",
      `${project}_recovery_internal`, "--platform", "linux/amd64",
      "--mount", `type=bind,src=${paths.minio_root_user},dst=/run/secrets/access_key,readonly`,
      "--mount", `type=bind,src=${paths.minio_root_password},dst=/run/secrets/secret_key,readonly`,
      "--entrypoint", "/bin/sh", environment.PROOFLINE_MINIO_CLIENT_IMAGE,
      "-eu", "-c",
      "access_key=$(cat /run/secrets/access_key); secret_key=$(cat /run/secrets/secret_key); mc alias set recovery http://minio:9000 \"$access_key\" \"$secret_key\" >/dev/null; exec mc \"$@\"",
      "proofline-mc",
      ...args,
    ], signal, { input, allowFailure });
  }

  async function preparePromotion(state, mismatch) {
    state.restoreEvidencePath = join(state.directory, "restore-evidence.json");
    state.authorizationPath = join(state.directory, "authorization.json");
    state.currentTime = new Date().toISOString();
    await writeFile(state.restoreEvidencePath, JSON.stringify(promotionEvidence()), {
      mode: 0o600,
    });
    if (mismatch) {
      const now = new Date(state.currentTime);
      await writeFile(state.authorizationPath, JSON.stringify({
        version: "1",
        kind: "restore-promotion-authorization",
        restoreDrillEvidenceSha256: `sha256:${"1".repeat(64)}`,
        operator: "operator_corrective027c00",
        authorizedAt: canonicalMicroseconds(new Date(now.getTime() - 1_000)),
        expiresAt: canonicalMicroseconds(new Date(now.getTime() + 60_000)),
        promote: true,
      }), { mode: 0o600 });
    }
  }

  async function inspectObjectMutation(state, identity, signal) {
    if (state.caseId === "missing-wal-object") {
      const result = await minio(["stat", identity.objectTarget], signal, {
        allowFailure: true,
      });
      return result.exitCode !== 0;
    }
    if (state.caseId === "corrupt-backup-object") {
      const result = await minio(["cat", identity.objectTarget], signal);
      return Buffer.byteLength(result.stdout, "utf8") === state.corruptSize &&
        sha256(Buffer.from(result.stdout, "utf8")) === state.corruptSha256 &&
        state.corruptSize !== state.originalObjectSize;
    }
    if (state.caseId === "wrong-encryption-key") {
      return sha256(await readFile(state.encryptionKeyPath)) !==
        sha256(await readFile(paths.backup_encryption_key));
    }
    if (state.caseId === "future-recovery-target") {
      const inspected = await runDocker([
        "inspect", "--format", "{{json .Config.Env}}", identity.containerName,
      ], signal, { allowFailure: true });
      if (inspected.exitCode !== 0) return false;
      let values;
      try { values = JSON.parse(inspected.stdout.trim()); } catch { return false; }
      return Array.isArray(values) &&
        values.includes(`PROOFLINE_RECOVERY_TARGET_TIME=${state.targetTime}`) &&
        Date.parse(state.targetTime) > Date.parse(positive.targetTime);
    }
    if (state.caseId === "reused-restore-volume") {
      const volumeInspect = await runDocker([
        "volume", "inspect", identity.restoreVolume,
      ], signal, { allowFailure: true });
      const inspected = await runDocker([
        "inspect", "--format", "{{json .Mounts}}", identity.containerName,
      ], signal, { allowFailure: true });
      if (volumeInspect.exitCode !== 0 || inspected.exitCode !== 0) return false;
      let mounts;
      try { mounts = JSON.parse(inspected.stdout.trim()); } catch { return false; }
      return Array.isArray(mounts) && mounts.some((mount) =>
        mount.Type === "volume" &&
        mount.Name === identity.restoreVolume &&
        mount.Destination === "/var/lib/postgresql/data");
    }
    if (state.caseId === "nonempty-restore-volume") {
      const probe = await runDocker([
        "run", "--rm", "--pull", "never", "--network", "none",
        "--platform", "linux/amd64", "--user", "0:0",
        "--mount", `type=volume,src=${identity.restoreVolume},dst=/restore,readonly`,
        "--entrypoint", "/bin/sh", environment.PROOFLINE_POSTGRES_IMAGE,
        "-eu", "-c", "test -s /restore/preexisting-data",
      ], signal, { allowFailure: true });
      return probe.exitCode === 0;
    }
    if (state.caseId === "promotion-authorization-absent") {
      try { await access(state.authorizationPath); return false; }
      catch { return true; }
    }
    const bytes = await readFile(state.authorizationPath, "utf8");
    return bytes.includes(`sha256:${"1".repeat(64)}`);
  }

  async function inspectContainerIdentity(identity, signal) {
    const inspected = await runDocker([
      "inspect", "--format", "{{json .Config.Labels}}", identity.containerName,
    ], signal, { allowFailure: true });
    if (inspected.exitCode !== 0) return false;
    let labels;
    try { labels = JSON.parse(inspected.stdout.trim()); } catch { return false; }
    return labels?.["com.docker.compose.project"] === identity.projectName &&
      labels?.["com.docker.compose.service"] === identity.serviceName;
  }

  async function inspectRecoverySink(state, identity, signal) {
    if (state.caseId.startsWith("promotion-authorization-")) {
      let promotions = 0;
      let code;
      try {
        await authorizeRestorePromotion({
          restoreEvidencePath: state.restoreEvidencePath,
          authorizationPath: state.authorizationPath,
          currentTime: new Date(state.currentTime),
          run() { promotions += 1; },
        });
      } catch (cause) {
        code = cause?.code;
      }
      state.parentPromotionAttempts = promotions;
      return promotions === 0 && code === state.expectedFailureCode;
    }
    if (!await inspectContainerIdentity(identity, signal)) return false;
    if (state.caseId === "future-recovery-target") {
      return observeFutureTargetParentTerminalFailure({
        identity,
        signal,
        runDocker,
      });
    }
    const status = await runDocker([
      "inspect", "--format", "{{.State.Status}}", identity.containerName,
    ], signal, { allowFailure: true });
    const logs = await runDocker(["logs", identity.containerName], signal, {
      allowFailure: true,
    });
    const output = `${logs.stdout}${logs.stderr}`;
    if (state.caseId === "missing-wal-object") {
      const walSegment = state.objectKey.split("/").at(-1).replace(/\.lz4$/, "");
      return status.exitCode === 0 && status.stdout.trim() === "exited" &&
        output.includes(walSegment);
    }
    if (["reused-restore-volume", "nonempty-restore-volume"].includes(
      state.caseId,
    )) {
      return status.exitCode === 0 && status.stdout.trim() === "exited" &&
        output.includes("RESTORE_VOLUME_NONEMPTY");
    }
    return status.exitCode === 0 && status.stdout.trim() === "exited" &&
      output.includes("Selecting the backup with name") &&
      output.includes("Backup to fetch will be searched in storages");
  }

  async function inspectPassEvidence(_state, identity) {
    try { await access(identity.passEvidencePath); return 1; }
    catch { return 0; }
  }

  async function inspectPromotionState(state, identity, signal) {
    if (Number.isSafeInteger(state.parentPromotionAttempts)) {
      return state.parentPromotionAttempts;
    }
    if (state.caseId === "future-recovery-target") {
      if (!await inspectContainerIdentity(identity, signal)) return 1;
      return await observeFutureTargetParentTerminalFailure({
        identity,
        signal,
        runDocker,
      }) ? 0 : 1;
    }
    if (state.caseId === "missing-wal-object") {
      const logs = await runDocker(["logs", identity.containerName], signal, {
        allowFailure: true,
      });
      const walSegment = state.objectKey.split("/").at(-1).replace(/\.lz4$/, "");
      return logs.exitCode === 0 && logs.stdout.concat(logs.stderr).includes(walSegment)
        ? 0
        : 1;
    }
    const postgres = await runDocker([
      "ps", "-aq",
      "--filter", `label=com.docker.compose.project=${identity.projectName}`,
      "--filter", "label=com.docker.compose.service=pitr-postgres",
    ], signal, { allowFailure: true });
    return postgres.exitCode === 0 && countLines(postgres.stdout) === 0 ? 0 : 1;
  }

  return Object.freeze({
    async prepareCase({ id, action }, signal) {
      if (signal.aborted || !FAILURE_CODE_BY_CASE[id]) {
        throw new Error("Recovery negative case aborted");
      }
      const directory = await mkdtemp(join(tmpdir(), `proofline-027c-${id}-`));
      const caseProject =
        `proofline-027c-negative-${process.pid}-${randomBytes(4).toString("hex")}`;
      const state = {
        version: "1",
        caseId: id,
        action,
        expectedFailureCode: FAILURE_CODE_BY_CASE[id],
        directory,
        caseProject,
        mainProject: project,
        passEvidencePath: join(directory, "PASS.json"),
        backupId: positive.backupId,
        backupEvidenceSha256: positive.backupEvidenceSha256,
        targetTime: positive.targetTime,
        timeline: positive.timeline,
        systemIdentifier: positive.systemIdentifier,
        sourceVolume: `${project}_postgres_data`,
        restoreVolume: `${caseProject}_restore`,
        ownsRestoreVolume: true,
      };
      states.set(id, state);
      await runDocker([
        "volume", "create", "--label",
        `com.docker.compose.project=${caseProject}`,
        state.restoreVolume,
      ], signal);

      if (id === "missing-wal-object" || id === "corrupt-backup-object") {
        const entry = id === "missing-wal-object"
          ? positive.evidence.inventory.entries.find(({ key }) =>
              key.startsWith("wal_005/") && key.includes(positive.beforeWal))
          : positive.evidence.inventory.entries.find(({ key }) =>
              key.startsWith("basebackups_005/") && key.endsWith("/part_001.tar.lz4"));
        if (!entry) throw new Error("Required recovery object is absent");
        state.objectKey = entry.key;
        state.originalObjectSize = entry.size;
        state.objectBackupTarget =
          `recovery/proofline-recovery-qa/negative-fixtures/${caseProject}`;
        await minio(["cp", objectTarget(entry.key), state.objectBackupTarget], signal);
        if (id === "missing-wal-object") {
          await minio(["rm", "--force", objectTarget(entry.key)], signal);
        } else {
          const corruptBytes = Buffer.from("corrupt-backup", "utf8");
          state.corruptSize = corruptBytes.length;
          state.corruptSha256 = sha256(corruptBytes);
          await minio(["pipe", objectTarget(entry.key)], signal, {
            input: corruptBytes,
          });
        }
      } else if (id === "wrong-encryption-key") {
        state.encryptionKeyPath = join(directory, "wrong-encryption-key");
        await writeFile(state.encryptionKeyPath, randomBytes(32), { mode: 0o600 });
      } else if (id === "future-recovery-target") {
        state.targetTime = canonicalMicroseconds(new Date(Date.now() + 86_400_000));
      } else if (id === "reused-restore-volume") {
        await runDocker(["volume", "rm", state.restoreVolume], signal);
        state.restoreVolume = state.sourceVolume;
        state.ownsRestoreVolume = false;
      } else if (id === "nonempty-restore-volume") {
        await runDocker([
          "run", "--rm", "--pull", "never", "--network", "none",
          "--platform", "linux/amd64", "--label",
          `com.docker.compose.project=${caseProject}`,
          "--user", "0:0",
          "--mount", `type=volume,src=${state.restoreVolume},dst=/restore`,
          "--entrypoint", "/bin/sh", environment.PROOFLINE_POSTGRES_IMAGE,
          "-eu", "-c", "printf occupied > /restore/preexisting-data",
        ], signal);
      } else if (id === "promotion-authorization-absent") {
        await preparePromotion(state, false);
      } else if (id === "promotion-authorization-mismatch") {
        await preparePromotion(state, true);
      }

      const serviceName = id === "future-recovery-target" || id === "missing-wal-object"
        ? "pitr-postgres"
        : id.startsWith("promotion-authorization-")
          ? "restore-promotion"
          : "pitr-fetch";
      const identity = createRecoveryNegativeProbeIdentity({
        version: "1",
        caseId: id,
        projectName: state.caseProject,
        serviceName,
        containerName: `${state.caseProject}-${serviceName}`,
        objectTarget: state.objectKey ? objectTarget(state.objectKey) : null,
        restoreVolume: state.restoreVolume,
        passEvidencePath: state.passEvidencePath,
      });
      state.serviceName = identity.serviceName;
      state.containerName = identity.containerName;
      state.objectTarget = identity.objectTarget;
      state.probeIdentitySha256 = identity.identitySha256;
      state.statePath = join(directory, "case-state.v1.json");
      await writeFile(state.statePath, JSON.stringify(state), { mode: 0o600 });
      state.parentObserver = createRecoveryNegativeParentObserver({
        identity,
        inspectMutation: (boundIdentity, boundSignal) =>
          inspectObjectMutation(state, boundIdentity, boundSignal),
        inspectSink: (boundIdentity, boundSignal) =>
          inspectRecoverySink(state, boundIdentity, boundSignal),
        countPassEvidence: (boundIdentity, boundSignal) =>
          inspectPassEvidence(state, boundIdentity, boundSignal),
        countPromotions: (boundIdentity, boundSignal) =>
          inspectPromotionState(state, boundIdentity, boundSignal),
      });
      return {
        caseId: id,
        mutationApplied: true,
        mutationEvidenceSha256: sha256(await readFile(state.statePath)),
        probeIdentitySha256: identity.identitySha256,
        statePath: state.statePath,
      };
    },

    async executeRecoveryCase(fixture, signal) {
      return runBoundedRecoveryChild({
        executable: process.execPath,
        args: [join(root, "scripts/docker-recovery-negative-child.mjs"), fixture.statePath],
        cwd: root,
        environment: childEnvironment,
        timeoutMs: CHILD_TIMEOUT_MS,
        killGraceMs: KILL_GRACE_MS,
        maximumOutputBytes: MAXIMUM_OUTPUT_BYTES,
        signal,
      });
    },

    async inspectRecoveryCase(fixture, signal) {
      const state = states.get(fixture.caseId);
      if (!state) throw new Error("Recovery negative state is absent");
      const observation = await state.parentObserver.inspectCase({ fixture, signal });
      const parentObservationSha256 = observation.observationSha256;
      return {
        ...observation,
        observationSha256: parentObservationSha256,
      };
    },

    async cleanupCase(id, signal) {
      const state = states.get(id);
      if (!state) return cleanResult();
      if (state.objectKey) {
        await minio(["cp", state.objectBackupTarget, objectTarget(state.objectKey)], signal);
        await minio(["rm", "--force", state.objectBackupTarget], signal);
      }
      const listed = await runDocker([
        "ps", "-aq", "--filter", `label=com.docker.compose.project=${state.caseProject}`,
      ], signal, { allowFailure: true });
      for (const containerId of listed.stdout.trim().split(/\r?\n/).filter(Boolean)) {
        await runDocker(["rm", "--force", "--volumes", containerId], signal, {
          allowFailure: true,
        });
      }
      if (state.ownsRestoreVolume) {
        await runDocker(["volume", "rm", state.restoreVolume], signal, {
          allowFailure: true,
        });
      }
      await rm(state.directory, { recursive: true, force: true });
      const [containersResult, networksResult, volumesResult] = await Promise.all([
        runDocker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${state.caseProject}`], signal, { allowFailure: true }),
        runDocker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${state.caseProject}`], signal, { allowFailure: true }),
        runDocker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${state.caseProject}`], signal, { allowFailure: true }),
      ]);
      let temporaryPaths = 0;
      try { await access(state.directory); temporaryPaths = 1; } catch {}
      states.delete(id);
      return {
        containers: countLines(containersResult.stdout),
        networks: countLines(networksResult.stdout),
        volumes: countLines(volumesResult.stdout),
        temporaryPaths,
      };
    },
  });
}
