import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { bindFixedReplayBootstrapComposeInterpolationEnvironment } from "./timeweb-production-compose-environment.mjs";
import { validateTimewebProductionSecretInventory } from "./timeweb-production-secret-inventory.mjs";

const OPEN_METEO = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_USD = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const RUN = /^(?:run_[0-9A-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function failure(cause) {
  return Object.assign(new Error("TIMEWEB_PRODUCTION_LIVE_RUNS_INVALID: Production live runs are invalid"), {
    code: "TIMEWEB_PRODUCTION_LIVE_RUNS_INVALID",
    cause,
  });
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function defaultQueryPersistedRuns() {
  throw failure(new Error("A production persisted-run database adapter is required"));
}

function defaultRunCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { env: command.environment, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const stdout = []; const stderr = []; let size = 0;
    const collect = (target) => (chunk) => { size += chunk.length; if (size > 1024 * 1024) child.kill("SIGKILL"); else target.push(chunk); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr)); child.on("error", reject);
    child.on("close", (code, signal) => resolve({ status: signal ? null : code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

export function createDefaultTimewebProductionLiveRunsAdapter({
  runCommand = defaultRunCommand,
  environment = { PATH: "/usr/bin:/bin" },
  validateSecretInventory = validateTimewebProductionSecretInventory,
} = {}) {
  return async ({ productionRunId }) => {
    try {
      if (!/^prod_[0-9A-Z]{26}$/.test(productionRunId ?? "")) throw new Error("run id");
      await validateSecretInventory({ environment });
      const result = await runCommand({
        file: "docker",
        args: ["compose", "--project-name", "proofline-production-primary", "--file", "/opt/orivra/current/compose.yaml", "--file", "/opt/orivra/current/deploy/compose.runtime.yaml", "exec", "-T", "worker", "node", "/app/apps/worker/dist/production-live-gate.js", "--run-id", productionRunId],
        environment: bindFixedReplayBootstrapComposeInterpolationEnvironment({ ...environment, PATH: "/usr/bin:/bin" }),
        timeoutMs: 1_800_000,
      });
      if (result?.status !== 0 || result.stderr !== "" || typeof result.stdout !== "string" || !result.stdout.endsWith("\n") || result.stdout.slice(0, -1).includes("\n")) throw new Error("command");
      const value = JSON.parse(result.stdout.slice(0, -1));
      if (canonicalJson(value) !== result.stdout.slice(0, -1)) throw new Error("canonical");
      const rows = value.runIds?.map((runId, index) => ({ runId, manifestSha256: value.manifests?.[index], chainId: value.chainId, stage: "completed", persisted: value.persisted }));
      return readTimewebProductionLiveRuns({ queryPersistedRuns: async () => rows });
    } catch (cause) { throw failure(cause); }
  };
}

export async function readTimewebProductionLiveRuns({ queryPersistedRuns = defaultQueryPersistedRuns }) {
  try {
    const manifests = [OPEN_METEO, ETH_USD];
    const rows = await queryPersistedRuns({ chainId: 114, manifests, requiredStage: "completed" });
    if (!Array.isArray(rows) || rows.length !== 2 || rows.some((row, index) => row?.chainId !== 114 || row.manifestSha256 !== manifests[index] ||
      row.stage !== "completed" || row.persisted !== true || !RUN.test(row.runId ?? "")) || rows[0].runId === rows[1].runId) throw new Error("rows");
    return Object.freeze({ status: "passed", chainId: 114, runIds: rows.map(({ runId }) => runId), manifests, persisted: true });
  } catch (cause) { throw failure(cause); }
}

export async function runTimewebProductionLiveRunsCli({ argv = process.argv.slice(2), stdout = process.stdout, readRuns } = {}) {
  if (argv.length !== 2 || argv[0] !== "--run-id") throw failure(new Error("arguments"));
  const result = readRuns
    ? await readRuns({ productionRunId: argv[1] })
    : await createDefaultTimewebProductionLiveRunsAdapter({ environment: process.env })({ productionRunId: argv[1] });
  stdout.write(`${canonicalJson(result)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runTimewebProductionLiveRunsCli();
