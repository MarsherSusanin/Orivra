import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from "node:constants";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SOURCE_ERROR = "Release source authority is invalid";
const SOURCE_CHANGED_ERROR = "Release source authority changed";
const WAL_G_ERROR = "Release WAL-G authority is invalid";

function failSource(code = "RELEASE_SOURCE_INVALID", message = SOURCE_ERROR) {
  throw Object.assign(new Error(message), { code });
}

function failWalG() {
  throw Object.assign(new Error(WAL_G_ERROR), { code: "RELEASE_WAL_G_INVALID" });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function assertAbsoluteDirectoryParent(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) failSource();
}

async function defaultRunGit(arguments_, repositoryRoot) {
  try {
    const { stdout = "", stderr = "" } = await execFileAsync("git", arguments_, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (cause) {
    return {
      exitCode: Number.isInteger(cause?.code) ? cause.code : 1,
      stdout: typeof cause?.stdout === "string" ? cause.stdout : "",
      stderr: typeof cause?.stderr === "string" ? cause.stderr : "",
    };
  }
}

async function defaultMaterializeCommit({ repositoryRoot, commitSha, sourceRoot }) {
  const archivePath = join(resolve(sourceRoot, ".."), `.release-source.${randomBytes(16).toString("hex")}.tar`);
  try {
    await execFileAsync("git", ["archive", "--format=tar", `--output=${archivePath}`, commitSha], {
      cwd: repositoryRoot,
      maxBuffer: 1024 * 1024,
    });
    await mkdir(sourceRoot, { mode: 0o700 });
    await execFileAsync("tar", ["-xf", archivePath, "-C", sourceRoot], {
      maxBuffer: 1024 * 1024,
    });
  } finally {
    await rm(archivePath, { force: true });
  }
}

async function inventoryAndFreeze(root) {
  const inventory = [];
  const directories = [];
  async function visit(directory) {
    directories.push(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) failSource();
      if (metadata.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!metadata.isFile() || metadata.size < 0) failSource();
      const handle = await open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
      try {
        const bytes = await handle.readFile();
        if (bytes.byteLength !== metadata.size) failSource();
        inventory.push({
          path: relative(root, path).split(sep).join("/"),
          sizeBytes: bytes.byteLength,
          sha256: sha256(bytes),
        });
      } finally {
        await handle.close();
      }
      await chmod(path, 0o400);
    }
  }
  await visit(root);
  for (const directory of directories.reverse()) await chmod(directory, 0o500);
  return sha256(Buffer.from(canonicalJson(inventory), "utf8"));
}

async function cleanupReadOnlyTree(path) {
  const metadata = await lstat(path).catch(() => undefined);
  if (!metadata) return;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    await chmod(path, 0o700).catch(() => undefined);
    const entries = await readdir(path).catch(() => []);
    await Promise.all(entries.map((entry) => cleanupReadOnlyTree(join(path, entry))));
  } else {
    await chmod(path, 0o600).catch(() => undefined);
  }
  await rm(path, { recursive: true, force: true });
}

export async function removeReleaseCapturedInput(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) failSource();
  await cleanupReadOnlyTree(path);
}

function commandOutput(result) {
  if (result?.exitCode !== 0 || typeof result.stdout !== "string") failSource();
  return result.stdout.trim();
}

export async function captureReleaseSourceSnapshot({
  repositoryRoot,
  snapshotParentDirectory,
  runGit = (arguments_) => defaultRunGit(arguments_, repositoryRoot),
  materializeCommit = defaultMaterializeCommit,
} = {}) {
  assertAbsoluteDirectoryParent(repositoryRoot);
  assertAbsoluteDirectoryParent(snapshotParentDirectory);
  const sourceRoot = join(snapshotParentDirectory, `.release-source.${randomBytes(16).toString("hex")}`);
  try {
    const commitSha = commandOutput(await runGit(["rev-parse", "HEAD"]));
    if (!COMMIT_SHA.test(commitSha)) failSource();
    const treeSha = commandOutput(await runGit(["rev-parse", `${commitSha}^{tree}`]));
    const epochText = commandOutput(await runGit(["show", "-s", "--format=%ct", commitSha]));
    const status = commandOutput(await runGit(["status", "--porcelain=v1", "--untracked-files=all"]));
    const sourceDateEpoch = Number(epochText);
    if (!COMMIT_SHA.test(treeSha) || treeSha === commitSha ||
      !Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 1 || status !== "") failSource();
    await materializeCommit({ repositoryRoot, commitSha, treeSha, sourceRoot });
    const metadata = await lstat(sourceRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) failSource();
    const sourceSnapshotSha256 = await inventoryAndFreeze(sourceRoot);
    return Object.freeze({
      sourceRoot,
      producer: Object.freeze({
        commitSha,
        treeSha,
        sourceSnapshotSha256,
        sourceDateEpoch,
        verification: "verified",
        releaseClaim: true,
      }),
    });
  } catch (cause) {
    await cleanupReadOnlyTree(sourceRoot).catch(() => undefined);
    if (["RELEASE_SOURCE_INVALID", "RELEASE_SOURCE_CHANGED"].includes(cause?.code)) throw cause;
    failSource();
  }
}

export async function verifyReleaseSourceForPublication({ producer, runGit } = {}) {
  try {
    if (typeof runGit !== "function" || !COMMIT_SHA.test(producer?.commitSha ?? "") ||
      !COMMIT_SHA.test(producer?.treeSha ?? "")) failSource("RELEASE_SOURCE_CHANGED", SOURCE_CHANGED_ERROR);
    const head = commandOutput(await runGit(["rev-parse", "HEAD"]));
    const tree = commandOutput(await runGit(["rev-parse", `${producer.commitSha}^{tree}`]));
    const status = commandOutput(await runGit(["status", "--porcelain=v1", "--untracked-files=all"]));
    if (head !== producer.commitSha || tree !== producer.treeSha || status !== "") {
      failSource("RELEASE_SOURCE_CHANGED", SOURCE_CHANGED_ERROR);
    }
    return producer;
  } catch (cause) {
    if (cause?.code === "RELEASE_SOURCE_CHANGED") throw cause;
    failSource("RELEASE_SOURCE_CHANGED", SOURCE_CHANGED_ERROR);
  }
}

async function readExactRegular(path, mode, maximumBytes) {
  let handle;
  try {
    handle = await open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumBytes ||
      (metadata.mode & 0o777) !== mode) failWalG();
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) failWalG();
    return bytes;
  } catch (cause) {
    if (cause?.code === "RELEASE_WAL_G_INVALID") throw cause;
    failWalG();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function captureVerifiedReleaseWalG({ inputRoot, captureParentDirectory, lock } = {}) {
  assertAbsoluteDirectoryParent(inputRoot);
  assertAbsoluteDirectoryParent(captureParentDirectory);
  let contextRoot;
  try {
    if (lock?.version !== "1" || lock?.walGVersion !== "v3.0.8" ||
      lock?.platform !== "linux/amd64" || !Number.isSafeInteger(lock?.maximumBytes) ||
      lock.maximumBytes < 1 || !SHA256.test(lock?.binarySha256 ?? "")) failWalG();
    const [binary, receiptBytes] = await Promise.all([
      readExactRegular(join(inputRoot, "wal-g"), 0o555, lock.maximumBytes),
      readExactRegular(join(inputRoot, "receipt.v1.json"), 0o444, 4096),
    ]);
    let receipt;
    const receiptText = new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes);
    try {
      receipt = JSON.parse(receiptText);
    } catch {
      failWalG();
    }
    if (!exactObject(receipt, ["version", "binarySize", "binarySha256"]) ||
      receipt.version !== "1" || receiptText !== canonicalJson(receipt) ||
      !Number.isSafeInteger(receipt.binarySize) || receipt.binarySize !== binary.byteLength ||
      receipt.binarySha256 !== lock.binarySha256 || sha256(binary) !== lock.binarySha256) failWalG();
    contextRoot = join(captureParentDirectory, `.release-wal-g.${randomBytes(16).toString("hex")}`);
    await mkdir(contextRoot, { mode: 0o700 });
    const temporaryBinary = join(contextRoot, ".wal-g.tmp");
    await writeFile(temporaryBinary, binary, { mode: 0o600, flag: "wx" });
    await rename(temporaryBinary, join(contextRoot, "wal-g"));
    await chmod(join(contextRoot, "wal-g"), 0o400);
    await chmod(contextRoot, 0o500);
    return Object.freeze({
      contextRoot,
      binarySha256: lock.binarySha256,
      receiptSha256: sha256(receiptBytes),
      binarySizeBytes: binary.byteLength,
    });
  } catch (cause) {
    if (contextRoot) await cleanupReadOnlyTree(contextRoot).catch(() => undefined);
    if (cause?.code === "RELEASE_WAL_G_INVALID") throw cause;
    failWalG();
  }
}
