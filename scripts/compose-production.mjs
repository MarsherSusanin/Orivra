import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_COMPONENT = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
const IMMUTABLE_IMAGE = new RegExp(
  `^(?:${REPOSITORY_COMPONENT}(?::[0-9]+)?/)?(?:${REPOSITORY_COMPONENT}/)*${REPOSITORY_COMPONENT}@sha256:[a-f0-9]{64}$`,
);

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
  }

  const args = ["compose", "--file", "compose.yaml"];
  if (runtime) args.push("--file", "deploy/compose.runtime.yaml");
  args.push(...composeArguments);
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
