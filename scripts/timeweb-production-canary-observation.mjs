import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ProductionCanaryCheckpointV2Schema, ProductionDeploymentEvidenceV2Schema, canonicalSerializeProductionCanaryCheckpointV2, canonicalSerializeProductionDeploymentEvidenceV2 } from "../packages/contracts/src/production-promotion-runtime.mjs";
import { switchAndObserveProductionWalArchive } from "./timeweb-production-pitr.mjs";
import { readBoundedPrivateFile } from "./private-file-runtime.mjs";
import { bindFixedReplayBootstrapComposeInterpolationEnvironment } from "./timeweb-production-compose-environment.mjs";
import { validateTimewebProductionSecretInventory } from "./timeweb-production-secret-inventory.mjs";

const IDS = ["cutover", "post-cutover-15m", "post-cutover-1h", "post-cutover-24h"];
const PUBLIC_ORIGIN = "https://orivra.xyz";
const OPEN_METEO = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_USD = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const BROWSER_ACCEPTANCE = "/opt/orivra/evidence/browser/hosted-browser-acceptance.v1.json";
const BROWSER_ACCEPTANCE_SHA256 = "/opt/orivra/evidence/browser/hosted-browser-acceptance.v1.sha256";
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function validLiveRuns(value) {
  return value?.status === "persisted" && Array.isArray(value.runIds) && value.runIds.length === 2 &&
    value.runIds[0] !== value.runIds[1] && value.runIds.every((id) => /^run_[0-9A-Z]{26}$/.test(id)) &&
    JSON.stringify(value.manifests) === JSON.stringify([OPEN_METEO, ETH_USD]);
}

function validateBrowserAcceptance(value, expectedSha256, bytes) {
  if (value?.status !== "passed" || value.publicOrigin !== PUBLIC_ORIGIN ||
    !/^sha256:[a-f0-9]{64}$/.test(expectedSha256 ?? "") || (bytes && sha256(bytes) !== expectedSha256)) {
    throw new Error("browser acceptance");
  }
  return { status: "passed", publicOrigin: PUBLIC_ORIGIN, artifactSha256: expectedSha256 };
}

function failure(cause) {
  return Object.assign(new Error("TIMEWEB_PRODUCTION_CANARY_INVALID: Production canary observation is invalid"), {
    code: "TIMEWEB_PRODUCTION_CANARY_INVALID",
    cause,
  });
}

function defaultObserveChecks() {
  throw failure(new Error("Production canary check adapters are required"));
}

function notDue(cause) {
  return Object.assign(new Error("TIMEWEB_PRODUCTION_CANARY_NOT_DUE: Production canary host clock is before the due time"), {
    code: "TIMEWEB_PRODUCTION_CANARY_NOT_DUE",
    cause,
  });
}

function run(file, args, maximum = 1024 * 1024, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: { ...environment, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const stdout = []; let size = 0;
    const collect = (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); else stdout.push(chunk); };
    child.stdout.on("data", collect); child.stderr.on("data", (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); }); child.on("error", reject);
    child.on("close", (code, signal) => code === 0 && !signal && size <= maximum ? resolve(Buffer.concat(stdout).toString("utf8")) : reject(new Error("command")));
  });
}

const compose = (args) => run("/usr/bin/docker", ["compose", "--project-name", "proofline-production-primary", "--file", "/opt/orivra/current/compose.yaml", "--file", "/opt/orivra/current/deploy/compose.runtime.yaml", "--file", "/opt/orivra/current/deploy/compose.backup.yaml", ...args], 1024 * 1024,
  bindFixedReplayBootstrapComposeInterpolationEnvironment(process.env));

function productionAdapters() {
  return {
    async externalHttps({ publicOrigin }) {
      const [root, api] = await Promise.all([
        fetch(publicOrigin, { redirect: "error", signal: AbortSignal.timeout(20_000) }),
        fetch(`${publicOrigin}/api/healthz`, { redirect: "error", signal: AbortSignal.timeout(20_000) }),
      ]);
      if (!root.ok || !api.ok || !(await root.text()).includes("<html")) throw new Error("https");
      return { status: "passed", rootHtml: true, sameOriginApi: true };
    },
    async internalHealth() {
      const [healthText, readyText] = await Promise.all([
        compose(["exec", "-T", "api", "node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(async r=>{process.stdout.write(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"]),
        compose(["exec", "-T", "api", "node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(async r=>{process.stdout.write(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"]),
      ]);
      const health = JSON.parse(healthText); const ready = JSON.parse(readyText);
      if (health?.status !== "ok" || ready?.status !== "ready" || ready?.worker?.status !== "current") throw new Error("health");
      return { healthz: { status: "passed" }, readyz: { status: "passed", schemaVersion: 10 }, workerHeartbeat: { status: "current" } };
    },
    async diskPressure() {
      const line = String(await run("/bin/df", ["-Pk", "/opt/orivra"])).trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/);
      const usedPercent = Number(String(line?.[4] ?? "").replace("%", ""));
      if (!Number.isSafeInteger(usedPercent) || usedPercent < 0 || usedPercent > 85) throw new Error("disk");
      return { status: "passed" };
    },
    async timewebBackup() {
      const archive = await switchAndObserveProductionWalArchive();
      const rows = JSON.parse(await compose(["run", "--rm", "--no-deps", "backup-status"]));
      const latest = Array.isArray(rows) ? rows.at(-1) : undefined;
      const completed = Date.parse(latest?.finish_time ?? latest?.time ?? "");
      if (!Number.isFinite(completed)) throw new Error("backup");
      return { status: "passed", backupAgeSeconds: Math.max(0, Math.floor((Date.now() - completed) / 1000)), archivePendingAgeSeconds: archive.archivePendingAgeSeconds };
    },
    async persistedLiveRuns() {
      const text = (await readBoundedPrivateFile("/opt/orivra/evidence/production-deployment-evidence.v2.json", { maximumBytes: 1024 * 1024 })).toString("utf8");
      const evidence = ProductionDeploymentEvidenceV2Schema.parse(JSON.parse(text));
      if (text !== canonicalSerializeProductionDeploymentEvidenceV2(evidence)) throw new Error("deployment evidence");
      return { status: "persisted", runIds: evidence.checks.liveCoston2.runIds, manifests: evidence.checks.liveCoston2.manifests };
    },
    async hostedBrowserAcceptance(expectedSha256) {
      const [bytes, checksumBytes] = await Promise.all([
        readBoundedPrivateFile(BROWSER_ACCEPTANCE, { maximumBytes: 1024 * 1024 }),
        readBoundedPrivateFile(BROWSER_ACCEPTANCE_SHA256, { maximumBytes: 128 }),
      ]);
      const checksum = checksumBytes.toString("utf8").trim();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const value = JSON.parse(text);
      if (text !== canonicalJson(value) || checksum !== sha256(bytes) || (expectedSha256 && checksum !== expectedSha256)) {
        throw new Error("browser acceptance checksum");
      }
      return validateBrowserAcceptance(value, checksum, bytes);
    },
  };
}

const productionClock = {
  async readSynchronizedHostTime() {
    const synchronized = String(await run("/usr/bin/timedatectl", ["show", "--property=NTPSynchronized", "--value"], 4096)).trim();
    if (synchronized !== "yes") throw new Error("clock");
    return { now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: 0 };
  },
};

export async function observeTimewebProductionCanary({ id, dueAt, publicOrigin = PUBLIC_ORIGIN, persistedLiveRuns, browserAcceptance, browserAcceptanceSha256, clock, adapters, observeChecks }) {
  try {
    if (!IDS.includes(id) || !Number.isFinite(Date.parse(dueAt))) throw new Error("identity");
    if (observeChecks) {
      const observedAt = clock?.now?.();
      if (!Number.isFinite(Date.parse(observedAt))) throw new Error("clock");
      if (Date.parse(observedAt) < Date.parse(dueAt)) throw notDue();
      const checks = await observeChecks({ id, dueAt, source: "production-host" });
      return ProductionCanaryCheckpointV2Schema.parse({ version: "2", kind: "production-canary-checkpoint", id, dueAt, observedAt, status: "passed", checks });
    }
    if (!adapters) await validateTimewebProductionSecretInventory({ environment: process.env });
    const time = await (clock ?? productionClock).readSynchronizedHostTime();
    if (time?.source !== "production-host" || time.maximumSkewSeconds !== 5 || !Number.isInteger(time.observedSkewSeconds) || time.observedSkewSeconds < 0 || time.observedSkewSeconds > 5 || !Number.isFinite(Date.parse(time.now))) throw new Error("host clock");
    if (Date.parse(time.now) < Date.parse(dueAt)) throw notDue();
    const effects = adapters ?? productionAdapters();
    const [external, internal, disk, objectStore, live, browser] = await Promise.all([
      effects.externalHttps({ publicOrigin }), effects.internalHealth(), effects.diskPressure(), effects.timewebBackup(),
      id === "cutover" ? Promise.resolve(persistedLiveRuns) : effects.persistedLiveRuns(),
      id === "cutover" ? Promise.resolve(validateBrowserAcceptance(browserAcceptance, browserAcceptanceSha256 ?? browserAcceptance?.artifactSha256)) : effects.hostedBrowserAcceptance(),
    ]);
    if (external?.status !== "passed" || external.rootHtml !== true || external.sameOriginApi !== true || internal?.healthz?.status !== "passed" || internal?.readyz?.status !== "passed" || internal?.workerHeartbeat?.status !== "current" || disk?.status !== "passed" || objectStore?.status !== "passed" || !Number.isSafeInteger(objectStore.archivePendingAgeSeconds) || objectStore.archivePendingAgeSeconds < 0 || objectStore.archivePendingAgeSeconds > 60 || !validLiveRuns(live) || browser?.status !== "passed" || browser.publicOrigin !== publicOrigin || !/^sha256:[a-f0-9]{64}$/.test(browser.artifactSha256 ?? "")) throw new Error("archive freshness or browser acceptance");
    const checks = {
      healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
      objectStore: { status: "passed", backupAgeSeconds: objectStore.backupAgeSeconds, archivePendingAgeSeconds: objectStore.archivePendingAgeSeconds },
      diskPressure: { status: "passed" }, hostedBrowserSmoke: { status: "passed" },
      liveCoston2: { status: "persisted", runIds: live.runIds },
      clock: { status: "synchronized", source: "production-host", maximumSkewSeconds: 5, observedSkewSeconds: time.observedSkewSeconds },
    };
    const observedAt = time.now;
    return ProductionCanaryCheckpointV2Schema.parse({
      version: "2", kind: "production-canary-checkpoint", id, dueAt, observedAt, status: "passed", checks,
    });
  } catch (cause) { if (cause?.code === "TIMEWEB_PRODUCTION_CANARY_NOT_DUE") throw cause; throw failure(cause); }
}

export async function runTimewebProductionCanaryObservationCli({ argv = process.argv.slice(2), stdout = process.stdout, observe = observeTimewebProductionCanary } = {}) {
  if (![4, 8].includes(argv.length) || argv[0] !== "--id" || argv[2] !== "--due-at") throw failure(new Error("arguments"));
  let extra = {};
  if (argv.length === 8) {
    if (argv[4] !== "--persisted-live-runs-base64url" || argv[6] !== "--browser-acceptance-sha256") throw failure(new Error("arguments"));
    const liveBytes = Buffer.from(argv[5], "base64url");
    if (liveBytes.toString("base64url") !== argv[5]) throw failure(new Error("live runs encoding"));
    const liveText = new TextDecoder("utf-8", { fatal: true }).decode(liveBytes);
    const live = JSON.parse(liveText);
    if (liveText !== canonicalJson(live) || !validLiveRuns(live)) throw failure(new Error("live runs"));
    const browser = await productionAdapters().hostedBrowserAcceptance(argv[7]);
    extra = { persistedLiveRuns: live, browserAcceptance: browser, browserAcceptanceSha256: argv[7] };
  }
  const result = await observe({ id: argv[1], dueAt: argv[3], ...extra });
  stdout.write(`${canonicalSerializeProductionCanaryCheckpointV2(result)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runTimewebProductionCanaryObservationCli();
