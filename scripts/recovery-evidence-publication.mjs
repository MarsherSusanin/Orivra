function requireFunction(value) {
  if (typeof value !== "function") {
    throw new TypeError("Recovery evidence publication boundary is invalid");
  }
  return value;
}

export async function runRecoveryEvidencePublication({
  outputRoot,
  snapshot,
  runRecoveryFromSnapshot,
  stageEvidence,
  runNegativeControls,
  finalizeProjectAndSecrets,
  cleanupSnapshot,
  verifyFinalSource,
  publishEvidence,
  discardEvidence,
  runFailureDiagnostics,
} = {}) {
  const drill = requireFunction(runRecoveryFromSnapshot);
  const stage = requireFunction(stageEvidence);
  const negatives = requireFunction(runNegativeControls);
  const finalize = requireFunction(finalizeProjectAndSecrets);
  const removeSnapshot = requireFunction(cleanupSnapshot);
  const verify = requireFunction(verifyFinalSource);
  const publish = requireFunction(publishEvidence);
  const discard = requireFunction(discardEvidence);
  const diagnose = requireFunction(runFailureDiagnostics);
  if (typeof outputRoot !== "string" || typeof snapshot?.sourceRoot !== "string") {
    throw new TypeError("Recovery evidence publication boundary is invalid");
  }

  let stagedEvidence;
  let recoveryResult;
  let failure;
  let diagnosticsAttempted = false;

  async function recordFailure(cause, { diagnoseNow = true } = {}) {
    if (failure === undefined) failure = cause;
    if (diagnoseNow && !diagnosticsAttempted) {
      diagnosticsAttempted = true;
      try {
        await diagnose({
          outputRoot,
          snapshot,
          stagedEvidence,
          recoveryResult,
          cause: failure,
        });
      } catch (diagnosticFailure) {
        if (failure === undefined) failure = diagnosticFailure;
      }
    }
  }

  try {
    recoveryResult = await drill({ sourceRoot: snapshot.sourceRoot, snapshot });
    stagedEvidence = await stage({
      outputRoot,
      sourceRoot: snapshot.sourceRoot,
      snapshot,
      recoveryResult,
    });
    await negatives({
      outputRoot,
      sourceRoot: snapshot.sourceRoot,
      snapshot,
      recoveryResult,
      stageRoot: stagedEvidence.stageRoot,
      stagedEvidence,
    });
  } catch (cause) {
    await recordFailure(cause);
  }

  try {
    await finalize({ outputRoot, snapshot, stagedEvidence, recoveryResult });
  } catch (cause) {
    await recordFailure(cause);
  }

  try {
    await removeSnapshot({ sourceRoot: snapshot.sourceRoot, snapshot });
  } catch (cause) {
    await recordFailure(cause);
  }

  if (
    failure === undefined &&
    snapshot.producerIdentity?.verification === "draft" &&
    snapshot.producerIdentity?.releaseClaim === false
  ) {
    await discard({ outputRoot, stagedEvidence, snapshot, recoveryResult });
    return Object.freeze({
      version: "1",
      kind: "recovery-gate-draft",
      status: "draft",
      verification: "draft",
      releaseClaim: false,
    });
  }

  if (failure === undefined) {
    try {
      await verify({ outputRoot, snapshot, stagedEvidence, recoveryResult });
    } catch (cause) {
      await recordFailure(cause);
    }
  }

  let result;
  if (failure === undefined) {
    try {
      result = await publish({
        outputRoot,
        stageRoot: stagedEvidence.stageRoot,
        stagedEvidence,
        snapshot,
        recoveryResult,
      });
    } catch (cause) {
      await recordFailure(cause);
    }
  }

  if (failure !== undefined) {
    try {
      await discard({ outputRoot, stagedEvidence, snapshot, recoveryResult });
    } catch {
      // Preserve the first causal failure. Discard is best-effort only after
      // every scoped cleanup boundary has already been attempted.
    }
    throw failure;
  }
  return result;
}
