import { chmod, lstat, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

export const RELEASE_IMAGE_BUILDS = Object.freeze([
  Object.freeze({ id: "caddy", repository: "proofline/caddy", dockerfile: "docker/caddy.Dockerfile" }),
  Object.freeze({ id: "web", repository: "proofline/web", dockerfile: "docker/Dockerfile", target: "web" }),
  Object.freeze({ id: "api", repository: "proofline/api", dockerfile: "docker/Dockerfile", target: "api" }),
  Object.freeze({ id: "worker", repository: "proofline/worker", dockerfile: "docker/Dockerfile", target: "worker" }),
  Object.freeze({ id: "postgres-recovery", repository: "proofline/postgres-recovery", dockerfile: "docker/postgres-recovery.Dockerfile", walGContext: true }),
]);

const EXPECTED_OUTPUT_FILES = Object.freeze([
  "frozen-release-manifest.v1.json",
  "frozen-release-receipt.v1.json",
  ...RELEASE_IMAGE_BUILDS.map(({ id }, index) =>
    `images/${String(index + 1).padStart(2, "0")}-${id}.linux-amd64.oci.tar`),
].sort());

function failEnvironment() {
  throw Object.assign(new Error("Offline release environment is invalid"), { code: "RELEASE_ENV_INVALID" });
}

function assertAbsolute(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) failEnvironment();
}

export function createReleaseBuildCommands({ sourceRoot, walGContextRoot, sourceDateEpoch, layoutsRoot } = {}) {
  assertAbsolute(sourceRoot);
  assertAbsolute(walGContextRoot);
  assertAbsolute(layoutsRoot);
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 1) failEnvironment();
  return RELEASE_IMAGE_BUILDS.map((build, index) => {
    const layoutRoot = join(layoutsRoot, `${String(index + 1).padStart(2, "0")}-${build.id}`);
    const arguments_ = [
      "buildx", "build",
      "--platform", "linux/amd64",
      "--pull=false",
      "--network", "none",
      "--provenance=false",
      "--sbom=false",
      "--output", `type=oci,dest=${layoutRoot},tar=false,name=${build.repository}:source-${sourceDateEpoch},oci-mediatypes=true,rewrite-timestamp=true`,
      "--file", join(sourceRoot, build.dockerfile),
    ];
    if (build.target) arguments_.push("--target", build.target, "--build-arg", "NPM_CONFIG_OFFLINE=true");
    if (build.walGContext) arguments_.push(
      "--build-context", `wal_g_release=${walGContextRoot}`,
      "--build-arg", "PROOFLINE_WAL_G_BINARY_SHA256=__BOUND_AT_EXECUTION__",
    );
    arguments_.push(sourceRoot);
    return Object.freeze({ id: build.id, repository: build.repository, layoutRoot, arguments: Object.freeze(arguments_) });
  });
}

export function createOfflineReleaseEnvironment({
  ambientEnvironment = {}, dockerConfigDirectory, homeDirectory,
  temporaryDirectory, xdgConfigDirectory, sourceDateEpoch,
} = {}) {
  for (const path of [dockerConfigDirectory, homeDirectory, temporaryDirectory, xdgConfigDirectory]) assertAbsolute(path);
  if (typeof ambientEnvironment.PATH !== "string" || ambientEnvironment.PATH.length < 1 ||
    !Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 1) failEnvironment();
  const dockerHost = ambientEnvironment.DOCKER_HOST;
  if (dockerHost !== undefined && !/^unix:\/\/[A-Za-z0-9_./-]+$/.test(dockerHost)) failEnvironment();
  return Object.freeze({
    PATH: ambientEnvironment.PATH,
    ...(dockerHost ? { DOCKER_HOST: dockerHost } : {}),
    DOCKER_CONFIG: dockerConfigDirectory,
    HOME: homeDirectory,
    LANG: "C",
    LC_ALL: "C",
    SOURCE_DATE_EPOCH: String(sourceDateEpoch),
    TMPDIR: temporaryDirectory,
    TZ: "UTC",
    XDG_CONFIG_HOME: xdgConfigDirectory,
  });
}

async function walk(root, prefix = "") {
  const files = [];
  const directories = [root];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = join(root, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("Release output contains a symlink");
    if (metadata.isDirectory()) {
      const nested = await walk(path, relativePath);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else if (metadata.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error("Release output contains an unsupported entry");
    }
  }
  return { files, directories };
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

export async function publishFrozenReleaseOutput({ stageRoot, outputDirectory, afterRename = async () => {} } = {}) {
  if (typeof afterRename !== "function" || !isAbsolute(stageRoot ?? "") || !isAbsolute(outputDirectory ?? "") ||
    stageRoot === outputDirectory || dirname(stageRoot) !== dirname(outputDirectory) ||
    [stageRoot, outputDirectory].some((path) => path.includes("\0") || ["", ".", ".."].includes(basename(path)))) {
    throw new Error("Release publication boundary is invalid");
  }
  try {
    const stageMetadata = await lstat(stageRoot);
    if (!stageMetadata.isDirectory() || stageMetadata.isSymbolicLink()) throw new Error("Release stage is invalid");
    await lstat(outputDirectory).then(() => { throw new Error("Release output already exists"); }, (cause) => {
      if (cause?.code !== "ENOENT") throw cause;
    });
    const staged = await walk(stageRoot);
    for (const file of staged.files) await chmod(join(stageRoot, file), 0o400);
    for (const directory of staged.directories.reverse()) await chmod(directory, 0o500);
    await rename(stageRoot, outputDirectory);
    await afterRename();
    const published = await walk(outputDirectory);
    if (JSON.stringify(published.files.sort()) !== JSON.stringify(EXPECTED_OUTPUT_FILES)) {
      throw new Error("Release output inventory is invalid");
    }
    return Object.freeze({ status: "passed", outputDirectory });
  } catch (cause) {
    await thawAndRemove(stageRoot).catch(() => undefined);
    await thawAndRemove(outputDirectory).catch(() => undefined);
    throw cause;
  }
}

export async function runOfflineOciReleaseFreeze({
  captureSource, captureWalG, verifyCapability, buildImage,
  inspectAndPackImage, writeManifestAndReceipt, finalizeResources,
  verifyFinalSource, publish, discard,
} = {}) {
  const required = [captureSource, captureWalG, verifyCapability, buildImage,
    inspectAndPackImage, writeManifestAndReceipt, finalizeResources,
    verifyFinalSource, publish, discard];
  if (required.some((operation) => typeof operation !== "function")) throw new Error("Release lifecycle is invalid");
  try {
    const source = await captureSource();
    const walG = await captureWalG(source);
    await verifyCapability({ source, walG });
    const builds = [];
    for (const build of RELEASE_IMAGE_BUILDS) builds.push(await buildImage({ ...build, source, walG }));
    const archives = [];
    for (let index = 0; index < RELEASE_IMAGE_BUILDS.length; index += 1) {
      archives.push(await inspectAndPackImage({ ...RELEASE_IMAGE_BUILDS[index], index, build: builds[index], source, walG }));
    }
    const staged = await writeManifestAndReceipt({ source, walG, builds, archives });
    await finalizeResources({ source, walG, builds, archives, staged });
    await verifyFinalSource({ source, walG, builds, archives, staged });
    return await publish({ source, walG, builds, archives, staged });
  } catch (cause) {
    await discard().catch(() => undefined);
    throw cause;
  }
}
