import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporaryDirectories = [];
const expectedBuilds = [
  { id: "caddy", repository: "proofline/caddy", dockerfile: "docker/caddy.Dockerfile" },
  { id: "web", repository: "proofline/web", dockerfile: "docker/Dockerfile", target: "web" },
  { id: "api", repository: "proofline/api", dockerfile: "docker/Dockerfile", target: "api" },
  { id: "worker", repository: "proofline/worker", dockerfile: "docker/Dockerfile", target: "worker" },
  {
    id: "postgres-recovery",
    repository: "proofline/postgres-recovery",
    dockerfile: "docker/postgres-recovery.Dockerfile",
    walGContext: true,
  },
];

async function writeValidOciLayout(layoutRoot) {
  await mkdir(join(layoutRoot, "blobs", "sha256"), { recursive: true });
  const configuration = Buffer.from('{"architecture":"amd64","os":"linux"}');
  const layer = Buffer.from("release-layer");
  const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: digest(configuration),
      size: configuration.length,
    },
    layers: [{
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: digest(layer),
      size: layer.length,
    }],
  }));
  const manifestDigest = digest(manifest);
  await writeFile(join(layoutRoot, "oci-layout"), '{"imageLayoutVersion":"1.0.0"}');
  await writeFile(join(layoutRoot, "index.json"), JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: manifestDigest,
      size: manifest.length,
      platform: { architecture: "amd64", os: "linux" },
    }],
  }));
  for (const value of [configuration, layer, manifest]) {
    await writeFile(join(layoutRoot, "blobs", "sha256", digest(value).slice(7)), value);
  }
}

async function optionalModule(path) {
  return import(`${pathToFileURL(resolve(root, path)).href}?red=028a`).catch(() => ({}));
}

async function temporary(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeTreeRemovable(path) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (metadata.isSymbolicLink()) return;
  if (metadata.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      await makeTreeRemovable(join(path, entry.name));
    }
    return;
  }
  await chmod(path, 0o600);
}

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await makeTreeRemovable(directory);
    await rm(directory, { recursive: true, force: true });
  }));
});

test("declares the exact five build-once OCI directory outputs", async () => {
  const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
  assert.deepEqual(module.RELEASE_IMAGE_BUILDS, expectedBuilds);
  const commands = module.createReleaseBuildCommands({
    sourceRoot: "/private/source",
    walGContextRoot: "/private/wal-g",
    sourceDateEpoch: 1_754_870_400,
    layoutsRoot: "/private/layouts",
  });
  assert.equal(commands.length, 5);
  assert.equal(new Set(commands.map((entry) => entry.id)).size, 5);
  for (const command of commands) {
    const joined = command.arguments.join("\0");
    assert.match(joined, /buildx\0build/);
    assert.match(joined, /--platform\0linux\/amd64/);
    assert.match(joined, /--pull=false/);
    assert.match(joined, /--network\0none/);
    assert.match(joined, /--provenance=false/);
    assert.match(joined, /--sbom=false/);
    assert.match(joined, /type=oci,[^\0]*tar=false[^\0]*oci-mediatypes=true[^\0]*rewrite-timestamp=true/);
    assert.doesNotMatch(joined, /--load|--push|pull\0|login|imagetools|prefetch|https?:/i);
    assert.equal(command.arguments.at(-1), "/private/source");
  }
  assert.match(commands.at(-1).arguments.join("\0"), /wal_g_release=\/private\/wal-g/);
});

test("creates an exact minimal no-auth environment and rejects remote Docker authority", async () => {
  const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
  const environment = module.createOfflineReleaseEnvironment({
    ambientEnvironment: {
      PATH: "/usr/bin",
      DOCKER_HOST: "unix:///private/tmp/docker.sock",
      DOCKER_CONFIG: "/ambient/docker",
      DOCKER_CONTEXT: "remote",
      DOCKER_TLS_VERIFY: "1",
      SSH_AUTH_SOCK: "/ambient/ssh",
      HTTPS_PROXY: "https://secret@example.test",
      AWS_SECRET_ACCESS_KEY: "sentinel-aws",
      GITHUB_TOKEN: "sentinel-gh",
      PROOFLINE_COSTON2_PRIVATE_KEY: "sentinel-key",
    },
    dockerConfigDirectory: "/private/docker-config",
    homeDirectory: "/private/home",
    temporaryDirectory: "/private/tmp",
    xdgConfigDirectory: "/private/xdg",
    sourceDateEpoch: 1_754_870_400,
  });
  assert.deepEqual(Object.keys(environment).sort(), [
    "DOCKER_CONFIG", "DOCKER_HOST", "HOME", "LANG", "LC_ALL", "PATH",
    "SOURCE_DATE_EPOCH", "TMPDIR", "TZ", "XDG_CONFIG_HOME",
  ].sort());
  assert.equal(environment.DOCKER_HOST, "unix:///private/tmp/docker.sock");
  assert.equal(environment.LANG, "C");
  assert.equal(environment.LC_ALL, "C");
  assert.equal(environment.TZ, "UTC");
  assert.equal(Object.values(environment).join("\n").includes("sentinel-"), false);
  assert.throws(() => module.createOfflineReleaseEnvironment({
    ambientEnvironment: { PATH: "/usr/bin", DOCKER_HOST: "ssh://builder.example" },
    dockerConfigDirectory: "/private/docker-config",
    homeDirectory: "/private/home",
    temporaryDirectory: "/private/tmp",
    xdgConfigDirectory: "/private/xdg",
    sourceDateEpoch: 1_754_870_400,
  }), { code: "RELEASE_ENV_INVALID" });
});

test("captures only a clean commit-derived private source snapshot", async () => {
  const module = await optionalModule("scripts/release-input-authority.mjs");
  const parent = await temporary("proofline-028a-source-");
  const calls = [];
  const runGit = async (arguments_) => {
    calls.push(arguments_);
    const key = arguments_.join(" ");
    if (key === "rev-parse HEAD") return { exitCode: 0, stdout: `${"a".repeat(40)}\n` };
    if (key === `rev-parse ${"a".repeat(40)}^{tree}`) {
      return { exitCode: 0, stdout: `${"b".repeat(40)}\n` };
    }
    if (key === "show -s --format=%ct " + "a".repeat(40)) {
      return { exitCode: 0, stdout: "1754870400\n" };
    }
    if (key === "status --porcelain=v1 --untracked-files=all") {
      return { exitCode: 0, stdout: "" };
    }
    throw new Error(`unexpected git call ${key}`);
  };
  const snapshot = await module.captureReleaseSourceSnapshot({
    repositoryRoot: root,
    snapshotParentDirectory: parent,
    runGit,
    materializeCommit: async ({ sourceRoot }) => {
      await mkdir(sourceRoot, { mode: 0o700 });
      await writeFile(join(sourceRoot, "package.json"), "{}", { mode: 0o600 });
    },
  });
  assert.deepEqual(snapshot.producer, {
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    sourceSnapshotSha256: snapshot.producer.sourceSnapshotSha256,
    sourceDateEpoch: 1_754_870_400,
    verification: "verified",
    releaseClaim: true,
  });
  assert.match(snapshot.producer.sourceSnapshotSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await stat(snapshot.sourceRoot)).mode & 0o777, 0o500);
  assert.equal((await stat(join(snapshot.sourceRoot, "package.json"))).mode & 0o777, 0o400);
  assert.deepEqual(calls.at(0), ["rev-parse", "HEAD"]);
});

test("rejects a dirty producer without materializing a draft", async () => {
  const module = await optionalModule("scripts/release-input-authority.mjs");
  const parent = await temporary("proofline-028a-dirty-");
  let materialized = false;
  await assert.rejects(module.captureReleaseSourceSnapshot({
    repositoryRoot: root,
    snapshotParentDirectory: parent,
    runGit: async (arguments_) => {
      const key = arguments_.join(" ");
      if (key === "rev-parse HEAD") return { exitCode: 0, stdout: `${"a".repeat(40)}\n` };
      if (key.includes("^{tree}")) return { exitCode: 0, stdout: `${"b".repeat(40)}\n` };
      if (key.startsWith("show ")) return { exitCode: 0, stdout: "1754870400\n" };
      return { exitCode: 0, stdout: " M package.json\n" };
    },
    materializeCommit: async () => { materialized = true; },
  }), { code: "RELEASE_SOURCE_INVALID" });
  assert.equal(materialized, false);
});

test("rechecks exact HEAD, captured commit tree and empty status before publication", async () => {
  const module = await optionalModule("scripts/release-input-authority.mjs");
  const producer = {
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    verification: "verified",
    releaseClaim: true,
  };
  const runGit = async (arguments_) => {
    const key = arguments_.join(" ");
    if (key === "rev-parse HEAD") return { exitCode: 0, stdout: `${producer.commitSha}\n` };
    if (key.includes("^{tree}")) return { exitCode: 0, stdout: `${producer.treeSha}\n` };
    return { exitCode: 0, stdout: "" };
  };
  assert.deepEqual(await module.verifyReleaseSourceForPublication({ producer, runGit }), producer);
  await assert.rejects(module.verifyReleaseSourceForPublication({
    producer,
    runGit: async (arguments_) => arguments_[0] === "status"
      ? { exitCode: 0, stdout: "?? changed" }
      : runGit(arguments_),
  }), { code: "RELEASE_SOURCE_CHANGED" });
});

test("captures caller-supplied WAL-G bytes at use time and never invokes prefetch", async () => {
  const module = await optionalModule("scripts/release-input-authority.mjs");
  const inputRoot = await temporary("proofline-028a-wal-g-input-");
  const captureParent = await temporary("proofline-028a-wal-g-capture-");
  const binary = Buffer.from("locked-wal-g-binary");
  const { createHash } = await import("node:crypto");
  const digest = `sha256:${createHash("sha256").update(binary).digest("hex")}`;
  await writeFile(join(inputRoot, "wal-g"), binary, { mode: 0o555 });
  await writeFile(join(inputRoot, "receipt.v1.json"), JSON.stringify({
    binarySha256: digest,
    binarySize: binary.length,
    version: "1",
  }), { mode: 0o444 });
  const captured = await module.captureVerifiedReleaseWalG({
    inputRoot,
    captureParentDirectory: captureParent,
    lock: {
      version: "1",
      walGVersion: "v3.0.8",
      platform: "linux/amd64",
      maximumBytes: 1024,
      binarySha256: digest,
    },
  });
  assert.equal((await readFile(join(captured.contextRoot, "wal-g"))).equals(binary), true);
  assert.equal((await stat(captured.contextRoot)).mode & 0o777, 0o500);
  assert.equal((await stat(join(captured.contextRoot, "wal-g"))).mode & 0o777, 0o400);
  assert.equal(captured.binarySha256, digest);
  assert.equal(JSON.stringify(captured).includes("prefetch"), false);
});

test("packs the same accepted OCI layout to byte-identical ustar twice", async () => {
  const module = await optionalModule("scripts/oci-layout-archive.mjs");
  const layoutRoot = await temporary("proofline-028a-layout-");
  const outputRoot = await temporary("proofline-028a-archives-");
  await writeValidOciLayout(layoutRoot);
  const first = join(outputRoot, "first.oci.tar");
  const second = join(outputRoot, "second.oci.tar");
  const one = await module.writeCanonicalOciArchive({ layoutRoot, outputPath: first });
  const two = await module.writeCanonicalOciArchive({ layoutRoot, outputPath: second });
  assert.equal((await readFile(first)).equals(await readFile(second)), true);
  assert.equal(one.archiveSha256, two.archiveSha256);
  assert.equal((await stat(first)).mode & 0o777, 0o600);
});

test("preserves a pre-existing caller OCI archive after exclusive-create rejection", async () => {
  const module = await optionalModule("scripts/oci-layout-archive.mjs");
  const parent = await temporary("proofline-028a-existing-archive-");
  const layoutRoot = join(parent, "layout");
  const outputPath = join(parent, "caller-owned.oci.tar");
  const sentinelBytes = Buffer.from("caller-owned-oci-archive");
  await writeValidOciLayout(layoutRoot);
  await writeFile(outputPath, sentinelBytes, { mode: 0o600 });
  await chmod(outputPath, 0o400);
  await assert.rejects(module.writeCanonicalOciArchive({ layoutRoot, outputPath }), {
    code: "OCI_RELEASE_ARCHIVE_INVALID",
  });
  assert.equal((await readFile(outputPath)).equals(sentinelBytes), true);
  assert.equal((await lstat(outputPath)).mode & 0o777, 0o400);
});

for (const controlPath of ["blobs", "blobs/sha256", "index.json", "oci-layout"]) {
  test(`rejects symlinked OCI control path ${controlPath} before output creation`, async () => {
    const module = await optionalModule("scripts/oci-layout-archive.mjs");
    const parent = await temporary("proofline-028a-layout-symlink-");
    const layoutRoot = join(parent, "layout");
    const externalRoot = join(parent, "external");
    const outputPath = join(parent, "release.oci.tar");
    await writeValidOciLayout(layoutRoot);
    await mkdir(externalRoot, { mode: 0o700 });
    const source = join(layoutRoot, controlPath);
    const target = join(externalRoot, controlPath.replaceAll("/", "-"));
    await rename(source, target);
    await symlink(target, source);
    await assert.rejects(module.writeCanonicalOciArchive({ layoutRoot, outputPath }), {
      code: "OCI_RELEASE_ARCHIVE_INVALID",
    });
    assert.equal(await lstat(outputPath).then(() => true, () => false), false);
  });
}

test("publishes exactly seven files atomically as a read-only handoff", async () => {
  const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
  assert.equal(typeof module.publishFrozenReleaseOutput, "function");
  const parent = await temporary("proofline-028a-publish-");
  const stageRoot = join(parent, ".release-stage");
  const outputDirectory = join(parent, "release");
  await mkdir(join(stageRoot, "images"), { recursive: true, mode: 0o700 });
  const filenames = [
    "frozen-release-manifest.v1.json",
    "frozen-release-receipt.v1.json",
    ...expectedBuilds.map(({ id }, index) =>
      `images/${String(index + 1).padStart(2, "0")}-${id}.linux-amd64.oci.tar`),
  ];
  for (const filename of filenames) {
    await writeFile(join(stageRoot, filename), filename, { mode: 0o600 });
  }
  await module.publishFrozenReleaseOutput({ stageRoot, outputDirectory });
  assert.equal(await stat(stageRoot).then(() => true, () => false), false);
  assert.deepEqual((await readdir(outputDirectory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath.slice(outputDirectory.length + 1), entry.name))
    .sort(), filenames.sort());
  assert.equal((await stat(outputDirectory)).mode & 0o777, 0o500);
  assert.equal((await stat(join(outputDirectory, "images"))).mode & 0o777, 0o500);
  for (const filename of filenames) {
    assert.equal((await stat(join(outputDirectory, filename))).mode & 0o777, 0o400);
  }
  await chmod(outputDirectory, 0o700);
  await chmod(join(outputDirectory, "images"), 0o700);
});

test("discards both stage and final output when atomic publication throws after rename", async () => {
  const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
  assert.equal(typeof module.publishFrozenReleaseOutput, "function");
  const parent = await temporary("proofline-028a-publish-failure-");
  const stageRoot = join(parent, ".release-stage");
  const outputDirectory = join(parent, "release");
  await mkdir(stageRoot, { mode: 0o700 });
  await writeFile(join(stageRoot, "frozen-release-manifest.v1.json"), "{}", { mode: 0o600 });
  await assert.rejects(module.publishFrozenReleaseOutput({
    stageRoot,
    outputDirectory,
    afterRename: async () => { throw new Error("injected publish failure"); },
  }), /injected publish failure/);
  assert.equal(await stat(stageRoot).then(() => true, () => false), false);
  assert.equal(await stat(outputDirectory).then(() => true, () => false), false);
});

test("preserves a pre-existing caller output byte-for-byte and mode-for-mode", async () => {
  const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
  const parent = await temporary("proofline-028a-existing-output-");
  const stageRoot = join(parent, ".release-stage");
  const outputDirectory = join(parent, "release");
  const sentinel = join(outputDirectory, "caller-owned.txt");
  const sentinelBytes = Buffer.from("caller-owned-output");
  await mkdir(stageRoot, { mode: 0o700 });
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(sentinel, sentinelBytes, { mode: 0o600 });
  await chmod(sentinel, 0o400);
  await chmod(outputDirectory, 0o500);
  await assert.rejects(module.publishFrozenReleaseOutput({ stageRoot, outputDirectory }),
    /Release output already exists/);
  assert.equal((await readFile(sentinel)).equals(sentinelBytes), true);
  assert.equal((await lstat(sentinel)).mode & 0o777, 0o400);
  assert.equal((await lstat(outputDirectory)).mode & 0o777, 0o500);
});

test("unlinks a cleanup symlink without chmod or traversal of its external target", async () => {
  const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
  const parent = await temporary("proofline-028a-cleanup-symlink-");
  const externalParent = await temporary("proofline-028a-cleanup-external-");
  const stageRoot = join(parent, ".release-stage");
  const outputDirectory = join(parent, "release");
  const externalTarget = join(externalParent, "external.txt");
  const externalBytes = Buffer.from("external-target");
  await mkdir(stageRoot, { mode: 0o700 });
  await writeFile(join(stageRoot, "staged.txt"), "staged", { mode: 0o600 });
  await writeFile(externalTarget, externalBytes, { mode: 0o600 });
  await chmod(externalTarget, 0o400);
  await assert.rejects(module.publishFrozenReleaseOutput({
    stageRoot,
    outputDirectory,
    afterRename: async () => {
      await chmod(outputDirectory, 0o700);
      await symlink(externalTarget, join(outputDirectory, "external-link"));
      await chmod(outputDirectory, 0o500);
      throw new Error("injected post-rename failure");
    },
  }), /injected post-rename failure/);
  assert.equal(await lstat(outputDirectory).then(() => true, () => false), false);
  assert.equal((await readFile(externalTarget)).equals(externalBytes), true);
  assert.equal((await lstat(externalTarget)).mode & 0o777, 0o400);
});

test("runs build and packing once per image, finalizes before one terminal publish", async () => {
  const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
  const calls = [];
  const result = await module.runOfflineOciReleaseFreeze({
    captureSource: async () => { calls.push("source"); return { sourceRoot: "/source", producer: { commitSha: "a".repeat(40), treeSha: "b".repeat(40) } }; },
    captureWalG: async () => { calls.push("wal-g"); return { contextRoot: "/wal-g" }; },
    verifyCapability: async () => { calls.push("capability"); },
    buildImage: async ({ id }) => { calls.push(`build:${id}`); return { layoutRoot: `/layout/${id}` }; },
    inspectAndPackImage: async ({ id }) => { calls.push(`pack:${id}`); return { id }; },
    writeManifestAndReceipt: async () => { calls.push("stage"); return { stageRoot: "/stage" }; },
    finalizeResources: async () => { calls.push("finalize"); },
    verifyFinalSource: async () => { calls.push("verify-source"); },
    publish: async () => { calls.push("publish"); return { status: "passed" }; },
    discard: async () => { calls.push("discard"); },
  });
  assert.deepEqual(calls, [
    "source", "wal-g", "capability",
    ...expectedBuilds.map(({ id }) => `build:${id}`),
    ...expectedBuilds.map(({ id }) => `pack:${id}`),
    "stage", "finalize", "verify-source", "publish",
  ]);
  assert.deepEqual(result, { status: "passed" });
});

for (const failureAt of ["capability", "build:api", "pack:worker", "stage", "finalize", "verify-source", "publish"]) {
  test(`leaves zero PASS artifacts when ${failureAt} fails`, async () => {
    const module = await optionalModule("scripts/release-freeze-orchestration.mjs");
    const calls = [];
    const step = async (name, value) => {
      calls.push(name);
      if (name === failureAt) throw new Error(`failed:${name}`);
      return value;
    };
    await assert.rejects(module.runOfflineOciReleaseFreeze({
      captureSource: () => step("source", { sourceRoot: "/source", producer: {} }),
      captureWalG: () => step("wal-g", { contextRoot: "/wal-g" }),
      verifyCapability: () => step("capability"),
      buildImage: ({ id }) => step(`build:${id}`, { layoutRoot: `/layout/${id}` }),
      inspectAndPackImage: ({ id }) => step(`pack:${id}`, { id }),
      writeManifestAndReceipt: () => step("stage", { stageRoot: "/stage" }),
      finalizeResources: () => step("finalize"),
      verifyFinalSource: () => step("verify-source"),
      publish: () => step("publish", { status: "passed" }),
      discard: async () => { calls.push("discard"); },
    }), new RegExp(`failed:${failureAt}`));
    assert.equal(calls.includes("discard"), true);
    assert.equal(calls.includes("publish") && failureAt !== "publish", false);
  });
}

test("retains exact six locked base/QA inputs without publishing MinIO archives", async () => {
  const lock = JSON.parse(await readFile(resolve(root, "docker/base-images.json"), "utf8"));
  assert.deepEqual(Object.keys(lock.images), [
    "node", "caddy", "postgres", "postgresRecovery", "minio", "minioClient",
  ]);
  assert.deepEqual(expectedBuilds.map(({ id }) => id), [
    "caddy", "web", "api", "worker", "postgres-recovery",
  ]);
  assert.equal(expectedBuilds.some(({ id }) => id === "minio" || id === "minioClient"), false);
});

test("freezes only accepted OCI release scope and no scanner or hosted claim", async () => {
  const [adr, slice, packageSource] = await Promise.all([
    readFile(resolve(root, "docs/adr/0039-offline-oci-release-freeze.md"), "utf8"),
    readFile(resolve(root, "docs/slices/028a-offline-oci-release-freeze.md"), "utf8"),
    readFile(resolve(root, "package.json"), "utf8"),
  ]);
  assert.match(`${adr}\n${slice}`, /archiveSha256/);
  assert.match(`${adr}\n${slice}`, /imageManifestDigest/);
  assert.match(`${adr}\n${slice}`, /029A[\s\S]*separate/i);
  assert.doesNotMatch(`${adr}\n${slice}`, /Syft|Grype|Trivy|scanner database|SLSA level/i);
  const scripts = JSON.parse(packageSource).scripts;
  assert.equal(scripts["release:freeze"], "node scripts/release-freeze.mjs");
});
