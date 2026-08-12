const RUN_ID = /^run_[0-9A-Z]{26}$/;
const PRODUCTION_RUN_ID = /^prod_[0-9A-Z]{26}$/;
const MANIFEST_SHA = /^sha256:[a-f0-9]{64}$/;

function failure(cause) {
  return Object.assign(new Error("PRODUCTION_PERSISTED_LIVE_GATE_FAILED: Production persisted live gate failed"), {
    code: "PRODUCTION_PERSISTED_LIVE_GATE_FAILED",
    cause,
  });
}

export async function runProductionPersistedLiveGate({
  productionRunId,
  manifestSha256s,
  chainId,
  signer,
  api,
}) {
  try {
    if (!PRODUCTION_RUN_ID.test(productionRunId ?? "") || chainId !== 114 ||
      !Array.isArray(manifestSha256s) || manifestSha256s.length !== 2 ||
      manifestSha256s.some((value) => !MANIFEST_SHA.test(value)) || manifestSha256s[0] === manifestSha256s[1] ||
      !/^0x[a-fA-F0-9]{40}$/.test(signer?.address ?? "")) {
      throw new Error("authority");
    }
    const challenge = await api.requestSiweChallenge({ version: "1", address: signer.address });
    if (typeof challenge?.challengeId !== "string" || typeof challenge.message !== "string" || !challenge.message.length) {
      throw new Error("challenge");
    }
    const signature = await signer.signSiweMessage(challenge.message);
    if (!/^0x[a-fA-F0-9]{130}$/.test(signature ?? "")) throw new Error("signature");
    const verified = await api.verifySiweSession({ version: "1", challengeId: challenge.challengeId, signature });
    if (typeof verified?.sessionId !== "string" || !verified.sessionId.length) throw new Error("session");
    const project = await api.createProject({ sessionId: verified.sessionId, label: `production-pilot-${productionRunId}` });
    if (typeof project?.projectId !== "string" || !project.projectId.length || typeof project.projectToken !== "string" || !project.projectToken.length) {
      throw new Error("project");
    }
    const runIds = [];
    for (const manifestSha256 of manifestSha256s) {
      const submitted = await api.submitPersistedRun({ productionRunId, manifestSha256, chainId, projectId: project.projectId, projectToken: project.projectToken });
      if (!RUN_ID.test(submitted?.runId ?? "")) throw new Error("submitted run");
      const persisted = await api.readPersistedRun({ runId: submitted.runId, projectId: project.projectId, projectToken: project.projectToken });
      if (persisted?.runId !== submitted.runId || persisted.stage !== "completed" || persisted.persisted !== true || persisted.manifestSha256 !== manifestSha256) {
        throw new Error("persisted run");
      }
      runIds.push(submitted.runId);
    }
    if (runIds[0] === runIds[1]) throw new Error("duplicate run");
    return Object.freeze({ status: "passed", chainId: 114, runIds, manifests: [...manifestSha256s], persisted: true });
  } catch (cause) {
    throw failure(cause);
  }
}
