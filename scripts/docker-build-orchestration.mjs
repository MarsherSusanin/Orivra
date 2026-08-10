import { createHash } from "node:crypto";
import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from "node:constants";
import { chmod, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WAL_G_INPUT_ERROR_CODE = "RECOVERY_WAL_G_INPUT_INVALID";
const WAL_G_INPUT_ERROR_MESSAGE = "Recovery WAL-G build input is invalid";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAXIMUM_WAL_G_BINARY_BYTES = 128 * 1024 * 1024;

const DEFAULT_APPLICATION_BUILDS = Object.freeze([
  Object.freeze(["--target", "web", "--tag", "proofline/web:027a-qa"]),
  Object.freeze(["--target", "api", "--tag", "proofline/api:027a-qa"]),
  Object.freeze(["--target", "worker", "--tag", "proofline/worker:027a-qa"]),
]);
const DEFAULT_CADDY_BUILD = Object.freeze([
  "--file",
  "docker/caddy.Dockerfile",
  "--tag",
  "proofline/caddy:027a-qa",
]);
const DEFAULT_RECOVERY_BUILD = Object.freeze([
  "--file",
  "docker/postgres-recovery.Dockerfile",
  "--tag",
  "proofline/postgres-recovery:027c-qa",
  "--build-context",
  "wal_g_release=docker/.prefetch/wal_g_release",
]);

function invalidWalGInput() {
  throw Object.assign(new Error(WAL_G_INPUT_ERROR_MESSAGE), {
    code: WAL_G_INPUT_ERROR_CODE,
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactObject(value, keys) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validateInputs(imageLock, walGLock) {
  const recovery = imageLock?.images?.postgresRecovery;
  if (
    !recovery ||
    typeof recovery.repository !== "string" ||
    typeof recovery.tag !== "string" ||
    !SHA256.test(recovery.linuxAmd64Digest ?? "") ||
    !exactObject(walGLock, [
      "version",
      "walGVersion",
      "platform",
      "assetUrl",
      "maximumBytes",
      "assetSha256",
      "binarySha256",
    ]) ||
    walGLock.version !== "1" ||
    walGLock.walGVersion !== "v3.0.8" ||
    walGLock.platform !== "linux/amd64" ||
    !Number.isSafeInteger(walGLock.maximumBytes) ||
    walGLock.maximumBytes < 1 ||
    !SHA256.test(walGLock.assetSha256 ?? "") ||
    !SHA256.test(walGLock.binarySha256 ?? "")
  ) {
    invalidWalGInput();
  }
}

async function readRegularDescriptor(path, maximumBytes, requiredMode) {
  let handle;
  try {
    handle = await open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > maximumBytes ||
      (metadata.mode & 0o777) !== requiredMode
    ) {
      invalidWalGInput();
    }
    const bytes = await handle.readFile();
    if (bytes.length !== metadata.size) invalidWalGInput();
    return bytes;
  } catch (cause) {
    if (cause?.code === WAL_G_INPUT_ERROR_CODE) throw cause;
    invalidWalGInput();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseReceipt(bytes, expectedCanonical) {
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
    if (text !== expectedCanonical(value)) invalidWalGInput();
  } catch (cause) {
    if (cause?.code === WAL_G_INPUT_ERROR_CODE) throw cause;
    invalidWalGInput();
  }
  if (
    !exactObject(value, ["version", "binarySize", "binarySha256"]) ||
    value.version !== "1" ||
    !Number.isSafeInteger(value.binarySize) ||
    value.binarySize < 1 ||
    !SHA256.test(value.binarySha256 ?? "")
  ) {
    invalidWalGInput();
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function captureVerifiedWalG(root, walGLock) {
  const source = resolve(root, "docker/.prefetch/wal_g_release");
  const [binary, receiptBytes] = await Promise.all([
    readRegularDescriptor(
      join(source, "wal-g"),
      MAXIMUM_WAL_G_BINARY_BYTES,
      0o555,
    ),
    readRegularDescriptor(join(source, "receipt.v1.json"), 4096, 0o444),
  ]);
  const receipt = parseReceipt(receiptBytes, canonicalJson);
  if (
    receipt.binarySize !== binary.length ||
    receipt.binarySha256 !== walGLock.binarySha256 ||
    sha256(binary) !== walGLock.binarySha256
  ) {
    invalidWalGInput();
  }

  const captured = await mkdtemp(join(tmpdir(), "proofline-wal-g-build-context-"));
  try {
    const path = join(captured, "wal-g");
    await writeFile(path, binary, { mode: 0o500, flag: "wx" });
    await chmod(path, 0o555);
    return { directory: captured, binarySha256: receipt.binarySha256 };
  } catch (cause) {
    await rm(captured, { recursive: true, force: true });
    throw cause;
  }
}

function replaceRecoveryContext(arguments_, capturedDirectory, binarySha256) {
  const result = [...arguments_];
  const contextIndex = result.indexOf("--build-context");
  if (
    contextIndex === -1 ||
    typeof result[contextIndex + 1] !== "string" ||
    !result[contextIndex + 1].startsWith("wal_g_release=")
  ) {
    invalidWalGInput();
  }
  result[contextIndex + 1] = `wal_g_release=${capturedDirectory}`;
  result.push(
    "--build-arg",
    `PROOFLINE_WAL_G_BINARY_SHA256=${binarySha256}`,
  );
  return result;
}

export async function runOfflineDockerBuilds({
  root,
  imageLock,
  walGLock,
  runDocker,
  applicationBuilds = DEFAULT_APPLICATION_BUILDS,
  caddyBuild = DEFAULT_CADDY_BUILD,
  recoveryBuild = DEFAULT_RECOVERY_BUILD,
  buildPolicy = ["--pull=false", "--network", "none"],
  buildPlatform = "linux/amd64",
  npmOfflineBuildArgument = ["--build-arg", "NPM_CONFIG_OFFLINE=true"],
  repetitions = [1, 2],
} = {}) {
  if (
    typeof root !== "string" ||
    typeof runDocker !== "function" ||
    !Array.isArray(buildPolicy) ||
    buildPolicy.join("\0") !== "--pull=false\0--network\0none" ||
    buildPlatform !== "linux/amd64" ||
    !Array.isArray(npmOfflineBuildArgument) ||
    npmOfflineBuildArgument.join("\0") !==
      "--build-arg\0NPM_CONFIG_OFFLINE=true" ||
    !Array.isArray(repetitions) ||
    JSON.stringify(repetitions) !== "[1,2]"
  ) {
    invalidWalGInput();
  }
  validateInputs(imageLock, walGLock);
  const capture = await captureVerifiedWalG(root, walGLock);
  const boundRecoveryBuild = replaceRecoveryContext(
    recoveryBuild,
    capture.directory,
    capture.binarySha256,
  );
  try {
    for (const repetition of repetitions) {
      for (const target of applicationBuilds) {
        await runDocker([
          "build",
          "--platform",
          buildPlatform,
          ...buildPolicy,
          ...npmOfflineBuildArgument,
          ...target,
          "--file",
          "docker/Dockerfile",
          root,
        ]);
      }
      await runDocker([
        "build",
        "--platform",
        buildPlatform,
        ...buildPolicy,
        ...caddyBuild,
        root,
      ]);
      await runDocker([
        "build",
        "--platform",
        buildPlatform,
        ...buildPolicy,
        ...boundRecoveryBuild,
        root,
      ]);
      process.stdout.write(`Offline build pass ${repetition} complete\n`);
    }
  } finally {
    await rm(capture.directory, { recursive: true, force: true });
  }
}
