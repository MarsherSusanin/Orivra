const NEGATIVE_CONTROL_ERROR_CODE = "RECOVERY_NEGATIVE_CONTROL_BYPASSED";
const NEGATIVE_CONTROL_ERROR_MESSAGE =
  "Recovery negative control failed closed";
const NEGATIVE_CLEANUP_ERROR_CODE = "RECOVERY_NEGATIVE_CLEANUP_FAILED";
const NEGATIVE_CLEANUP_ERROR_MESSAGE = "Recovery negative cleanup failed";
const NEGATIVE_TIMEOUT_ERROR_CODE = "RECOVERY_NEGATIVE_TIMEOUT";
const NEGATIVE_TIMEOUT_ERROR_MESSAGE = "Recovery negative control timed out";

export const RECOVERY_NEGATIVE_CASES = Object.freeze([
  Object.freeze({
    id: "missing-wal-object",
    expectedFailureCode: "RECOVERY_MISSING_OBJECT",
  }),
  Object.freeze({
    id: "corrupt-backup-object",
    expectedFailureCode: "RECOVERY_CORRUPT_OBJECT",
  }),
  Object.freeze({
    id: "wrong-encryption-key",
    expectedFailureCode: "RECOVERY_ENCRYPTION_KEY_INVALID",
  }),
  Object.freeze({
    id: "future-recovery-target",
    expectedFailureCode: "RECOVERY_TARGET_UNAVAILABLE",
  }),
  Object.freeze({
    id: "reused-restore-volume",
    expectedFailureCode: "RECOVERY_VOLUME_REUSED",
  }),
  Object.freeze({
    id: "nonempty-restore-volume",
    expectedFailureCode: "RECOVERY_VOLUME_NOT_EMPTY",
  }),
  Object.freeze({
    id: "promotion-authorization-absent",
    expectedFailureCode: "RESTORE_PROMOTION_FORBIDDEN",
  }),
  Object.freeze({
    id: "promotion-authorization-mismatch",
    expectedFailureCode: "RESTORE_PROMOTION_EVIDENCE_MISMATCH",
  }),
]);

function failNegativeControl(details) {
  throw Object.assign(new Error(NEGATIVE_CONTROL_ERROR_MESSAGE), {
    code: NEGATIVE_CONTROL_ERROR_CODE,
    ...(details === undefined ? {} : { details }),
  });
}

function failNegativeCleanup() {
  throw Object.assign(new Error(NEGATIVE_CLEANUP_ERROR_MESSAGE), {
    code: NEGATIVE_CLEANUP_ERROR_CODE,
  });
}

function exactZeroCleanup(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 4 &&
    value.containers === 0 &&
    value.networks === 0 &&
    value.volumes === 0 &&
    value.temporaryPaths === 0;
}

function exactFailureResult(value, definition) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 10 &&
    value.caseId === definition.id &&
    value.status === "failed" &&
    value.failureCode === definition.expectedFailureCode &&
    Number.isSafeInteger(value.childExitCode) &&
    value.childExitCode > 0 &&
    /^sha256:[a-f0-9]{64}$/.test(value.childOutputSha256 ?? "") &&
    /^sha256:[a-f0-9]{64}$/.test(value.parentObservationSha256 ?? "") &&
    value.parentMutationObserved === true &&
    value.parentSinkObserved === true &&
    value.parentPassEvidenceCount === 0 &&
    value.parentPromotionCount === 0;
}

async function runBounded(operation, timeoutMs, controller) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error(NEGATIVE_TIMEOUT_ERROR_MESSAGE), {
        code: NEGATIVE_TIMEOUT_ERROR_CODE,
      }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

export function deriveRestoreChecksFromPitrVerify(value) {
  const inRecovery = value?.pgIsInRecovery === "t";
  return {
    restore: {
      paused: value?.pgIsWalReplayPaused === "t",
      inRecovery,
      promoted: !inRecovery,
    },
    checks: {
      systemIdentifierMatches:
        typeof value?.systemIdentifier === "string" &&
        value.systemIdentifier === value.expectedSystemIdentifier,
      schemaVersion: Number(value?.schemaVersion),
      migrationChecksums: Number(value?.migrationChecksumCount),
      beforeCutPresent: value?.beforeCutCount === "1",
      afterCutAbsent: value?.afterCutCount === "0",
      inventorySha256Matches:
        typeof value?.inventorySha256 === "string" &&
        value.inventorySha256 === value.expectedInventorySha256,
    },
  };
}

export async function runRecoveryNegativeControls({
  orchestration,
  caseTimeoutMs,
  cleanupTimeoutMs,
} = {}) {
  if (
    !orchestration ||
    typeof orchestration.runCase !== "function" ||
    typeof orchestration.cleanupCase !== "function" ||
    !Number.isSafeInteger(caseTimeoutMs) ||
    caseTimeoutMs < 1 ||
    !Number.isSafeInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs < 1
  ) {
    failNegativeControl();
  }

  const cases = [];
  for (const definition of RECOVERY_NEGATIVE_CASES) {
    const controller = new AbortController();
    let result;
    let primaryFailure;
    try {
      result = await runBounded(
        Promise.resolve().then(() =>
          orchestration.runCase(definition, controller.signal)),
        caseTimeoutMs,
        controller,
      );
      if (!exactFailureResult(result, definition)) {
        failNegativeControl({ caseId: definition.id, result });
      }
    } catch (cause) {
      primaryFailure = cause;
    }

    const cleanupController = new AbortController();
    let cleanup;
    try {
      cleanup = await runBounded(
        Promise.resolve().then(() => orchestration.cleanupCase(
          definition.id,
          cleanupController.signal,
        )),
        cleanupTimeoutMs,
        cleanupController,
      );
    } catch (cause) {
      if (cause?.code === NEGATIVE_TIMEOUT_ERROR_CODE) throw cause;
      failNegativeCleanup();
    }
    if (!exactZeroCleanup(cleanup)) failNegativeCleanup();
    if (primaryFailure) {
      if (
        primaryFailure?.code === NEGATIVE_CONTROL_ERROR_CODE ||
        primaryFailure?.code === NEGATIVE_TIMEOUT_ERROR_CODE
      ) {
        throw primaryFailure;
      }
      failNegativeControl({
        caseId: definition.id,
        phaseId: typeof primaryFailure?.phaseId === "string"
          ? primaryFailure.phaseId
          : "unknown",
        ...(primaryFailure?.diagnostics ?? {}),
      });
    }
    cases.push({
      id: definition.id,
      failureCode: definition.expectedFailureCode,
      cleanupVerified: true,
    });
  }

  return { version: "1", status: "passed", cases };
}
