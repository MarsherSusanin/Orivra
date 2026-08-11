import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const shaBytes = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sha = (value) => `sha256:${value.repeat(64).slice(0, 64)}`;
const imageIds = ["caddy", "web", "api", "worker", "postgres-recovery"];

async function runtime() {
  return import("../../scripts/ghcr-publication-runtime.mjs").catch(() => ({}));
}

function publicationFixture() {
  const images = imageIds.map((id, index) => ({
    id,
    sourceRepository: `proofline/${id}`,
    archiveFilename: `images/0${index + 1}-${id}.linux-amd64.oci.tar`,
    archiveSizeBytes: 1_024 + index,
    archiveSha256: sha(String(9 - index)),
    imageManifestDigest: sha(String(index + 1)),
    platform: "linux/amd64",
    remoteRepository: `ghcr.io/example-owner/orivra-${id}`,
  }));
  return {
    images,
    targetMap: {
      version: "1",
      kind: "ghcr-publication-targets",
      registry: "ghcr.io",
      images: images.map(({ id, sourceRepository, remoteRepository }) => ({
        id,
        sourceRepository,
        remoteRepository,
      })),
    },
  };
}

test("028B exposes only one file-backed minimal GHCR write environment", async () => {
  const module = await runtime();
  const parent = await mkdtemp(join(tmpdir(), "proofline-028b-auth-"));
  const tokenFile = join(parent, "ghcr-write-token");
  try {
    await writeFile(tokenFile, "ghcr-write-secret", { mode: 0o400 });
    const environment = await module.createPublicationCredentialEnvironment({
      ambientEnvironment: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/example",
        DOCKER_CONFIG: "/Users/example/.docker",
        GITHUB_TOKEN: "ambient-github-secret",
        GHCR_TOKEN: "ambient-ghcr-secret",
        DIGITALOCEAN_ACCESS_TOKEN: "ambient-do-secret",
        SSH_AUTH_SOCK: "/tmp/agent",
        HTTPS_PROXY: "https://credential@proxy.invalid",
      },
      username: "example-operator",
      tokenFile,
      inspectSecretFile: lstat,
    });
    assert.deepEqual(environment, {
      PATH: "/usr/bin:/bin",
      PROOFLINE_GHCR_USERNAME: "example-operator",
      PROOFLINE_GHCR_WRITE_TOKEN_FILE: tokenFile,
    });
    assert.doesNotMatch(JSON.stringify(environment), /secret|proxy|\.docker|SSH_AUTH_SOCK/);
  } finally {
    await chmod(tokenFile, 0o600).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});

test("028B safely inspects one bounded exact OCI manifest and its reachable blobs", async () => {
  const module = await runtime();
  const config = Buffer.from('{"architecture":"amd64","os":"linux"}');
  const layer = Buffer.from("layer");
  const configDigest = shaBytes(config);
  const layerDigest = shaBytes(layer);
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: config.length },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: layerDigest, size: layer.length }],
  }));
  const manifestDigest = shaBytes(manifest);
  const index = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: manifestDigest,
      size: manifest.length,
      platform: { architecture: "amd64", os: "linux" },
    }],
  }));
  const entries = [
    { path: `blobs/sha256/${configDigest.slice(7)}`, type: "file", bytes: config },
    { path: `blobs/sha256/${layerDigest.slice(7)}`, type: "file", bytes: layer },
    { path: `blobs/sha256/${manifestDigest.slice(7)}`, type: "file", bytes: manifest },
    { path: "index.json", type: "file", bytes: index },
    { path: "oci-layout", type: "file", bytes: Buffer.from('{"imageLayoutVersion":"1.0.0"}') },
  ];
  const expected = {
    archiveSizeBytes: 4_096,
    archiveSha256: sha("a"),
    imageManifestDigest: manifestDigest,
    platform: "linux/amd64",
  };
  const inspected = await module.inspectFrozenOciArchiveForPublication({
    archivePath: "/private/input/image.oci.tar",
    expected,
    inspectArchive: async () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o100400, size: 4_096 }),
    checksumArchive: async () => expected.archiveSha256,
    readEntries: async () => entries,
    limits: { maxEntries: 4_096, maxJsonBytes: 1_048_576, maxTotalBlobBytes: 4_294_967_296 },
  });
  assert.equal(inspected.imageManifestDigest, manifestDigest);
  assert.deepEqual(inspected.blobs.map(({ digest }) => digest).sort(),
    [configDigest, layerDigest, manifestDigest].sort());

  for (const badEntries of [
    entries.map((entry, index_) => index_ === 0 ? { ...entry, path: "../escape" } : entry),
    entries.map((entry, index_) => index_ === 0 ? { ...entry, type: "symlink" } : entry),
    [...entries, entries[0]],
    entries.filter(({ path }) => path !== `blobs/sha256/${layerDigest.slice(7)}`),
  ]) {
    await assert.rejects(() => module.inspectFrozenOciArchiveForPublication({
      archivePath: "/private/input/image.oci.tar",
      expected,
      inspectArchive: async () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o100400, size: 4_096 }),
      checksumArchive: async () => expected.archiveSha256,
      readEntries: async () => badEntries,
      limits: { maxEntries: 4_096, maxJsonBytes: 1_048_576, maxTotalBlobBytes: 4_294_967_296 },
    }), { code: "OCI_PUBLICATION_ARCHIVE_INVALID" });
  }
});

test("028B verifies every archive before the first registry effect and preserves manifest digests", async () => {
  const module = await runtime();
  const { images, targetMap } = publicationFixture();
  const order = [];
  const results = await module.publishFrozenImagesToGhcr({
    images,
    targetMap,
    inspectArchive: async (image) => {
      order.push(`verify:${image.id}`);
      return { imageManifestDigest: image.imageManifestDigest, blobs: Object.freeze([]) };
    },
    registryAdapter: {
      copyVerifiedImage: async ({ image, remoteRepository }) => {
        order.push(`copy:${image.id}:${remoteRepository}`);
      },
      inspectRemoteDigest: async ({ image }) => {
        order.push(`inspect:${image.id}`);
        return image.imageManifestDigest;
      },
    },
  });
  assert.deepEqual(order.slice(0, 5), imageIds.map((id) => `verify:${id}`));
  assert.deepEqual(results.map(({ remoteDigest }) => remoteDigest),
    images.map(({ imageManifestDigest }) => imageManifestDigest));
  assert.doesNotMatch(order.join("\n"), /build|load|latest/);
});

test("028B reports a partial publication but writes no PASS or staging authority", async () => {
  const module = await runtime();
  const { images, targetMap } = publicationFixture();
  let publicationWrites = 0;
  let stagingCalls = 0;
  const cause = await module.runGhcrPublication({
    images,
    targetMap,
    inspectArchive: async (image) => ({ imageManifestDigest: image.imageManifestDigest, blobs: [] }),
    registryAdapter: {
      copyVerifiedImage: async () => undefined,
      inspectRemoteDigest: async ({ image }) => image.id === "api" ? sha("f") : image.imageManifestDigest,
    },
    appendEvidence: async () => { publicationWrites += 1; },
    startStaging: async () => { stagingCalls += 1; },
    cleanup: async () => undefined,
  }).catch((error) => error);
  assert.equal(cause.code, "GHCR_REMOTE_DIGEST_MISMATCH");
  assert.deepEqual(cause.partialPublication, {
    publishedImageIds: ["caddy", "web"],
    failedImageId: "api",
    publicationEvidenceWritten: false,
    stagingStarted: false,
  });
  assert.equal(publicationWrites, 0);
  assert.equal(stagingCalls, 0);
  assert.doesNotMatch(JSON.stringify(cause), /token|private|secret|\/private\//i);
});

test("028B conditionally creates append-only evidence and never masks cleanup failure", async () => {
  const module = await runtime();
  const originalFailure = new Error("registry-effect-failed");
  const cleanupFailure = new Error("owned-cleanup-failed");
  const aggregate = await module.runGhcrPublication({
    images: publicationFixture().images,
    targetMap: publicationFixture().targetMap,
    inspectArchive: async () => { throw originalFailure; },
    registryAdapter: {},
    appendEvidence: async () => { throw new Error("PASS evidence must not be written"); },
    startStaging: async () => { throw new Error("staging must not start"); },
    cleanup: async () => { throw cleanupFailure; },
  }).catch((error) => error);
  assert.equal(aggregate instanceof AggregateError, true);
  assert.deepEqual(aggregate.errors, [originalFailure, cleanupFailure]);
  assert.equal(aggregate.cause, originalFailure);

  const existing = Buffer.from("caller-owned-publication-evidence");
  let preserved = Buffer.from(existing);
  await assert.rejects(() => module.appendPublicationEvidence({
    filename: "publication-evidence.v1.json",
    bytes: Buffer.from("new-evidence"),
    putIfAbsent: async () => false,
    readExisting: async () => preserved,
  }), { code: "PUBLICATION_EVIDENCE_EXISTS" });
  assert.equal(preserved.equals(existing), true);
});
