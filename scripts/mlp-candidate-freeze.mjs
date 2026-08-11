import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  FrozenOciReleaseManifestV1Schema,
  FrozenOciReleaseReceiptV1Schema,
  canonicalSerializeFrozenOciReleaseManifest,
  canonicalSerializeFrozenOciReleaseReceipt,
  sha256Bytes,
} from "../packages/contracts/src/release-runtime.mjs";
import { canonicalSerializeCredentialFreeMlpCandidate } from "../packages/contracts/src/candidate-runtime.mjs";
import {
  createCredentialFreeMlpCandidate,
  verifyCredentialFreeMlpCandidateHandoff,
} from "../packages/domain/src/mlp-candidate-runtime.mjs";
import { verifyFrozenOciReleaseHandoff } from "../packages/domain/src/oci-release-runtime.mjs";
import {
  captureVerifiedReleaseWalG,
  removeReleaseCapturedInput,
  verifyReleaseSourceForPublication,
} from "./release-input-authority.mjs";
import {
  createCredentialFreeCandidateCommands,
  createCredentialFreeCandidateEnvironment,
  removeOwnedCandidatePath,
  runCredentialFreeCandidateLifecycle,
  runCredentialFreeCandidateMatrix,
} from "./mlp-candidate-orchestration.mjs";
import { createRecordedProductFixture } from "./mlp-product-compose-runtime.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const candidateFilename = "credential-free-mlp-candidate.v1.json";
const fixtureFilename = "recorded-product-fixture.v1.json";
const manifestFilename = "frozen-release-manifest.v1.json";
const receiptFilename = "frozen-release-receipt.v1.json";

function fail(message = "Credential-free candidate freeze failed") {
  throw new Error(message);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseArguments(arguments_) {
  if (arguments_.length !== 4 || arguments_[0] !== "--output" ||
    arguments_[2] !== "--wal-g-input") {
    fail("Usage: release:candidate -- --output <absolute-path> --wal-g-input <absolute-path>");
  }
  const [outputDirectory, walGInputRoot] = [arguments_[1], arguments_[3]];
  if (![outputDirectory, walGInputRoot].every((path) =>
    typeof path === "string" && isAbsolute(path) && !path.includes("\0"))) fail();
  return { outputDirectory, walGInputRoot };
}

async function runGit(arguments_) {
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
      stdout: cause?.stdout ?? "",
      stderr: cause?.stderr ?? "",
    };
  }
}

function commandOutput(result) {
  if (result?.exitCode !== 0 || typeof result.stdout !== "string") fail();
  return result.stdout.trim();
}

async function resolveProducer() {
  const commitSha = commandOutput(await runGit(["rev-parse", "HEAD"]));
  const treeSha = commandOutput(await runGit(["rev-parse", `${commitSha}^{tree}`]));
  const status = commandOutput(await runGit(["status", "--porcelain=v1", "--untracked-files=all"]));
  if (!/^[a-f0-9]{40}$/.test(commitSha) || !/^[a-f0-9]{40}$/.test(treeSha) ||
    commitSha === treeSha || status !== "") fail("Candidate source must be clean and committed");
  return Object.freeze({ commitSha, treeSha });
}

async function validatePrivateOutput(outputDirectory) {
  const outputParent = dirname(outputDirectory);
  const parent = await lstat(outputParent);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    fail("Candidate output parent must be a private mode-0700 directory");
  }
  await lstat(outputDirectory).then(() => fail("Candidate output already exists"), (cause) => {
    if (cause?.code !== "ENOENT") throw cause;
  });
  return outputParent;
}

async function runCommand(command, environment) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command.executable, command.arguments, {
      cwd: repositoryRoot,
      env: { ...environment, ...command.environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error(`Candidate gate failed (${command.id})`));
    });
  });
}

async function verifyAndMaterializeWalG({ walGInputRoot, captureRoot, prefetchRoot }) {
  const lock = JSON.parse(await readFile(join(repositoryRoot, "docker/wal-g-release.v1.json"), "utf8"));
  let captured;
  try {
    captured = await captureVerifiedReleaseWalG({
      inputRoot: walGInputRoot,
      captureParentDirectory: captureRoot,
      lock,
    });
    const receiptBytes = Buffer.from(JSON.stringify({
      binarySha256: captured.binarySha256,
      binarySize: captured.binarySizeBytes,
      version: "1",
    }), "utf8");
    if (sha256(receiptBytes) !== captured.receiptSha256) fail("Candidate WAL-G receipt changed");
    await mkdir(prefetchRoot, { mode: 0o700 });
    await copyFile(join(captured.contextRoot, "wal-g"), join(prefetchRoot, "wal-g"));
    await chmod(join(prefetchRoot, "wal-g"), 0o555);
    await writeFile(join(prefetchRoot, "receipt.v1.json"), receiptBytes, { mode: 0o444, flag: "wx" });
    return captured;
  } catch (cause) {
    if (captured?.contextRoot) await removeReleaseCapturedInput(captured.contextRoot).catch(() => undefined);
    await removeOwnedCandidatePath(prefetchRoot).catch(() => undefined);
    throw cause;
  }
}

async function readFrozenRelease(releaseRoot, producer) {
  const manifestBytes = await readFile(join(releaseRoot, manifestFilename));
  const receiptBytes = await readFile(join(releaseRoot, receiptFilename));
  const manifest = FrozenOciReleaseManifestV1Schema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const receipt = FrozenOciReleaseReceiptV1Schema.parse(JSON.parse(receiptBytes.toString("utf8")));
  if (manifestBytes.toString("utf8") !== canonicalSerializeFrozenOciReleaseManifest(manifest) ||
    receiptBytes.toString("utf8") !== canonicalSerializeFrozenOciReleaseReceipt(receipt) ||
    manifest.producer.commitSha !== producer.commitSha || manifest.producer.treeSha !== producer.treeSha ||
    receipt.producer.commitSha !== producer.commitSha || receipt.producer.treeSha !== producer.treeSha) fail();
  const artifacts = new Map();
  for (const artifact of receipt.artifacts) {
    artifacts.set(artifact.filename, await readFile(join(releaseRoot, artifact.filename)));
  }
  verifyFrozenOciReleaseHandoff({ manifestBytes, receipt, expectedProducer: producer, artifacts });
  return { manifestBytes, receiptBytes, receipt };
}

async function main() {
  const { outputDirectory, walGInputRoot } = parseArguments(process.argv.slice(2));
  const outputParent = await validatePrivateOutput(outputDirectory);
  const stageRoot = join(outputParent, `.candidate-stage.${randomBytes(16).toString("hex")}`);
  const temporaryRoot = await mkdtemp(join(outputParent, ".candidate-temp."));
  const releaseRoot = join(stageRoot, "release");
  const fixturePath = join(stageRoot, fixtureFilename);
  const candidatePath = join(stageRoot, candidateFilename);
  const prefetchRoot = join(repositoryRoot, "docker/.prefetch");
  const paths = {
    capture: join(temporaryRoot, "capture"),
    dockerConfig: join(temporaryRoot, "docker-config"),
    home: join(temporaryRoot, "home"),
    tmp: join(temporaryRoot, "tmp"),
  };
  await mkdir(stageRoot, { mode: 0o700 });
  for (const path of Object.values(paths)) await mkdir(path, { mode: 0o700 });
  await mkdir(join(paths.home, ".config"), { mode: 0o700 });
  await writeFile(join(paths.dockerConfig, "config.json"), '{"auths":{}}', { mode: 0o600, flag: "wx" });
  const environment = createCredentialFreeCandidateEnvironment({
    ambientEnvironment: { PATH: process.env.PATH },
    homeDirectory: paths.home,
    dockerConfigDirectory: paths.dockerConfig,
    temporaryDirectory: paths.tmp,
  });
  const commands = createCredentialFreeCandidateCommands({
    releaseOutput: releaseRoot,
    walGInput: walGInputRoot,
    fixtureOutput: fixturePath,
  });
  let producer;
  let capturedWalG;
  let release;
  let fixtureBytes;
  let candidate;
  let outputOwned = false;
  let prefetchOwned = false;

  const discard = async () => {
    if (capturedWalG?.contextRoot) {
      await removeReleaseCapturedInput(capturedWalG.contextRoot).catch(() => undefined);
    }
    if (prefetchOwned) await removeOwnedCandidatePath(prefetchRoot).catch(() => undefined);
    await removeOwnedCandidatePath(stageRoot).catch(() => undefined);
    await removeOwnedCandidatePath(temporaryRoot).catch(() => undefined);
    if (outputOwned) await removeOwnedCandidatePath(outputDirectory).catch(() => undefined);
  };

  const result = await runCredentialFreeCandidateLifecycle({
    verifyInputs: async () => {
      producer = await resolveProducer();
      await lstat(prefetchRoot).then(() => fail("Candidate prefetch context already exists"), (cause) => {
        if (cause?.code !== "ENOENT") throw cause;
      });
      capturedWalG = await verifyAndMaterializeWalG({ walGInputRoot, captureRoot: paths.capture, prefetchRoot });
      prefetchOwned = true;
    },
    runMatrix: async () => {
      await runCredentialFreeCandidateMatrix({
        commands: commands.slice(0, 15),
        runCommand: (command) => runCommand(command, environment),
      });
    },
    freezeRelease: async () => {
      await runCommand(commands[15], environment);
      release = await readFrozenRelease(releaseRoot, producer);
    },
    runProduct: async () => {
      await runCommand(commands[16], environment);
      fixtureBytes = await readFile(fixturePath);
      const expectedFixture = Buffer.from(await createRecordedProductFixture());
      if (!fixtureBytes.equals(expectedFixture)) fail();
      candidate = createCredentialFreeMlpCandidate({
        producer,
        frozenRelease: {
          manifestSha256: sha256(release.manifestBytes),
          receiptSha256: sha256(release.receiptBytes),
          artifactInventorySha256: release.receipt.artifactInventorySha256,
        },
        fixtureSha256: sha256(fixtureBytes),
      });
      verifyCredentialFreeMlpCandidateHandoff({
        candidate,
        expectedProducer: producer,
        manifestBytes: release.manifestBytes,
        receiptBytes: release.receiptBytes,
        receiptArtifactInventorySha256: release.receipt.artifactInventorySha256,
        fixtureBytes,
      });
      await writeFile(candidatePath, canonicalSerializeCredentialFreeMlpCandidate(candidate), {
        mode: 0o600,
        flag: "wx",
      });
    },
    finalizeResources: async () => {
      await removeReleaseCapturedInput(capturedWalG.contextRoot);
      capturedWalG = undefined;
      await removeOwnedCandidatePath(prefetchRoot);
      prefetchOwned = false;
      await removeOwnedCandidatePath(temporaryRoot);
    },
    verifyFinalSource: async () => {
      await verifyReleaseSourceForPublication({ producer, runGit });
    },
    publish: async () => {
      const inventory = (await readdir(stageRoot)).sort();
      if (JSON.stringify(inventory) !== JSON.stringify([
        candidateFilename, fixtureFilename, "release",
      ].sort())) fail("Candidate output inventory is invalid");
      await chmod(candidatePath, 0o400);
      await chmod(fixturePath, 0o400);
      await chmod(stageRoot, 0o500);
      await rename(stageRoot, outputDirectory);
      outputOwned = true;
      return Object.freeze({ status: "passed", producer, candidateSha256: checksumCandidate(candidate) });
    },
    discard,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function checksumCandidate(candidate) {
  return sha256Bytes(new TextEncoder().encode(canonicalSerializeCredentialFreeMlpCandidate(candidate)));
}

main().catch((cause) => {
  process.stderr.write(`${cause?.message ?? "Credential-free candidate freeze failed"}\n`);
  process.exitCode = 1;
});
