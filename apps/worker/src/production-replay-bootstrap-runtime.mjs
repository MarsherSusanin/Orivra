import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
// The concrete production port invokes verifyProductionRelayerReplayAlias before staging.

const OPEN_METEO_REPLAY = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const OPEN_METEO_RELAYER = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const RUN_ID = /^(?:run_[0-9A-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function failure(cause) {
  return Object.assign(new Error("PRODUCTION_REPLAY_BOOTSTRAP_INVALID: Production replay bootstrap is invalid"), {
    code: "PRODUCTION_REPLAY_BOOTSTRAP_INVALID",
    cause,
  });
}

function runScopeFailure(cause) {
  return Object.assign(new Error("PRODUCTION_REPLAY_BOOTSTRAP_RUN_SCOPE_INVALID: Production replay bootstrap run scope is invalid"), {
    code: "PRODUCTION_REPLAY_BOOTSTRAP_RUN_SCOPE_INVALID",
    cause,
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalUrl(manifest) {
  const source = new URL(manifest?.request?.url);
  const query = new URLSearchParams(source.search);
  for (const [key, value] of Object.entries(manifest?.request?.query ?? {})) query.set(key, value);
  const sorted = new URLSearchParams();
  for (const key of [...new Set(query.keys())].sort()) sorted.set(key, query.get(key));
  return `https://${source.hostname.toLowerCase().replace(/\.+$/, "")}${source.pathname}${sorted.size ? `?${sorted}` : ""}`;
}

export async function validateAndStageProductionReplayBootstrapArtifacts(input = {}) {
  try {
    if (!input.sourceRun || !Buffer.isBuffer(input.bundleBytes) || !Buffer.isBuffer(input.reportBytes) ||
      typeof input.parseBundle !== "function" || typeof input.parseReport !== "function" ||
      typeof input.verifyAlias !== "function" || typeof input.stageCanonicalPair !== "function") throw new Error("ports");
    const bundle = input.parseBundle(input.bundleBytes);
    const report = input.parseReport(input.reportBytes);
    if (!RUN_ID.test(input.sourceRun.runId ?? "") || input.sourceRun.stage !== "completed" ||
      input.sourceRun.proofVerified !== true || input.sourceRun.manifestSha256 !== input.relayerManifestSha256 ||
      bundle?.runId !== input.sourceRun.runId || !isDeepStrictEqual(bundle?.manifest, input.relayerManifest) ||
      report?.runId !== input.sourceRun.runId || report?.canonicalUrl !== canonicalUrl(input.relayerManifest)) {
      throw new Error("cross binding");
    }
    const alias = await input.verifyAlias({
      run: { ...input.sourceRun, request: bundle.manifest.request, consumer: bundle.manifest.consumer },
      relayerManifest: bundle.manifest,
      relayerManifestSha256: input.relayerManifestSha256,
      replayManifest: input.replayManifest,
      replayManifestSha256: input.replayManifestSha256,
      relayerConsumerIdentity: input.consumerIdentity,
      replayConsumerIdentity: input.consumerIdentity,
      rawRelayerBundle: { runId: bundle.runId, manifestSha256: input.relayerManifestSha256 },
      rawRelayerPreflight: { runId: report.runId, manifestSha256: input.relayerManifestSha256 },
    });
    if (alias?.sourceLiveManifestSha256 !== input.relayerManifestSha256 ||
      alias?.replayManifestSha256 !== input.replayManifestSha256) {
      throw new Error("alias");
    }
    const staged = await input.stageCanonicalPair({
      runId: bundle.runId,
      replayManifestSha256: input.replayManifestSha256,
      bundleBytes: input.bundleBytes,
      reportBytes: input.reportBytes,
    });
    if (staged?.status !== "staged") throw new Error("stage");
    return Object.freeze({ runId: bundle.runId, bundleBytes: input.bundleBytes, reportBytes: input.reportBytes });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_REPLAY_BOOTSTRAP_INVALID") throw cause;
    throw failure(cause);
  }
}

export function createRunScopedReplayBootstrapRepository({ repository } = {}) {
  let activeRunId;
  return Object.freeze({
    ...repository,
    activateRun(runId) {
      if (activeRunId !== undefined || !RUN_ID.test(runId ?? "")) throw runScopeFailure(new Error("run scope"));
      activeRunId = runId;
    },
    async claimNextCommand() {
      if (!activeRunId || typeof repository?.claimNextCommandForRun !== "function") throw runScopeFailure(new Error("run scope"));
      const claimed = await repository.claimNextCommandForRun(activeRunId);
      if (claimed !== null && claimed?.command?.runId !== activeRunId) throw runScopeFailure(new Error("foreign command"));
      return claimed;
    },
  });
}

export async function runProductionReplayBootstrap({ chainId, relayerManifestSha256, replayManifestSha256, deadlineMs, ports } = {}) {
  try {
    if (chainId !== 114 || relayerManifestSha256 !== OPEN_METEO_RELAYER || replayManifestSha256 !== OPEN_METEO_REPLAY || !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1_000 || deadlineMs > 1_800_000 || !ports ||
      ["authenticateApiSession", "createApiProject", "submitPersistedRun", "processWorkerCommand",
        "readPersistedRun", "exportPersistedBundle", "exportPersistedPreflightReport", "verifyRelayerReplayAlias", "stageCanonicalPair"]
        .some((name) => typeof ports[name] !== "function")) {
      throw new Error("authority");
    }
    const started = Date.now();
    const session = await ports.authenticateApiSession({ chainId: 114 });
    if (session?.status !== "authenticated") throw new Error("session");
    const project = await ports.createApiProject({ session });
    if (project?.status !== "created" || typeof project.projectId !== "string" || !project.projectId.length) {
      throw new Error("project");
    }
    const submitted = await ports.submitPersistedRun({ session, project, manifestSha256: OPEN_METEO_RELAYER, chainId: 114 });
    if (!RUN_ID.test(submitted?.runId ?? "")) throw new Error("run");
    if (Date.now() - started > deadlineMs) throw new Error("deadline");
    const processed = await ports.processWorkerCommand({ runId: submitted.runId, manifestSha256: OPEN_METEO_RELAYER, deadlineMs });
    if (processed?.status !== "completed" || processed.runId !== submitted.runId || processed.manifestSha256 !== OPEN_METEO_RELAYER) {
      throw new Error("worker");
    }
    const persisted = await ports.readPersistedRun({ session, project, runId: submitted.runId });
    if (persisted?.stage !== "completed" || persisted?.proofVerified !== true || persisted.runId !== submitted.runId || persisted.manifestSha256 !== OPEN_METEO_RELAYER) {
      throw new Error("persisted run");
    }
    const [bundle, report] = await Promise.all([
      ports.exportPersistedBundle({ session, project, runId: submitted.runId }),
      ports.exportPersistedPreflightReport({ session, project, runId: submitted.runId }),
    ]);
    for (const value of [bundle, report]) {
      if (value?.runId !== submitted.runId || value.manifestSha256 !== OPEN_METEO_RELAYER ||
        !Buffer.isBuffer(value.bytes) || value.bytes.length < 1) throw new Error("evidence binding");
    }
    if (bundle.bytes.length > 2_200_000 || report.bytes.length > 65_536) throw new Error("evidence bound");
    const verified = await ports.verifyRelayerReplayAlias({
      sourceRun: persisted,
      sourceLiveManifestSha256: OPEN_METEO_RELAYER,
      replayManifestSha256: OPEN_METEO_REPLAY,
      bundleBytes: bundle.bytes,
      reportBytes: report.bytes,
    });
    if (verified?.runId !== submitted.runId || verified.replayManifestSha256 !== OPEN_METEO_REPLAY ||
      !Buffer.isBuffer(verified.bundleBytes) || !Buffer.isBuffer(verified.reportBytes)) throw new Error("replay alias");
    if (verified.staged !== true) {
      const staged = await ports.stageCanonicalPair({
        runId: submitted.runId,
        replayManifestSha256: OPEN_METEO_REPLAY,
        bundleBytes: verified.bundleBytes,
        reportBytes: verified.reportBytes,
      });
      if (staged?.status !== "staged") throw new Error("stage");
    }
    return Object.freeze({
      status: "passed",
      chainId: 114,
      sourceRunId: submitted.runId,
      sourceStage: "completed",
      sourceLiveManifestSha256: OPEN_METEO_RELAYER,
      replayManifestSha256: OPEN_METEO_REPLAY,
      bundleSha256: sha256(verified.bundleBytes),
      reportSha256: sha256(verified.reportBytes),
    });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_REPLAY_BOOTSTRAP_INVALID") throw cause;
    throw failure(cause);
  }
}
