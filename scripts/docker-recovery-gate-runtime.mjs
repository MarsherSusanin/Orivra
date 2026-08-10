import { createHash } from "node:crypto";

const ACTION_BY_CASE = Object.freeze({
  "missing-wal-object": "removeRequiredWalObject",
  "corrupt-backup-object": "corruptRequiredBackupObject",
  "wrong-encryption-key": "replaceEncryptionKey",
  "future-recovery-target": "setFutureRecoveryTarget",
  "reused-restore-volume": "reuseSourceVolume",
  "nonempty-restore-volume": "seedRestoreVolume",
  "promotion-authorization-absent": "omitPromotionAuthorization",
  "promotion-authorization-mismatch": "mismatchPromotionEvidence",
});

const VERIFY_FIELDS = Object.freeze([
  "pgIsInRecovery",
  "pgIsWalReplayPaused",
  "systemIdentifier",
  "expectedSystemIdentifier",
  "schemaVersion",
  "migrationChecksumCount",
  "beforeCutCount",
  "afterCutCount",
  "inventorySha256",
  "expectedInventorySha256",
]);

export function parsePitrVerifyOutput(output) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("pitr-verify returned invalid machine-readable output");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== VERIFY_FIELDS.length ||
    VERIFY_FIELDS.some((field) => typeof value[field] !== "string")
  ) {
    throw new Error("pitr-verify returned invalid machine-readable output");
  }
  return Object.freeze({ ...value });
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseFailedChildOutput(execution, definition) {
  if (
    !execution ||
    !Number.isSafeInteger(execution.exitCode) ||
    execution.exitCode === 0 ||
    typeof execution.stdout !== "string" ||
    typeof execution.stderr !== "string"
  ) {
    throw new Error("Recovery child execution is invalid");
  }
  const combined = `${execution.stdout}${execution.stderr}`;
  const records = combined.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const value = records.at(-1);
  if (
    !value ||
    value.version !== "1" ||
    value.caseId !== definition.id ||
    value.status !== "failed" ||
    value.failureCode !== definition.expectedFailureCode
  ) {
    throw new Error("Recovery child output is invalid");
  }
  return { value, combined };
}

export function createDockerRecoveryOrchestration(runtime) {
  if (
    !runtime ||
    typeof runtime.prepareCase !== "function" ||
    typeof runtime.executeRecoveryCase !== "function" ||
    typeof runtime.inspectRecoveryCase !== "function" ||
    typeof runtime.cleanupCase !== "function"
  ) {
    throw new TypeError("A Docker recovery runtime is required");
  }

  function inspectRecoveryCase(fixture, signal) {
    return runtime.inspectRecoveryCase.length >= 3
      ? runtime.inspectRecoveryCase(fixture, undefined, signal)
      : runtime.inspectRecoveryCase(fixture, signal);
  }

  return Object.freeze({
    async runCase(definition, signal) {
      const action = ACTION_BY_CASE[definition?.id];
      if (!action || signal?.aborted) {
        throw new Error("Recovery negative case is invalid");
      }
      const fixture = await runtime.prepareCase({
        id: definition.id,
        action,
      }, signal);
      if (
        !fixture ||
        fixture.caseId !== definition.id ||
        fixture.mutationApplied !== true ||
        !/^sha256:[a-f0-9]{64}$/.test(fixture.mutationEvidenceSha256 ?? "")
      ) {
        throw new Error("Recovery adverse state is invalid");
      }
      const execution = await runtime.executeRecoveryCase(fixture, signal);
      const child = parseFailedChildOutput(execution, definition);
      const observation = await inspectRecoveryCase(fixture, signal);
      return {
        caseId: definition.id,
        status: child.value.status,
        failureCode: child.value.failureCode,
        childExitCode: execution.exitCode,
        childOutputSha256: sha256(child.combined),
        parentObservationSha256: observation?.observationSha256,
        parentMutationObserved: observation?.mutationObserved === true,
        parentSinkObserved: observation?.sinkObserved === true,
        parentPassEvidenceCount: observation?.passEvidenceCount,
        parentPromotionCount: observation?.promotionCount,
      };
    },
    cleanupCase(id, signal) {
      return runtime.cleanupCase(id, signal);
    },
  });
}
