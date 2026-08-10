import { createHash } from "node:crypto";

const PROBE_BINDING_ERROR_CODE = "RECOVERY_NEGATIVE_PROBE_BINDING_INVALID";
const PROBE_BINDING_ERROR_MESSAGE = "Recovery negative probe binding is invalid";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactString(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function failBinding() {
  throw Object.assign(new Error(PROBE_BINDING_ERROR_MESSAGE), {
    code: PROBE_BINDING_ERROR_CODE,
  });
}

export function createRecoveryNegativeProbeIdentity(input = {}) {
  const value = {
    version: input.version,
    caseId: input.caseId,
    projectName: input.projectName,
    serviceName: input.serviceName,
    containerName: input.containerName,
    objectTarget: input.objectTarget,
    restoreVolume: input.restoreVolume,
    passEvidencePath: input.passEvidencePath,
  };
  if (
    value.version !== "1" ||
    !exactString(value.caseId) ||
    !exactString(value.projectName) ||
    !exactString(value.serviceName) ||
    !exactString(value.containerName) ||
    !(value.objectTarget === null || exactString(value.objectTarget)) ||
    !exactString(value.restoreVolume) ||
    !exactString(value.passEvidencePath) ||
    value.containerName !== `${value.projectName}-${value.serviceName}`
  ) {
    failBinding();
  }
  return Object.freeze({
    ...value,
    identitySha256: sha256(Buffer.from(JSON.stringify(value), "utf8")),
  });
}

export function createRecoveryNegativeParentObserver({
  identity,
  inspectMutation,
  inspectSink,
  countPassEvidence,
  countPromotions,
} = {}) {
  if (
    !identity ||
    !/^sha256:[a-f0-9]{64}$/.test(identity.identitySha256 ?? "") ||
    [inspectMutation, inspectSink, countPassEvidence, countPromotions]
      .some((operation) => typeof operation !== "function")
  ) {
    failBinding();
  }

  return Object.freeze({
    async inspectCase({ fixture, signal } = {}) {
      if (
        !fixture ||
        fixture.caseId !== identity.caseId ||
        fixture.probeIdentitySha256 !== identity.identitySha256 ||
        !(signal instanceof AbortSignal) ||
        signal.aborted
      ) {
        failBinding();
      }
      const mutationObserved = await inspectMutation(identity, signal);
      const sinkObserved = await inspectSink(identity, signal);
      const passEvidenceCount = await countPassEvidence(identity, signal);
      const promotionCount = await countPromotions(identity, signal);
      const observation = {
        caseId: identity.caseId,
        mutationObserved,
        sinkObserved,
        passEvidenceCount,
        promotionCount,
      };
      return Object.freeze({
        caseId: identity.caseId,
        observationSha256: sha256(
          Buffer.from(JSON.stringify(observation), "utf8"),
        ),
        mutationObserved,
        sinkObserved,
        passEvidenceCount,
        promotionCount,
      });
    },
  });
}
