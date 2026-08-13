import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OPEN_METEO = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const ETH_USD = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const outputPaths = Object.freeze({
  backupEvidenceFile: "/opt/orivra/evidence/recovery/backup-evidence.v1.json",
  replayBundleFile: "/opt/orivra/evidence/replay/proof-bundle.json",
  replayPreflightReportFile: "/opt/orivra/evidence/replay/preflight-report.json",
  browserAcceptanceFile: "/opt/orivra/evidence/browser/hosted-browser-acceptance.v1.json",
});

async function runtime() {
  return import("../../scripts/timeweb-production-bootstrap-runtime.mjs").catch(() => ({}));
}

async function workerBootstrapRuntime() {
  return import("../../apps/worker/src/production-replay-bootstrap-runtime.mjs").catch(() => ({}));
}

async function browserRuntime() {
  return import("../../scripts/timeweb-production-browser-acceptance.mjs").catch(() => ({}));
}

test("accepts ADR 0045 and freezes 029D without claiming publication or deployment", async () => {
  const [index, adr, slice, roadmap] = await Promise.all([
    readFile(resolve(root, "docs/adr/README.md"), "utf8"),
    readFile(resolve(root, "docs/adr/0045-phase-ordered-direct-production-bootstrap.md"), "utf8"),
    readFile(resolve(root, "docs/slices/029d-phase-ordered-direct-production-bootstrap.md"), "utf8"),
    readFile(resolve(root, "docs/development/product-roadmap.md"), "utf8"),
  ]);
  assert.match(index, /0045-phase-ordered-direct-production-bootstrap/);
  assert.match(adr, /Status: Accepted boundary; intentional RED/);
  assert.match(slice, /Status: Intentional RED/);
  assert.match(roadmap, /361bac3[\s\S]*obsolete undeployable images[\s\S]*must not be published/i);
  assert.doesNotMatch(`${adr}\n${slice}`, /hosted PASS|deployed PASS|production PASS/i);
});

test("exports one exact phase grammar and removes late outputs from static preflight authority", async () => {
  const module = await runtime();
  assert.deepEqual(module.STATIC_PREFLIGHT_IDS, [
    "dns-target", "ssh-host-key", "read-only-ghcr", "secret-files",
    "timeweb-s3-authority", "safe-consumer-manifests", "live-coston2",
  ]);
  assert.deepEqual(module.PRODUCTION_BOOTSTRAP_OUTPUTS, outputPaths);
  assert.deepEqual(module.PRODUCTION_BOOTSTRAP_PHASES, [
    "static-preflight", "start-postgres", "db-role-bootstrap", "migrator", "start-api",
    "safe-consumer-deployer", "seal-safe-consumer", "create-timeweb-backup",
    "seal-backup-evidence", "observe-wal-freshness", "timeweb-pitr", "authorize-retention",
    "replay-bootstrap", "seal-replay-pair", "deep-validate-replay-pair", "start-worker",
    "persisted-live-coston2", "start-web", "start-caddy-candidate", "activate-caddy",
    "external-browser-acceptance", "seal-browser-acceptance", "append-deployment-evidence",
  ]);
});

test("routes the production CLI and Compose wrapper through the phase-aware runtime", async () => {
  const [direct, compose, adapter] = await Promise.all([
    readFile(resolve(root, "scripts/digitalocean-production-promotion-runtime.mjs"), "utf8"),
    readFile(resolve(root, "scripts/compose-production.mjs"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-pilot-adapters.mjs"), "utf8"),
  ]);
  assert.match(direct, /timeweb-production-bootstrap-runtime\.mjs/);
  assert.match(direct, /runTimewebProductionBootstrapLifecycle\s*\(/);
  assert.match(compose, /timeweb-production-bootstrap-runtime\.mjs/);
  assert.match(compose, /validateProductionBootstrapPhaseInputs\s*\(/);
  assert.match(adapter, /PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT/);
  const staticIds = direct.match(/const directPreflightIds[\s\S]*?\]\);/)?.[0] ?? "";
  const staticFiles = direct.match(/const directFileKeys[\s\S]*?\]\);/)?.[0] ?? "";
  assert.doesNotMatch(staticIds, /replay-bundle|browser|backup/i);
  assert.doesNotMatch(staticFiles, /replayBundleFile|replayPreflightReportFile|backupEvidenceFile|browserAcceptance/i);
});

test("static preflight requires intended output paths absent and never reads their bytes", async () => {
  const module = await runtime();
  const reads = [];
  const result = await module.validateProductionBootstrapPhaseInputs({
    phase: "static-preflight",
    outputPaths,
    inspectPath: async (path) => { reads.push(path); return null; },
    readFile: async () => { throw new Error("late output read before creation"); },
  });
  assert.deepEqual(result, { phase: "static-preflight", outputs: "absent" });
  assert.deepEqual(reads, Object.values(outputPaths));
});

test("phase validation fails closed unless each consuming phase has its exact canonical inputs", async () => {
  const module = await runtime();
  const requirements = [
    ["timeweb-pitr", ["backupEvidenceFile"]],
    ["replay-bootstrap", ["backupEvidenceFile"]],
    ["start-worker", ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"]],
    ["external-browser-acceptance", ["backupEvidenceFile", "replayBundleFile", "replayPreflightReportFile"]],
    ["append-deployment-evidence", Object.keys(outputPaths)],
  ];
  for (const [phase, required] of requirements) {
    const inspected = [];
    await assert.rejects(module.validateProductionBootstrapPhaseInputs({
      phase, outputPaths,
      inspectPath: async (path) => {
        inspected.push(path);
        return path === outputPaths[required.at(-1)] ? null : { regular: true, mode: 0o400, size: 32, symlink: false };
      },
      validateCanonical: async () => true,
    }), /PRODUCTION_BOOTSTRAP_INPUT_INVALID/);
    assert.ok(inspected.includes(outputPaths[required.at(-1)]), phase);
  }
});

test("runs backup, WAL freshness, PITR and replay bootstrap before the ordinary worker", async () => {
  const module = await runtime();
  const calls = [];
  const result = await module.runTimewebProductionBootstrapLifecycle({
    outputPaths,
    execute: async (phase) => {
      calls.push(phase);
      if (phase === "observe-wal-freshness") return { status: "passed", archivePendingAgeSeconds: 30, switchedWalArchived: true };
      if (phase === "replay-bootstrap") return {
        status: "passed", chainId: 114, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
        sourceStage: "completed", manifestSha256: OPEN_METEO,
      };
      if (phase === "persisted-live-coston2") return {
        status: "persisted",
        runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"],
        manifests: [OPEN_METEO, ETH_USD],
      };
      return { status: "passed" };
    },
  });
  assert.equal(result.status, "canary-pending");
  assert.deepEqual(calls, module.PRODUCTION_BOOTSTRAP_PHASES);
  assert.ok(calls.indexOf("seal-backup-evidence") < calls.indexOf("timeweb-pitr"));
  assert.ok(calls.indexOf("observe-wal-freshness") < calls.indexOf("authorize-retention"));
  assert.ok(calls.indexOf("seal-replay-pair") < calls.indexOf("start-worker"));
  assert.ok(calls.indexOf("persisted-live-coston2") < calls.indexOf("activate-caddy"));
  assert.ok(calls.indexOf("external-browser-acceptance") < calls.indexOf("append-deployment-evidence"));
});

test("replay bootstrap is production-only, bounded and cannot import a test adapter or generic worker bypass", async () => {
  const module = await runtime();
  const source = await readFile(resolve(root, "apps/worker/src/production-replay-bootstrap.ts"), "utf8").catch(() => "");
  assert.equal(typeof module.validateProductionReplayBootstrapResult, "function");
  assert.deepEqual(module.validateProductionReplayBootstrapResult({
    status: "passed", chainId: 114, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    sourceStage: "completed", manifestSha256: OPEN_METEO,
  }), {
    status: "passed", chainId: 114, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    sourceStage: "completed", manifestSha256: OPEN_METEO,
  });
  for (const invalid of [
    { status: "passed", chainId: 1, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", sourceStage: "completed", manifestSha256: OPEN_METEO },
    { status: "passed", chainId: 114, sourceRunId: "fixture", sourceStage: "completed", manifestSha256: OPEN_METEO },
    { status: "passed", chainId: 114, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", sourceStage: "pending", manifestSha256: OPEN_METEO },
    { status: "passed", chainId: 114, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", sourceStage: "completed", manifestSha256: `sha256:${"0".repeat(64)}` },
  ]) assert.throws(() => module.validateProductionReplayBootstrapResult(invalid), /PRODUCTION_REPLAY_BOOTSTRAP_INVALID/);
  assert.match(source, /production-replay-bootstrap/);
  assert.doesNotMatch(source, /NODE_ENV|test-adapter|fixture|startOrdinaryWorker|bypass/i);
});

test("replay bootstrap uses only the live worker plus persisted API path and exports the same run-bound pair", async () => {
  const module = await workerBootstrapRuntime();
  const calls = [];
  const runId = "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4";
  const bundleBytes = Buffer.from('{"kind":"proof-bundle-v1","runId":"run_01K2Q4P6R8T0V2X4Z6B8D0F2H4"}', "utf8");
  const reportBytes = Buffer.from('{"kind":"preflight-report-v1","runId":"run_01K2Q4P6R8T0V2X4Z6B8D0F2H4"}', "utf8");
  const result = await module.runProductionReplayBootstrap({
    chainId: 114,
    manifestSha256: OPEN_METEO,
    deadlineMs: 120_000,
    ports: {
      authenticateApiSession: async () => { calls.push("authenticate-api"); return { status: "authenticated" }; },
      createApiProject: async () => { calls.push("create-project"); return { status: "created", projectId: "project_01K2Q4P6R8T0V2X4Z6B8D0F2H4" }; },
      submitPersistedRun: async (input) => { calls.push("submit-run"); assert.equal(input.manifestSha256, OPEN_METEO); return { runId }; },
      processWorkerCommand: async (input) => { calls.push("process-worker-command"); assert.equal(input.runId, runId); return { status: "completed", runId, manifestSha256: OPEN_METEO }; },
      readPersistedRun: async () => { calls.push("read-run"); return { stage: "completed", runId, manifestSha256: OPEN_METEO }; },
      exportPersistedBundle: async () => { calls.push("export-bundle"); return { runId, manifestSha256: OPEN_METEO, bytes: bundleBytes }; },
      exportPersistedPreflightReport: async () => { calls.push("export-preflight"); return { runId, manifestSha256: OPEN_METEO, bytes: reportBytes }; },
      stageCanonicalPair: async (pair) => { calls.push("stage-pair"); assert.deepEqual(pair, { runId, manifestSha256: OPEN_METEO, bundleBytes, reportBytes }); return { status: "staged" }; },
      loadReplayBundle: async () => { throw new Error("ordinary replay loader is unavailable"); },
      loadReplayPreflightReport: async () => { throw new Error("ordinary replay loader is unavailable"); },
      handleReplayCommand: async () => { throw new Error("ordinary replay handler is unavailable"); },
    },
  });
  assert.deepEqual(calls, ["authenticate-api", "create-project", "submit-run", "process-worker-command", "read-run", "export-bundle", "export-preflight", "stage-pair"]);
  assert.deepEqual(result, {
    status: "passed", chainId: 114, sourceRunId: runId, sourceStage: "completed",
    manifestSha256: OPEN_METEO,
    bundleSha256: `sha256:${createHash("sha256").update(bundleBytes).digest("hex")}`,
    reportSha256: `sha256:${createHash("sha256").update(reportBytes).digest("hex")}`,
  });
});

test("produces canonical desktop/mobile browser acceptance only after public activation", async () => {
  const module = await browserRuntime();
  const calls = [];
  const result = await module.runProductionHostedBrowserAcceptance({
    activation: { status: "passed", publicOrigin: "https://orivra.xyz", activatedAt: "2026-08-13T03:00:00Z" },
    outputPath: outputPaths.browserAcceptanceFile,
    browserAdapter: {
      desktop: async () => { calls.push("desktop"); return { status: "passed" }; },
      mobile: async () => { calls.push("mobile"); return { status: "passed" }; },
      keyboard: async () => { calls.push("keyboard"); return { status: "passed" }; },
      accessibility: async () => { calls.push("axe"); return { seriousCritical: 0 }; },
      consoleAndNetwork: async () => { calls.push("console-network"); return { consoleErrors: 0, networkErrors: 0 }; },
      reloadBackForward: async () => { calls.push("reload-back-forward"); return { status: "passed" }; },
    },
    appendNoReplace: async ({ path, bytes }) => {
      calls.push("append-browser");
      assert.equal(path, outputPaths.browserAcceptanceFile);
      assert.deepEqual(JSON.parse(bytes.toString("utf8")).checks, {
        desktop: "passed", mobile: "passed", keyboard: "passed",
        axeSeriousCritical: 0, consoleErrors: 0, networkErrors: 0,
        reloadBackForward: "passed",
      });
      return { status: "passed", mode: 0o400, noReplace: true };
    },
  });
  assert.deepEqual(calls, ["desktop", "mobile", "keyboard", "axe", "console-network", "reload-back-forward", "append-browser"]);
  assert.equal(result.status, "passed");
  assert.match(result.sha256, /^sha256:[a-f0-9]{64}$/);
});

test("allows absent late outputs only for exact early Compose phases and blocks consumers before Docker", async () => {
  const compose = await import("../../scripts/compose-production.mjs");
  const early = ["postgres", "db-role-bootstrap", "migrator", "api", "safe-consumer-deployer"];
  const dockerCalls = [];
  await compose.runPhaseAwareProductionCompose({
    services: early,
    outputPaths,
    inspectPath: async () => null,
    runDocker: async (services) => { dockerCalls.push(services); return { status: 0 }; },
  });
  assert.deepEqual(dockerCalls, [early]);
  for (const services of [["timeweb-pitr"], ["replay-bootstrap"], ["worker"], ["canary"], []]) {
    let effects = 0;
    await assert.rejects(compose.runPhaseAwareProductionCompose({
      services, outputPaths,
      inspectPath: async () => null,
      runDocker: async () => { effects += 1; },
    }), /PRODUCTION_BOOTSTRAP_INPUT_INVALID/);
    assert.equal(effects, 0, services.join(",") || "generic up");
  }
});

test("seals canonical bootstrap artifacts atomically and never follows a symlink", async (t) => {
  const module = await runtime();
  const temporary = await mkdtemp(join(tmpdir(), "proofline-029d-"));
  t.after(async () => { await chmod(temporary, 0o700).catch(() => {}); await rm(temporary, { recursive: true, force: true }); });
  const stage = join(temporary, "stage");
  const output = join(temporary, "evidence");
  await mkdir(stage, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  await writeFile(join(stage, "proof-bundle.json"), '{"bundle":"canonical"}', { mode: 0o400 });
  await writeFile(join(stage, "preflight-report.json"), '{"report":"canonical"}', { mode: 0o400 });
  const sealed = await module.sealProductionReplayArtifacts({
    stagingRoot: stage, outputRoot: output,
    validateBundle: (bytes) => bytes.toString("utf8") === '{"bundle":"canonical"}',
    validateReport: (bytes) => bytes.toString("utf8") === '{"report":"canonical"}',
  });
  assert.deepEqual(Object.keys(sealed).sort(), ["bundleSha256", "reportSha256"]);
  for (const name of ["proof-bundle.json", "preflight-report.json"]) {
    const status = await lstat(join(output, name));
    assert.equal(status.isFile(), true);
    assert.equal(status.mode & 0o777, 0o400);
  }
  const outside = join(temporary, "outside");
  await writeFile(outside, "sentinel", { mode: 0o600 });
  const malicious = join(temporary, "malicious");
  await mkdir(malicious, { mode: 0o700 });
  await symlink(outside, join(malicious, "proof-bundle.json"));
  await writeFile(join(malicious, "preflight-report.json"), "{}", { mode: 0o400 });
  const blocked = join(temporary, "blocked");
  await assert.rejects(module.sealProductionReplayArtifacts({ stagingRoot: malicious, outputRoot: blocked }), /PRODUCTION_BOOTSTRAP_ARTIFACT_INVALID/);
  await assert.rejects(lstat(blocked), { code: "ENOENT" });
  assert.equal(await readFile(outside, "utf8"), "sentinel");

  const occupied = join(temporary, "occupied");
  await mkdir(occupied, { mode: 0o700 });
  await writeFile(join(occupied, "proof-bundle.json"), "caller-owned", { mode: 0o400 });
  await assert.rejects(module.sealProductionReplayArtifacts({ stagingRoot: stage, outputRoot: occupied }), /PRODUCTION_BOOTSTRAP_ARTIFACT_EXISTS/);
  assert.equal(await readFile(join(occupied, "proof-bundle.json"), "utf8"), "caller-owned");
});

test("rolls public Caddy back before closing the pinned session on every post-activation failure", async () => {
  const module = await runtime();
  for (const failingPhase of ["external-browser-acceptance", "seal-browser-acceptance", "append-deployment-evidence"]) {
    const calls = [];
    await assert.rejects(module.runTimewebProductionBootstrapLifecycle({
      outputPaths,
      execute: async (phase) => {
        calls.push(phase);
        if (phase === failingPhase) throw new Error(`failed ${phase}`);
        if (phase === "observe-wal-freshness") return { status: "passed", archivePendingAgeSeconds: 30, switchedWalArchived: true };
        if (phase === "replay-bootstrap") return { status: "passed", chainId: 114, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", sourceStage: "completed", manifestSha256: OPEN_METEO };
        if (phase === "persisted-live-coston2") return { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO, ETH_USD] };
        return { status: "passed" };
      },
      rollbackCaddy: async () => calls.push("rollback-caddy"),
      closeSession: async () => calls.push("close-session"),
    }), /PRODUCTION_BOOTSTRAP_FAILED/);
    assert.deepEqual(calls.slice(-2), ["rollback-caddy", "close-session"], failingPhase);
    assert.equal(calls.includes("append-deployment-evidence") && failingPhase !== "append-deployment-evidence", false);
  }
});

test("publishes no deployment evidence after any producer, seal or validation failure", async () => {
  const module = await runtime();
  const failures = [
    "create-timeweb-backup", "seal-backup-evidence", "observe-wal-freshness", "timeweb-pitr",
    "replay-bootstrap", "seal-replay-pair", "deep-validate-replay-pair",
    "external-browser-acceptance", "seal-browser-acceptance", "append-deployment-evidence",
  ];
  for (const failingPhase of failures) {
    const calls = [];
    await assert.rejects(module.runTimewebProductionBootstrapLifecycle({
      outputPaths,
      execute: async (phase) => {
        calls.push(phase);
        if (phase === failingPhase) throw new Error(`failed ${phase}`);
        if (phase === "observe-wal-freshness") return { status: "passed", archivePendingAgeSeconds: 30, switchedWalArchived: true };
        if (phase === "replay-bootstrap") return { status: "passed", chainId: 114, sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", sourceStage: "completed", manifestSha256: OPEN_METEO };
        if (phase === "persisted-live-coston2") return { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO, ETH_USD] };
        return { status: "passed" };
      },
      rollbackCaddy: async () => calls.push("rollback-caddy"),
      closeSession: async () => calls.push("close-session"),
    }), /PRODUCTION_BOOTSTRAP_FAILED/);
    assert.equal(calls.filter((entry) => entry === "append-deployment-evidence").length, failingPhase === "append-deployment-evidence" ? 1 : 0, failingPhase);
    if (["external-browser-acceptance", "seal-browser-acceptance", "append-deployment-evidence"].includes(failingPhase)) {
      assert.deepEqual(calls.slice(-2), ["rollback-caddy", "close-session"], failingPhase);
    } else {
      assert.equal(calls.includes("rollback-caddy"), false, failingPhase);
      assert.equal(calls.at(-1), "close-session", failingPhase);
    }
  }
});
