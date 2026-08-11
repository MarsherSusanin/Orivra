import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
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
  checksumReleaseArtifactInventory,
} from "../packages/contracts/src/release-runtime.mjs";
import { writeCanonicalOciArchive } from "./oci-layout-archive.mjs";
import {
  captureReleaseSourceSnapshot,
  captureVerifiedReleaseWalG,
  removeReleaseCapturedInput,
  verifyReleaseSourceForPublication,
} from "./release-input-authority.mjs";
import {
  createOfflineReleaseEnvironment,
  createReleaseBuildCommands,
  publishFrozenReleaseOutput,
  runOfflineOciReleaseFreeze,
} from "./release-freeze-orchestration.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function fail(message = "Offline OCI release freeze failed") {
  throw new Error(message);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
    return { exitCode: Number.isInteger(cause?.code) ? cause.code : 1, stdout: cause?.stdout ?? "", stderr: cause?.stderr ?? "" };
  }
}

async function resolveBuildxExecutable(pathValue) {
  const candidates = [
    ...String(pathValue).split(":").filter(Boolean).map((directory) => join(directory, "docker-buildx")),
    "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx",
  ];
  for (const candidate of candidates) {
    const metadata = await lstat(candidate).catch(() => undefined);
    if (metadata?.isFile() && !metadata.isSymbolicLink() && (metadata.mode & 0o111) !== 0) return candidate;
  }
  fail("Local Buildx capability is unavailable");
}

async function runDocker(arguments_, environment, cwd, buildxExecutable) {
  try {
    const executable = arguments_[0] === "buildx" ? buildxExecutable : "docker";
    const childArguments = arguments_[0] === "buildx" ? arguments_.slice(1) : arguments_;
    return await execFileAsync(executable, childArguments, {
      cwd,
      env: environment,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (cause) {
    throw new Error(`Offline Docker phase failed (${arguments_.slice(0, 2).join(" ")})`, { cause });
  }
}

async function thawAndRemove(path) {
  const metadata = await lstat(path).catch(() => undefined);
  if (!metadata) return;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    await chmod(path, 0o700).catch(() => undefined);
    for (const entry of await readdir(path).catch(() => [])) await thawAndRemove(join(path, entry));
  } else {
    await chmod(path, 0o600).catch(() => undefined);
  }
  await rm(path, { recursive: true, force: true });
}

function parseArguments(arguments_) {
  if (arguments_.length !== 4 || arguments_[0] !== "--output" || arguments_[2] !== "--wal-g-input") fail("Usage: release:freeze -- --output <absolute-path> --wal-g-input <absolute-path>");
  const outputDirectory = arguments_[1];
  const walGInputRoot = arguments_[3];
  if (![outputDirectory, walGInputRoot].every((path) => typeof path === "string" && isAbsolute(path) && !path.includes("\0"))) fail();
  return { outputDirectory, walGInputRoot };
}

async function validatePrivateParent(outputDirectory) {
  const parent = dirname(outputDirectory);
  const metadata = await lstat(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) fail("Release output parent must be a private mode-0700 directory");
  await lstat(outputDirectory).then(() => fail("Release output already exists"), (cause) => {
    if (cause?.code !== "ENOENT") throw cause;
  });
  return parent;
}

async function main() {
  const { outputDirectory, walGInputRoot } = parseArguments(process.argv.slice(2));
  const outputParent = await validatePrivateParent(outputDirectory);
  const temporaryRoot = await mkdtemp(join(outputParent, ".release-freeze."));
  await chmod(temporaryRoot, 0o700);
  const stageRoot = join(outputParent, `.release-stage.${randomBytes(16).toString("hex")}`);
  const paths = {
    layouts: join(temporaryRoot, "layouts"), archives: join(temporaryRoot, "archives"),
    source: join(temporaryRoot, "source"), walG: join(temporaryRoot, "wal-g"),
    dockerConfig: join(temporaryRoot, "docker-config"), home: join(temporaryRoot, "home"),
    tmp: join(temporaryRoot, "tmp"), xdg: join(temporaryRoot, "xdg"),
  };
  for (const path of Object.values(paths)) await mkdir(path, { mode: 0o700 });
  await writeFile(join(paths.dockerConfig, "config.json"), '{"auths":{}}', { mode: 0o600, flag: "wx" });

  let snapshot;
  let walG;
  let environment;
  let commandById;
  let buildxExecutable;
  let archiveResults = [];
  let finalized = false;
  try {
    const result = await runOfflineOciReleaseFreeze({
      captureSource: async () => {
        snapshot = await captureReleaseSourceSnapshot({
          repositoryRoot,
          snapshotParentDirectory: paths.source,
          runGit,
        });
        return snapshot;
      },
      captureWalG: async () => {
        const lockBytes = await readFile(join(snapshot.sourceRoot, "docker/wal-g-release.v1.json"));
        const lock = JSON.parse(lockBytes.toString("utf8"));
        walG = await captureVerifiedReleaseWalG({
          inputRoot: walGInputRoot,
          captureParentDirectory: paths.walG,
          lock,
        });
        environment = createOfflineReleaseEnvironment({
          ambientEnvironment: { PATH: process.env.PATH, ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) },
          dockerConfigDirectory: paths.dockerConfig,
          homeDirectory: paths.home,
          temporaryDirectory: paths.tmp,
          xdgConfigDirectory: paths.xdg,
          sourceDateEpoch: snapshot.producer.sourceDateEpoch,
        });
        buildxExecutable = await resolveBuildxExecutable(environment.PATH);
        commandById = new Map(createReleaseBuildCommands({
          sourceRoot: snapshot.sourceRoot,
          walGContextRoot: walG.contextRoot,
          sourceDateEpoch: snapshot.producer.sourceDateEpoch,
          layoutsRoot: paths.layouts,
        }).map((command) => [command.id, command]));
        return walG;
      },
      verifyCapability: async () => {
        await runDocker(["buildx", "version"], environment, snapshot.sourceRoot, buildxExecutable);
      },
      buildImage: async ({ id }) => {
        const command = commandById.get(id);
        if (!command) fail();
        const arguments_ = command.arguments.map((value) =>
          value === "PROOFLINE_WAL_G_BINARY_SHA256=__BOUND_AT_EXECUTION__"
            ? `PROOFLINE_WAL_G_BINARY_SHA256=${walG.binarySha256}`
            : value);
        await runDocker(arguments_, environment, snapshot.sourceRoot, buildxExecutable);
        return { id, layoutRoot: command.layoutRoot };
      },
      inspectAndPackImage: async ({ id, index, repository, build }) => {
        const filename = `images/${String(index + 1).padStart(2, "0")}-${id}.linux-amd64.oci.tar`;
        await mkdir(join(paths.archives, "images"), { recursive: true, mode: 0o700 });
        let packed;
        try {
          packed = await writeCanonicalOciArchive({
            layoutRoot: build.layoutRoot,
            outputPath: join(paths.archives, filename),
          });
        } catch {
          throw new Error(`OCI release archive is invalid (${id})`);
        }
        return Object.freeze({ id, repository, filename, ...packed });
      },
      writeManifestAndReceipt: async ({ source, archives }) => {
        archiveResults = archives;
        const migrationPath = join(source.sourceRoot, "apps/api/db/migrations/manifest.v1.json");
        const actionMetadataPath = join(source.sourceRoot, "packages/action/action.yml");
        const actionArtifactPath = join(source.sourceRoot, "packages/action/dist/index.js");
        const walGLockPath = join(source.sourceRoot, "docker/wal-g-release.v1.json");
        const [migrationBytes, actionMetadataBytes, actionArtifactBytes, walGLockBytes] = await Promise.all([
          readFile(migrationPath), readFile(actionMetadataPath), readFile(actionArtifactPath), readFile(walGLockPath),
        ]);
        const migration = JSON.parse(migrationBytes.toString("utf8"));
        if (migration?.schema?.targetVersion !== 10 || migration.schema.minimumCompatibleVersion !== 10 ||
          migration.schema.maximumCompatibleVersion !== 10 || migration?.migrations?.length !== 10) fail("Migration release input is invalid");
        const manifest = FrozenOciReleaseManifestV1Schema.parse({
          version: "1",
          kind: "frozen-oci-release-manifest",
          producer: source.producer,
          database: {
            migrationManifestPath: "apps/api/db/migrations/manifest.v1.json",
            migrationManifestSha256: sha256(migrationBytes),
            targetVersion: 10,
            minimumCompatibleVersion: 10,
            maximumCompatibleVersion: 10,
          },
          action: {
            metadataPath: "packages/action/action.yml",
            metadataSha256: sha256(actionMetadataBytes),
            artifactPath: "packages/action/dist/index.js",
            artifactSha256: sha256(actionArtifactBytes),
          },
          recovery: {
            walGVersion: "v3.0.8",
            walGReleaseLockPath: "docker/wal-g-release.v1.json",
            walGReleaseLockSha256: sha256(walGLockBytes),
            walGReceiptSha256: walG.receiptSha256,
            walGBinarySha256: walG.binarySha256,
          },
          images: archives.map((archive) => ({
            id: archive.id,
            repository: archive.repository,
            reference: `${archive.repository}@${archive.imageManifestDigest}`,
            platform: archive.platform,
            archiveFilename: archive.filename,
            archiveFormat: "oci-image-layout-v1.0.0+ustar",
            archiveSizeBytes: archive.archiveSizeBytes,
            archiveSha256: archive.archiveSha256,
            imageManifestDigest: archive.imageManifestDigest,
          })),
        });
        const manifestBytes = Buffer.from(canonicalSerializeFrozenOciReleaseManifest(manifest), "utf8");
        const artifacts = [
          {
            filename: "frozen-release-manifest.v1.json",
            sizeBytes: manifestBytes.byteLength,
            sha256: sha256(manifestBytes),
          },
          ...archives.map((archive) => ({
            filename: archive.filename,
            sizeBytes: archive.archiveSizeBytes,
            sha256: archive.archiveSha256,
          })),
        ].sort((left, right) => left.filename.localeCompare(right.filename, "en"));
        const receipt = FrozenOciReleaseReceiptV1Schema.parse({
          version: "1",
          kind: "frozen-oci-release-receipt",
          status: "passed",
          verification: "verified",
          releaseClaim: true,
          producer: { commitSha: source.producer.commitSha, treeSha: source.producer.treeSha },
          frozenReleaseManifestSha256: sha256(manifestBytes),
          artifacts,
          artifactInventorySha256: checksumReleaseArtifactInventory(artifacts),
        });
        await mkdir(join(stageRoot, "images"), { recursive: true, mode: 0o700 });
        await writeFile(join(stageRoot, "frozen-release-manifest.v1.json"), manifestBytes, { mode: 0o600, flag: "wx" });
        await writeFile(join(stageRoot, "frozen-release-receipt.v1.json"), canonicalSerializeFrozenOciReleaseReceipt(receipt), { mode: 0o600, flag: "wx" });
        for (const archive of archives) await copyFile(join(paths.archives, archive.filename), join(stageRoot, archive.filename));
        return { stageRoot, manifest, receipt };
      },
      finalizeResources: async () => {
        if (snapshot?.sourceRoot) await removeReleaseCapturedInput(snapshot.sourceRoot);
        if (walG?.contextRoot) await removeReleaseCapturedInput(walG.contextRoot);
        for (const path of [paths.layouts, paths.archives]) await thawAndRemove(path);
        finalized = true;
      },
      verifyFinalSource: async () => {
        await verifyReleaseSourceForPublication({ producer: snapshot.producer, runGit });
      },
      publish: async () => publishFrozenReleaseOutput({ stageRoot, outputDirectory }),
      discard: async () => {
        await thawAndRemove(stageRoot);
        await thawAndRemove(outputDirectory);
      },
    });
    process.stdout.write(`${JSON.stringify({ status: result.status, producer: snapshot.producer, imageCount: archiveResults.length })}\n`);
  } finally {
    if (!finalized) {
      if (snapshot?.sourceRoot) await removeReleaseCapturedInput(snapshot.sourceRoot).catch(() => undefined);
      if (walG?.contextRoot) await removeReleaseCapturedInput(walG.contextRoot).catch(() => undefined);
    }
    await thawAndRemove(temporaryRoot).catch(() => undefined);
  }
}

main().catch((cause) => {
  process.stderr.write(`${cause?.message ?? "Offline OCI release freeze failed"}\n`);
  process.exitCode = 1;
});
