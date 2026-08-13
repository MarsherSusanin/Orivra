import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const STATIC_PREFLIGHT_IDS = Object.freeze([
  "dns-target",
  "ssh-host-key",
  "read-only-ghcr",
  "secret-files",
  "timeweb-s3-authority",
  "safe-consumer-manifests",
  "live-coston2",
]);

export const PRODUCTION_BOOTSTRAP_OUTPUTS = Object.freeze({
  backupEvidenceFile: "/opt/orivra/evidence/recovery/backup-evidence.v1.json",
  replayBundleFile: "/opt/orivra/evidence/replay/proof-bundle.json",
  replayPreflightReportFile: "/opt/orivra/evidence/replay/preflight-report.json",
  browserAcceptanceFile: "/opt/orivra/evidence/browser/hosted-browser-acceptance.v1.json",
});

export const PRODUCTION_BOOTSTRAP_PHASES = Object.freeze([
  "static-preflight",
  "start-postgres",
  "db-role-bootstrap",
  "migrator",
  "start-api",
  "safe-consumer-deployer",
  "seal-safe-consumer",
  "create-timeweb-backup",
  "seal-backup-evidence",
  "observe-wal-freshness",
  "timeweb-pitr",
  "authorize-retention",
  "replay-bootstrap",
  "seal-replay-pair",
  "deep-validate-replay-pair",
  "start-worker",
  "persisted-live-coston2",
  "start-web",
  "start-caddy-candidate",
  "activate-caddy",
  "external-browser-acceptance",
  "seal-browser-acceptance",
  "append-deployment-evidence",
]);

const OUTPUT_KEYS = Object.freeze(Object.keys(PRODUCTION_BOOTSTRAP_OUTPUTS));
const OPEN_METEO_REPLAY = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const OPEN_METEO_RELAYER = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_USD_RELAYER = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const RUN_ID = /^run_[0-9A-Z]{26}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BUNDLE_MAXIMUM = 2_200_000;
const REPORT_MAXIMUM = 65_536;

const PHASE_REQUIREMENTS = Object.freeze({
  "timeweb-pitr": ["backupEvidenceFile"],
  "authorize-retention": ["backupEvidenceFile"],
  "replay-bootstrap": ["backupEvidenceFile"],
  "seal-replay-pair": ["backupEvidenceFile"],
  "deep-validate-replay-pair": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "start-worker": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "persisted-live-coston2": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "start-web": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "start-caddy-candidate": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "activate-caddy": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "external-browser-acceptance": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "seal-browser-acceptance": ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"],
  "append-deployment-evidence": OUTPUT_KEYS,
});

function failure(code, cause) {
  return Object.assign(new Error(`${code}: Production bootstrap is invalid`), { code, cause });
}

function exactOutputPaths(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    OUTPUT_KEYS.every((key) => value[key] === PRODUCTION_BOOTSTRAP_OUTPUTS[key]) &&
    Object.keys(value).length === OUTPUT_KEYS.length;
}

function isRegularPrivate(status) {
  if (!status) return false;
  const regular = typeof status.isFile === "function" ? status.isFile() : status.regular === true;
  const symbolic = typeof status.isSymbolicLink === "function" ? status.isSymbolicLink() : status.symlink === true;
  return regular && !symbolic && (status.mode & 0o777) === 0o400 &&
    Number.isSafeInteger(status.size) && status.size > 0;
}

export async function validateProductionBootstrapPhaseInputs({
  phase,
  outputPaths = PRODUCTION_BOOTSTRAP_OUTPUTS,
  inspectPath = lstat,
  validateCanonical,
} = {}) {
  try {
    if (!PRODUCTION_BOOTSTRAP_PHASES.includes(phase) || !exactOutputPaths(outputPaths) || typeof inspectPath !== "function") {
      throw new Error("authority");
    }
    if (phase === "static-preflight") {
      for (const path of Object.values(outputPaths)) {
        const status = await inspectPath(path).catch((cause) => {
          if (cause?.code === "ENOENT") return null;
          throw cause;
        });
        if (status !== null) throw new Error("late output exists");
      }
      return Object.freeze({ phase, outputs: "absent" });
    }
    const requirements = PHASE_REQUIREMENTS[phase] ?? [];
    for (const key of requirements) {
      const path = outputPaths[key];
      const status = await inspectPath(path).catch((cause) => {
        if (cause?.code === "ENOENT") return null;
        throw cause;
      });
      if (!isRegularPrivate(status)) throw new Error(`missing ${key}`);
      if (validateCanonical && await validateCanonical({ key, path, status }) !== true) {
        throw new Error(`invalid ${key}`);
      }
    }
    return Object.freeze({ phase, inputs: "verified", required: Object.freeze([...requirements]) });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_BOOTSTRAP_INPUT_INVALID") throw cause;
    throw failure("PRODUCTION_BOOTSTRAP_INPUT_INVALID", cause);
  }
}

export function validateProductionReplayBootstrapResult(value) {
  if (!value || value.status !== "passed" || value.chainId !== 114 ||
    !RUN_ID.test(value.sourceRunId ?? "") || value.sourceStage !== "completed" ||
    value.sourceLiveManifestSha256 !== OPEN_METEO_RELAYER ||
    value.replayManifestSha256 !== OPEN_METEO_REPLAY) {
    throw failure("PRODUCTION_REPLAY_BOOTSTRAP_INVALID");
  }
  const result = {
    status: "passed",
    chainId: 114,
    sourceRunId: value.sourceRunId,
    sourceStage: "completed",
    sourceLiveManifestSha256: OPEN_METEO_RELAYER,
    replayManifestSha256: OPEN_METEO_REPLAY,
  };
  if (value.bundleSha256 !== undefined || value.reportSha256 !== undefined) {
    if (!SHA256.test(value.bundleSha256 ?? "") || !SHA256.test(value.reportSha256 ?? "")) {
      throw failure("PRODUCTION_REPLAY_BOOTSTRAP_INVALID");
    }
    Object.assign(result, { bundleSha256: value.bundleSha256, reportSha256: value.reportSha256 });
  }
  return Object.freeze(result);
}

async function readPrivateStageFile(path, maximum) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile() || (status.mode & 0o777) !== 0o400 || status.size < 1 || status.size > maximum) {
      throw new Error("metadata");
    }
    const bytes = Buffer.alloc(status.size);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== bytes.length) throw new Error("short read");
    return bytes;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function publishNoReplace(path, bytes) {
  const stage = `${path}.stage-${process.pid}-${Date.now()}`;
  let staged = false;
  try {
    const handle = await open(stage, "wx", 0o600);
    staged = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(stage, 0o400);
    await link(stage, path);
  } finally {
    if (staged) await rm(stage, { force: true });
  }
}

export async function sealProductionReplayArtifacts({
  stagingRoot,
  outputRoot,
  validateBundle,
  validateReport,
} = {}) {
  const created = [];
  let createdRoot = false;
  try {
    if (typeof stagingRoot !== "string" || typeof outputRoot !== "string" ||
      resolve(stagingRoot) !== stagingRoot || resolve(outputRoot) !== outputRoot || stagingRoot === outputRoot) {
      throw new Error("authority");
    }
    const stageStatus = await lstat(stagingRoot);
    if (!stageStatus.isDirectory() || stageStatus.isSymbolicLink() || (stageStatus.mode & 0o777) !== 0o700) {
      throw new Error("staging root");
    }
    const sources = [
      ["proof-bundle.json", BUNDLE_MAXIMUM, validateBundle],
      ["preflight-report.json", REPORT_MAXIMUM, validateReport],
    ];
    const loaded = [];
    for (const [name, maximum, validate] of sources) {
      const bytes = await readPrivateStageFile(resolve(stagingRoot, name), maximum);
      if (validate && await validate(bytes) !== true) throw new Error(`invalid ${name}`);
      loaded.push([name, bytes]);
    }
    let rootStatus = await lstat(outputRoot).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    if (rootStatus === null) {
      await mkdir(outputRoot, { mode: 0o700 });
      createdRoot = true;
      rootStatus = await lstat(outputRoot);
    }
    if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink() || (rootStatus.mode & 0o777) !== 0o700) {
      throw new Error("output root");
    }
    const entries = await readdir(outputRoot);
    if (entries.length !== 0) throw failure("PRODUCTION_BOOTSTRAP_ARTIFACT_EXISTS");
    for (const [name, bytes] of loaded) {
      const path = resolve(outputRoot, name);
      await publishNoReplace(path, bytes);
      created.push(path);
    }
    return Object.freeze({
      bundleSha256: `sha256:${createHash("sha256").update(loaded[0][1]).digest("hex")}`,
      reportSha256: `sha256:${createHash("sha256").update(loaded[1][1]).digest("hex")}`,
    });
  } catch (cause) {
    for (const path of created.reverse()) await rm(path, { force: true }).catch(() => undefined);
    if (createdRoot) await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined);
    if (cause?.code === "PRODUCTION_BOOTSTRAP_ARTIFACT_EXISTS") throw cause;
    throw failure("PRODUCTION_BOOTSTRAP_ARTIFACT_INVALID", cause);
  }
}

function validateLifecycleObservation(phase, value) {
  if (!value || !["passed", "persisted"].includes(value.status)) throw new Error(`failed ${phase}`);
  if (phase === "observe-wal-freshness" &&
    (value.switchedWalArchived !== true || !Number.isSafeInteger(value.archivePendingAgeSeconds) ||
      value.archivePendingAgeSeconds < 0 || value.archivePendingAgeSeconds > 60)) {
    throw new Error("WAL freshness");
  }
  if (phase === "replay-bootstrap") validateProductionReplayBootstrapResult(value);
  if (phase === "persisted-live-coston2" &&
    (!Array.isArray(value.runIds) || value.runIds.length !== 2 || value.runIds[0] === value.runIds[1] ||
      value.runIds.some((runId) => !RUN_ID.test(runId)) ||
      JSON.stringify(value.manifests) !== JSON.stringify([OPEN_METEO_RELAYER, ETH_USD_RELAYER]))) {
    throw new Error("live runs");
  }
  return value;
}

export function validateProductionDeploymentBrowserBinding({ browserReceipt, cutover } = {}) {
  if (browserReceipt?.id !== "append-browser-acceptance" || browserReceipt.status !== "passed" ||
    !SHA256.test(browserReceipt.sha256 ?? "") || cutover?.status !== "passed" ||
    cutover.publicOrigin !== "https://orivra.xyz" || !Number.isFinite(Date.parse(cutover.activatedAt)) ||
    cutover.browserAcceptanceSha256 !== browserReceipt.sha256) {
    throw failure("PRODUCTION_BROWSER_EVIDENCE_INVALID");
  }
  return browserReceipt.sha256;
}

export async function runTimewebProductionBootstrapLifecycle({
  outputPaths = PRODUCTION_BOOTSTRAP_OUTPUTS,
  execute,
  rollbackCaddy,
  closeSession,
} = {}) {
  let activated = false;
  let browserAcceptanceSha256;
  let failureCause;
  try {
    if (!exactOutputPaths(outputPaths) || typeof execute !== "function") throw new Error("authority");
    for (const phase of PRODUCTION_BOOTSTRAP_PHASES) {
      let rawObservation;
      try {
        rawObservation = await execute(phase, Object.freeze({ browserAcceptanceSha256 }));
      } catch (cause) {
        if (phase === "activate-caddy" && cause?.cutoverApplied === true) activated = true;
        throw cause;
      }
      const observed = validateLifecycleObservation(phase, rawObservation);
      if (phase === "activate-caddy") activated = true;
      if (phase === "seal-browser-acceptance") {
        browserAcceptanceSha256 = validateProductionDeploymentBrowserBinding({
          browserReceipt: observed,
          cutover: { status: "passed", publicOrigin: "https://orivra.xyz", activatedAt: "1970-01-01T00:00:00Z",
            browserAcceptanceSha256: observed.sha256 },
        });
      }
      if (phase === "append-deployment-evidence" && observed.status !== "passed") throw new Error("deployment evidence");
    }
    return Object.freeze({ status: "canary-pending", browserAcceptanceSha256 });
  } catch (cause) {
    failureCause = failure("PRODUCTION_BOOTSTRAP_FAILED", cause);
  } finally {
    const cleanup = [];
    if (failureCause && activated && typeof rollbackCaddy === "function") {
      try { await rollbackCaddy(); } catch (cause) { cleanup.push(cause); }
    }
    if (typeof closeSession === "function") {
      try { await closeSession(); } catch (cause) { cleanup.push(cause); }
    }
    if (failureCause && cleanup.length) {
      failureCause = new AggregateError([failureCause, ...cleanup], "Production bootstrap and cleanup failed", { cause: failureCause });
    }
  }
  throw failureCause;
}
