import { spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  "PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE",
  "PROOFLINE_POSTGRES_PASSWORD_FILE",
];
const RUNTIME_INPUT_ERROR =
  "Production runtime input file configuration is invalid";

async function validateRuntimeInputFiles(environment) {
  try {
    for (const name of RUNTIME_INPUT_FILES) {
      const path = environment[name];
      if (typeof path !== "string" || !isAbsolute(path)) {
        throw new Error(RUNTIME_INPUT_ERROR);
      }
      const status = await lstat(path);
      if (!status.isFile() || status.size < 1) {
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
} = {}) {
  if (composeArguments.some((argument) =>
    argument === "--file" || argument === "-f" ||
    argument.startsWith("--file=") || argument.startsWith("-f"))) {
    throw new Error("Production Compose files are fixed by policy");
  }
  validateProductionImageReference(environment.PROOFLINE_CADDY_IMAGE);
  validateProductionImageReference(environment.PROOFLINE_WEB_IMAGE);
  if (runtime) {
    validateProductionImageReference(environment.PROOFLINE_API_IMAGE);
    validateProductionImageReference(environment.PROOFLINE_WORKER_IMAGE);
    if (composeArguments.some((argument) => argument === "start" || argument === "restart")) {
      throw new Error("Runtime one-shot jobs require an up deployment and cannot use start or restart");
    }
    if (composeArguments.includes("up") && composeArguments.includes("--no-recreate")) {
      throw new Error("Runtime one-shot jobs require forced recreation during up");
    }
    if (composeArguments.includes("up")) {
      await validateRuntimeInputFiles(environment);
    }
  }

  const args = ["compose", "--file", "compose.yaml"];
  if (runtime) args.push("--file", "deploy/compose.runtime.yaml");
  args.push(...composeArguments);
  if (runtime && composeArguments.includes("up") && !composeArguments.includes("--force-recreate")) {
    args.push("--force-recreate");
  }
  const result = spawnSync(dockerExecutable, args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
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
