import { chmod, lstat, readdir, rm, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const gateDefinitions = Object.freeze([
  ["typecheck", ["run", "typecheck"]],
  ["unit", ["test", "--", "--maxWorkers=1"]],
  ["core-coverage", ["run", "test:core:coverage", "--", "--maxWorkers=1"]],
  ["backend-coverage", ["run", "test:coverage:backend", "--", "--maxWorkers=1"]],
  ["web-coverage", ["run", "test:coverage:web", "--", "--maxWorkers=1"]],
  ["postgres", ["run", "test:postgres", "--", "--maxWorkers=1"]],
  ["solidity", ["run", "test:solidity"]],
  ["e2e", ["run", "test:e2e"]],
  ["build", ["run", "build"]],
  ["sites", ["run", "test:sites"]],
  ["action-artifact", ["run", "test:action:artifact"]],
  ["docker-static", ["run", "test:docker:static"]],
  ["docker-images", ["run", "test:docker"]],
  ["docker-runtime", ["run", "test:docker:runtime"]],
  ["docker-recovery", ["run", "test:docker:recovery"]],
  ["release-freeze", ["run", "release:freeze", "--", "--output", "__RELEASE_OUTPUT__", "--wal-g-input", "__WAL_G_INPUT__"]],
  ["product-compose", ["run", "test:docker:product", "--", "--fixture-output", "__FIXTURE_OUTPUT__"]],
]);

function invalid(message = "Credential-free candidate input is invalid") {
  throw Object.assign(new Error(message), { code: "MLP_CANDIDATE_INPUT_INVALID" });
}

export function createCredentialFreeCandidateCommands({
  releaseOutput = "__RELEASE_OUTPUT__",
  walGInput = "__WAL_G_INPUT__",
  fixtureOutput = "__FIXTURE_OUTPUT__",
} = {}) {
  return gateDefinitions.map(([id, arguments_]) => Object.freeze({
    id,
    executable: "npm",
    environment: Object.freeze(id === "postgres" ? { PROOFLINE_TESTCONTAINERS: "1" } : {}),
    arguments: Object.freeze(arguments_.map((value) => {
      if (value === "__RELEASE_OUTPUT__") return releaseOutput;
      if (value === "__WAL_G_INPUT__") return walGInput;
      if (value === "__FIXTURE_OUTPUT__") return fixtureOutput;
      return value;
    })),
  }));
}

export function createCredentialFreeCandidateEnvironment({
  ambientEnvironment = {},
  homeDirectory,
  dockerConfigDirectory,
  temporaryDirectory,
} = {}) {
  for (const path of [homeDirectory, dockerConfigDirectory, temporaryDirectory]) {
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) invalid();
  }
  const path = typeof ambientEnvironment.PATH === "string" && ambientEnvironment.PATH.length > 0
    ? ambientEnvironment.PATH
    : "/usr/bin:/bin";
  return Object.freeze({
    CI: "1",
    DOCKER_CONFIG: dockerConfigDirectory,
    HOME: homeDirectory,
    LANG: "C",
    LC_ALL: "C",
    NODE_ENV: "test",
    PATH: path,
    PROOFLINE_TESTCONTAINERS: "1",
    TMPDIR: temporaryDirectory,
    TZ: "UTC",
    XDG_CONFIG_HOME: join(homeDirectory, ".config"),
  });
}

export async function runCredentialFreeCandidateMatrix({ commands, runCommand } = {}) {
  if (!Array.isArray(commands) || typeof runCommand !== "function") invalid();
  const gates = [];
  for (const command of commands) {
    try {
      await runCommand(command);
    } catch {
      throw Object.assign(new Error("Credential-free candidate matrix failed"), {
        code: "MLP_CANDIDATE_MATRIX_FAILED",
        gateId: command?.id,
      });
    }
    gates.push(Object.freeze({ id: command.id, status: "passed" }));
  }
  return Object.freeze(gates);
}

export async function runCredentialFreeCandidateLifecycle({
  verifyInputs,
  runMatrix,
  freezeRelease,
  runProduct,
  finalizeResources,
  verifyFinalSource,
  publish,
  discard,
} = {}) {
  const hooks = [verifyInputs, runMatrix, freezeRelease, runProduct,
    finalizeResources, verifyFinalSource, publish, discard];
  if (hooks.some((hook) => typeof hook !== "function")) invalid();
  try {
    await verifyInputs();
    await runMatrix();
    await freezeRelease();
    await runProduct();
    await finalizeResources();
    await verifyFinalSource();
    return await publish();
  } catch (cause) {
    await discard().catch(() => undefined);
    throw cause;
  }
}

export async function removeOwnedCandidatePath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) invalid();
  const metadata = await lstat(path).catch((cause) => {
    if (cause?.code === "ENOENT") return undefined;
    throw cause;
  });
  if (!metadata) return;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) {
      await removeOwnedCandidatePath(join(path, entry));
    }
    await rmdir(path);
    return;
  }
  if (!metadata.isSymbolicLink()) await chmod(path, 0o600);
  await rm(path, { force: true });
}
