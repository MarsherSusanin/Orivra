import { spawnSync } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseProductionBackupConfiguration } from "./backup-configuration.mjs";
import {
  PRODUCTION_BOOTSTRAP_OUTPUTS,
  validateProductionBootstrapPhaseInputs,
} from "./timeweb-production-bootstrap-runtime.mjs";
import { bindFixedReplayBootstrapComposeInterpolationEnvironment } from "./timeweb-production-compose-environment.mjs";
import { validateTimewebProductionSecretInventory } from "./timeweb-production-secret-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_COMPONENT = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
const IMMUTABLE_IMAGE = new RegExp(
  `^(?:${REPOSITORY_COMPONENT}(?::[0-9]+)?/)?(?:${REPOSITORY_COMPONENT}/)*${REPOSITORY_COMPONENT}@sha256:[a-f0-9]{64}$`,
);
const RUNTIME_INPUT_FILES = [
  "PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE",
  "PROOFLINE_MIGRATOR_DATABASE_URL_FILE",
  "PROOFLINE_API_DATABASE_URL_FILE",
  "PROOFLINE_API_TOKEN_DIGEST_KEY_FILE",
  "PROOFLINE_WORKER_DATABASE_URL_FILE",
  "PROOFLINE_WORKER_VERIFIER_API_KEY_FILE",
  "PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE",
  "PROOFLINE_WORKER_REPLAY_BUNDLE_FILE",
  "PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE",
  "PROOFLINE_SAFE_CONSUMER_EVIDENCE_ROOT",
  "PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE",
  "PROOFLINE_POSTGRES_PASSWORD_FILE",
];
const RUNTIME_INPUT_ERROR =
  "Production runtime input file configuration is invalid";
const BACKUP_INPUT_FILES = [
  "PROOFLINE_BACKUP_BOOTSTRAP_DATABASE_URL_FILE",
  "PROOFLINE_BACKUP_DATABASE_URL_FILE",
  "PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE",
  "PROOFLINE_BACKUP_EVIDENCE_FILE",
];

async function validateRuntimeInputFiles(environment, composeArguments) {
  try {
    const handoffPath = environment.PROOFLINE_SAFE_CONSUMER_WORKER_HANDOFF_FILE;
    if (typeof handoffPath !== "string" || !isAbsolute(handoffPath)) throw new Error(RUNTIME_INPUT_ERROR);
    for (const name of RUNTIME_INPUT_FILES) {
      const path = environment[name];
      if (typeof path !== "string" || !isAbsolute(path)) {
        throw new Error(RUNTIME_INPUT_ERROR);
      }
      const status = await lstat(path);
      const evidenceRoot = name === "PROOFLINE_SAFE_CONSUMER_EVIDENCE_ROOT";
      if ((evidenceRoot ? !status.isDirectory() : !status.isFile()) || (!evidenceRoot && status.size < 1)) {
        throw new Error(RUNTIME_INPUT_ERROR);
      }
    }
  } catch {
    throw new Error(RUNTIME_INPUT_ERROR);
  }
}

const SAFE_CONSUMER_FILES = [
  "safe-consumer-deployment-evidence.v1.json",
  "safe-consumer-registry.v1.json",
];

const EARLY_BOOTSTRAP_SERVICES = Object.freeze([
  "postgres",
  "db-role-bootstrap",
  "migrator",
  "api",
  "safe-consumer-deployer",
]);

function phaseForServices(services) {
  if (!Array.isArray(services)) return null;
  if (services.length > 0 && services.every((service) => EARLY_BOOTSTRAP_SERVICES.includes(service))) {
    return services.at(-1) === "safe-consumer-deployer" ? "safe-consumer-deployer" : `start-${services.at(-1)}`;
  }
  if (services.length === 1 && services[0] === "timeweb-pitr") return "timeweb-pitr";
  if (services.length === 1 && services[0] === "replay-bootstrap") return "replay-bootstrap";
  if (services.length === 1 && services[0] === "worker") return "start-worker";
  return "append-deployment-evidence";
}

export async function runPhaseAwareProductionCompose({
  services = [],
  outputPaths = PRODUCTION_BOOTSTRAP_OUTPUTS,
  inspectPath = lstat,
  validateCanonical,
  runDocker,
} = {}) {
  const phase = phaseForServices(services);
  if (!phase || typeof runDocker !== "function") {
    throw new Error("Production phase-aware Compose command is invalid");
  }
  await validateProductionBootstrapPhaseInputs({
    phase,
    outputPaths,
    inspectPath,
    validateCanonical,
  });
  return runDocker(Object.freeze([...services]));
}

export async function validateSafeConsumerEvidenceLifecycle({ evidenceRoot, workerHandoffPath, phase }) {
  const invalid = (code) => Object.assign(new Error(`${code}: safe consumer evidence lifecycle is invalid`), { code });
  try {
    if (typeof evidenceRoot !== "string" || !isAbsolute(evidenceRoot) ||
      typeof workerHandoffPath !== "string" || !isAbsolute(workerHandoffPath)) {
      throw invalid("SAFE_CONSUMER_EVIDENCE_INVALID");
    }
    const rootStatus = await lstat(evidenceRoot);
    if (!rootStatus.isDirectory() || (rootStatus.mode & 0o777) !== 0o700) throw invalid("SAFE_CONSUMER_EVIDENCE_INVALID");
    const entries = (await readdir(evidenceRoot)).sort();
    if (phase === "before-deployer") {
      if (entries.length !== 0) throw invalid("SAFE_CONSUMER_EVIDENCE_PREEXISTS");
      await lstat(workerHandoffPath).then(
        () => { throw invalid("SAFE_CONSUMER_EVIDENCE_PREEXISTS"); },
        (cause) => { if (cause?.code !== "ENOENT") throw cause; },
      );
    } else if (phase === "before-worker") {
      if (entries.length !== SAFE_CONSUMER_FILES.length || entries.some((entry, index) => entry !== SAFE_CONSUMER_FILES[index])) {
        throw invalid("SAFE_CONSUMER_EVIDENCE_INCOMPLETE");
      }
      for (const entry of entries) {
        const status = await lstat(resolve(evidenceRoot, entry));
        if (!status.isFile() || status.size < 1 || (status.mode & 0o777) !== 0o400) {
          throw invalid("SAFE_CONSUMER_EVIDENCE_INVALID");
        }
      }
      const handoff = await lstat(workerHandoffPath).catch((cause) => {
        if (cause?.code === "ENOENT") throw invalid("SAFE_CONSUMER_EVIDENCE_INCOMPLETE");
        throw cause;
      });
      if (!handoff.isFile() || handoff.size < 1 || (handoff.mode & 0o777) !== 0o400) {
        throw invalid("SAFE_CONSUMER_EVIDENCE_INVALID");
      }
    } else {
      throw invalid("SAFE_CONSUMER_EVIDENCE_INVALID");
    }
    return {
      evidenceRoot,
      deploymentEvidencePath: resolve(evidenceRoot, SAFE_CONSUMER_FILES[0]),
      registryPath: resolve(evidenceRoot, SAFE_CONSUMER_FILES[1]),
      workerHandoffPath,
    };
  } catch (cause) {
    if (cause?.code?.startsWith?.("SAFE_CONSUMER_")) throw cause;
    throw invalid("SAFE_CONSUMER_EVIDENCE_INVALID");
  }
}

async function validateBackupInputFiles(environment) {
  try {
    for (const name of BACKUP_INPUT_FILES) {
      const path = environment[name];
      if (typeof path !== "string" || !isAbsolute(path)) {
        throw new Error(RUNTIME_INPUT_ERROR);
      }
      const status = await lstat(path);
      if (!status.isFile() || status.size < 1 || status.size > 65_536) {
        throw new Error(RUNTIME_INPUT_ERROR);
      }
    }
  } catch {
    throw new Error(RUNTIME_INPUT_ERROR);
  }
}

export function validateProductionImageReference(reference) {
  if (typeof reference !== "string" || !IMMUTABLE_IMAGE.test(reference)) {
    throw new Error("Production image reference must be an immutable lowercase SHA-256 reference");
  }
  return reference;
}

export async function runProductionCompose({
  composeArguments = [],
  dockerExecutable = "docker",
  environment = process.env,
  runtime = false,
  validateSecretInventory = validateTimewebProductionSecretInventory,
} = {}) {
  if (composeArguments.some((argument) =>
    argument === "--file" || argument === "-f" ||
    argument.startsWith("--file=") || argument.startsWith("-f"))) {
    throw new Error("Production Compose files are fixed by policy");
  }
  const composeEnvironment = runtime
    ? bindFixedReplayBootstrapComposeInterpolationEnvironment(environment)
    : environment;
  validateProductionImageReference(composeEnvironment.PROOFLINE_CADDY_IMAGE);
  validateProductionImageReference(composeEnvironment.PROOFLINE_WEB_IMAGE);
  if (runtime) {
    validateProductionImageReference(composeEnvironment.PROOFLINE_API_IMAGE);
    validateProductionImageReference(composeEnvironment.PROOFLINE_WORKER_IMAGE);
    if (composeEnvironment.PROOFLINE_POSTGRES_IMAGE !== undefined) {
      validateProductionImageReference(composeEnvironment.PROOFLINE_POSTGRES_IMAGE);
    }
    if (composeArguments.some((argument) => argument === "start" || argument === "restart")) {
      throw new Error("Runtime one-shot jobs require an up deployment and cannot use start or restart");
    }
    if (composeArguments.includes("up") && composeArguments.includes("--no-recreate")) {
      throw new Error("Runtime one-shot jobs require forced recreation during up");
    }
    if (composeArguments.includes("up")) {
      await validateRuntimeInputFiles(composeEnvironment, composeArguments);
    }
    await validateSecretInventory({ environment: composeEnvironment });
    if (composeArguments.includes("up")) {
      const explicitWorker = composeArguments.includes("worker") && !composeArguments.includes("safe-consumer-deployer");
      await validateSafeConsumerEvidenceLifecycle({
        evidenceRoot: composeEnvironment.PROOFLINE_SAFE_CONSUMER_EVIDENCE_ROOT,
        workerHandoffPath: composeEnvironment.PROOFLINE_SAFE_CONSUMER_WORKER_HANDOFF_FILE,
        phase: explicitWorker ? "before-worker" : "before-deployer",
      });
      if (composeEnvironment.PROOFLINE_POSTGRES_IMAGE !== undefined) {
        parseProductionBackupConfiguration(composeEnvironment);
        await validateBackupInputFiles(composeEnvironment);
      }
    }
  }

  const args = ["compose", "--file", "compose.yaml"];
  if (runtime) {
    args.push("--file", "deploy/compose.runtime.yaml");
    args.push("--file", "deploy/compose.backup.yaml");
  }
  args.push(...composeArguments);
  if (runtime && composeArguments.includes("up") && !composeArguments.includes("--force-recreate")) {
    args.push("--force-recreate");
  }
  const result = spawnSync(dockerExecutable, args, {
    cwd: root,
    encoding: "utf8",
    env: composeEnvironment,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Production Compose command failed");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arguments_ = process.argv.slice(2);
  const runtime = arguments_[0] === "--runtime";
  if (runtime) arguments_.shift();
  await runProductionCompose({ composeArguments: arguments_, runtime });
}
