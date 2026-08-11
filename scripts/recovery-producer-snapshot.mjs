import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDENTITY_ERROR = "Recovery producer identity is invalid";
const IMMUTABLE_ERROR = "Recovery producer snapshot is not immutable";
const TREE_ERROR = "Recovery producer snapshot tree does not match";
const CHANGED_ERROR = "Recovery producer snapshot changed";
const PUBLISH_ERROR = "Recovery producer snapshot is not publishable";

function fail(message) {
  throw new Error(message);
}

function runFile(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(executable, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
      ...options,
    }, (cause, stdout, stderr) => {
      if (cause) {
        reject(cause);
        return;
      }
      resolvePromise({ exitCode: 0, stdout, stderr });
    });
  });
}

function defaultRunGit(args, { repositoryRoot }) {
  return runFile("git", args, { cwd: repositoryRoot });
}

async function gitOutput(runGit, repositoryRoot, args, maximumBytes = 8192) {
  const result = await runGit(args, { repositoryRoot });
  if (
    result === null ||
    typeof result !== "object" ||
    result.exitCode !== 0 ||
    typeof result.stdout !== "string" ||
    Buffer.byteLength(result.stdout) > maximumBytes
  ) fail(IDENTITY_ERROR);
  return result.stdout;
}

async function collectCandidatePaths(repositoryRoot) {
  const result = await runFile("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ], { cwd: repositoryRoot, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  const bytes = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout);
  return bytes.toString("utf8").split("\0").filter(Boolean).sort();
}

async function makeParentDirectories(root, relativePath) {
  const parts = dirname(relativePath).split(sep).filter((part) => part !== ".");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
    }
  }
}

async function chmodAndManifest(root) {
  const manifest = [];
  async function visit(directory, prefix = "") {
    const names = await readdir(directory);
    names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const name of names) {
      const path = join(directory, name);
      const key = prefix === "" ? name : `${prefix}/${name}`;
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) fail(IMMUTABLE_ERROR);
      if (metadata.isDirectory()) {
        await visit(path, key);
        await chmod(path, 0o500);
        manifest.push({ path: `${key}/`, type: "directory" });
      } else if (metadata.isFile()) {
        const bytes = await readFile(path);
        await chmod(path, 0o400);
        manifest.push({
          path: key,
          type: "file",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      } else {
        fail(IMMUTABLE_ERROR);
      }
    }
  }
  await visit(root);
  await chmod(root, 0o500);
  return `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
}

async function verifyImmutableTree(root) {
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o500) fail(IMMUTABLE_ERROR);
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) fail(IMMUTABLE_ERROR);
      if (entry.isDirectory()) {
        if ((entry.mode & 0o777) !== 0o500) fail(IMMUTABLE_ERROR);
        await visit(path);
      } else if (!entry.isFile() || (entry.mode & 0o777) !== 0o400) {
        fail(IMMUTABLE_ERROR);
      }
    }
  }
  await visit(root);
}

async function defaultMaterializeSnapshot({
  sourceRoot,
  repositoryRoot,
  commitSha,
  treeSha,
  mode,
}) {
  await mkdir(sourceRoot, { mode: 0o700 });
  if (mode === "commit") {
    const archivePath = join(dirname(sourceRoot), `.source-${randomBytes(12).toString("hex")}.tar`);
    try {
      await runFile("git", ["archive", "--format=tar", `--output=${archivePath}`, commitSha], {
        cwd: repositoryRoot,
      });
      await runFile("tar", ["-xf", archivePath, "-C", sourceRoot]);
    } finally {
      await rm(archivePath, { force: true });
    }
    await chmodAndManifest(sourceRoot);
    return { materializedTreeSha: treeSha };
  }

  const manifestEntries = [];
  for (const candidatePath of await collectCandidatePaths(repositoryRoot)) {
    const sourcePath = resolve(repositoryRoot, candidatePath);
    const boundedRelative = relative(repositoryRoot, sourcePath);
    if (
      boundedRelative === "" ||
      boundedRelative.startsWith(`..${sep}`) ||
      isAbsolute(boundedRelative)
    ) fail(IMMUTABLE_ERROR);
    const metadata = await lstat(sourcePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(IMMUTABLE_ERROR);
    await makeParentDirectories(sourceRoot, boundedRelative);
    const destination = join(sourceRoot, boundedRelative);
    await copyFile(sourcePath, destination);
    const bytes = await readFile(destination);
    manifestEntries.push({
      path: candidatePath,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await chmodAndManifest(sourceRoot);
  return {
    candidateManifestSha256: `sha256:${createHash("sha256")
      .update(JSON.stringify(manifestEntries))
      .digest("hex")}`,
  };
}

export async function captureRecoveryProducerSnapshot({
  repositoryRoot,
  snapshotParentDirectory,
  allowDirtyDraft = false,
  runGit = defaultRunGit,
  materializeSnapshot = defaultMaterializeSnapshot,
} = {}) {
  let sourceRoot;
  try {
    if (
      typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot) ||
      typeof snapshotParentDirectory !== "string" ||
      !isAbsolute(snapshotParentDirectory) ||
      typeof allowDirtyDraft !== "boolean" || typeof runGit !== "function" ||
      typeof materializeSnapshot !== "function"
    ) fail(IDENTITY_ERROR);
    const commitSha = (await gitOutput(runGit, repositoryRoot, ["rev-parse", "HEAD"])).trim();
    if (!COMMIT_SHA.test(commitSha)) fail(IDENTITY_ERROR);
    const treeSha = (await gitOutput(
      runGit,
      repositoryRoot,
      ["rev-parse", `${commitSha}^{tree}`],
    )).trim();
    const status = await gitOutput(runGit, repositoryRoot, ["status", "--porcelain"]);
    if (!COMMIT_SHA.test(treeSha) || commitSha === treeSha) fail(IDENTITY_ERROR);
    const dirty = status !== "";
    if (dirty && !allowDirtyDraft) fail(IDENTITY_ERROR);
    sourceRoot = join(
      snapshotParentDirectory,
      `.recovery-source-${randomBytes(16).toString("hex")}`,
    );
    const materialized = await materializeSnapshot({
      sourceRoot,
      repositoryRoot,
      commitSha,
      treeSha,
      mode: dirty ? "working-tree-draft" : "commit",
    });
    if (!dirty && materialized?.materializedTreeSha !== treeSha) fail(TREE_ERROR);
    if (dirty && !SHA256.test(materialized?.candidateManifestSha256 ?? "")) {
      fail(IMMUTABLE_ERROR);
    }
    await chmodAndManifest(sourceRoot);
    return Object.freeze({
      repositoryRoot,
      sourceRoot,
      materializedTreeSha: dirty ? undefined : treeSha,
      candidateManifestSha256: dirty
        ? materialized.candidateManifestSha256
        : undefined,
      producerIdentity: Object.freeze({
        commitSha,
        treeSha,
        verification: dirty ? "draft" : "verified",
        releaseClaim: !dirty,
      }),
    });
  } catch (cause) {
    if (sourceRoot) await cleanupRecoveryProducerSnapshot({ sourceRoot }).catch(() => {});
    if ([IDENTITY_ERROR, IMMUTABLE_ERROR, TREE_ERROR].includes(cause?.message)) throw cause;
    fail(IDENTITY_ERROR);
  }
}

export async function verifyRecoveryProducerSnapshotForPublication({
  snapshot,
  runGit = defaultRunGit,
} = {}) {
  if (
    snapshot?.producerIdentity?.verification !== "verified" ||
    snapshot?.producerIdentity?.releaseClaim !== true ||
    snapshot?.materializedTreeSha !== snapshot?.producerIdentity?.treeSha
  ) fail(PUBLISH_ERROR);
  const { commitSha, treeSha } = snapshot.producerIdentity;
  const repositoryRoot = snapshot.repositoryRoot ?? process.cwd();
  const currentCommit = (await gitOutput(runGit, repositoryRoot, ["rev-parse", "HEAD"])).trim();
  const currentTree = (await gitOutput(
    runGit,
    repositoryRoot,
    ["rev-parse", `${commitSha}^{tree}`],
  )).trim();
  const status = await gitOutput(runGit, repositoryRoot, ["status", "--porcelain"]);
  if (currentCommit !== commitSha || currentTree !== treeSha || status !== "") {
    fail(CHANGED_ERROR);
  }
  return snapshot.producerIdentity;
}

export async function cleanupRecoveryProducerSnapshot({ sourceRoot } = {}) {
  if (typeof sourceRoot !== "string" || !isAbsolute(sourceRoot)) fail(IDENTITY_ERROR);
  async function makeWritable(path) {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (cause) {
      if (cause?.code === "ENOENT") return;
      throw cause;
    }
    if (metadata.isSymbolicLink()) fail(IMMUTABLE_ERROR);
    if (metadata.isDirectory()) {
      await chmod(path, 0o700);
      for (const name of await readdir(path)) await makeWritable(join(path, name));
    } else if (metadata.isFile()) {
      await chmod(path, 0o600);
    } else {
      fail(IMMUTABLE_ERROR);
    }
  }
  await makeWritable(sourceRoot);
  await rm(sourceRoot, { recursive: true, force: true });
}
