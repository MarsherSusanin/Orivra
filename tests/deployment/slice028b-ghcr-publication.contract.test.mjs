import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
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
    archiveSha256: sha(String.fromCharCode(97 + index)),
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

test("028B authenticates and uploads through one O_NOFOLLOW archive descriptor", async () => {
  const module = await runtime();
  const archivePath = "/private/input/image.oci.tar";
  const manifestBytes = Buffer.from("authenticated-manifest");
  const manifestDigest = shaBytes(manifestBytes);
  const descriptor = Object.freeze({ id: "fd-authenticated-1" });
  const calls = [];
  const capture = await module.captureFrozenOciArchiveForPublication({
    archivePath,
    expected: {
      archiveSizeBytes: 4_096,
      archiveSha256: sha("a"),
      imageManifestDigest: manifestDigest,
      platform: "linux/amd64",
    },
    limits: { maxEntries: 4_096, maxJsonBytes: 1_048_576, maxResidentBytes: 8_388_608 },
    openArchive: async (path, flags) => {
      calls.push(["open", path, flags]);
      return descriptor;
    },
    checksumDescriptor: async (value) => {
      assert.equal(value, descriptor);
      calls.push(["checksum", value.id]);
      return sha("a");
    },
    inspectDescriptor: async (value) => {
      assert.equal(value, descriptor);
      calls.push(["inspect", value.id]);
      return {
        stat: { isFile: true, mode: 0o400, size: 4_096, device: 1, inode: 2 },
        imageManifestDigest: manifestDigest,
        platform: "linux/amd64",
        blobs: [{ digest: manifestDigest, offset: 1_024, size: manifestBytes.byteLength }],
      };
    },
    readDescriptorRange: async (value, { offset, size }) => {
      assert.equal(value, descriptor);
      calls.push(["read", value.id, offset, size]);
      return manifestBytes;
    },
    closeDescriptor: async (value) => {
      assert.equal(value, descriptor);
      calls.push(["close", value.id]);
    },
  });
  assert.deepEqual(calls[0], ["open", archivePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW]);
  assert.equal(calls.filter(([name]) => name === "open").length, 1);
  assert.deepEqual(capture.blobs, [{ digest: manifestDigest, offset: 1_024, size: manifestBytes.byteLength }]);
  assert.equal(Object.hasOwn(capture.blobs[0], "bytes"), false);
  assert.equal(Buffer.from(await capture.readBlob(manifestDigest)).equals(manifestBytes), true);
  assert.equal(calls.filter(([name]) => name === "open").length, 1);
  await capture.dispose();
  assert.deepEqual(calls.at(-1), ["close", descriptor.id]);
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

test("028B uploads blobs in ordered fixed 256 KiB chunks without unsafe replay", async () => {
  const { createGhcrRegistryPublicationAdapter } = await import("../../scripts/ghcr-registry-adapter.mjs");
  const remoteRepository = "ghcr.io/marshersusanin/orivra-caddy";
  const repositoryPath = "/v2/marshersusanin/orivra-caddy";
  const chunkSize = 256 * 1024;
  const layerBytes = Buffer.alloc(15_923_972, 0x2a);
  const layerDigest = shaBytes(layerBytes);
  const manifestDigest = sha("1");
  const manifestBytes = Buffer.from("manifest");
  const header = (headers, name) => Object.entries(headers ?? {})
    .find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const response = (status, headers = {}, payload = undefined) => ({
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => payload,
  });

  const requests = [];
  let acceptedEnd = -1;
  let patchIndex = 0;
  let expectedUploadPath = `${repositoryPath}/blobs/upload/chunk-0`;
  const request = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? "GET";
    requests.push({
      method,
      pathname: url.pathname,
      search: url.search,
      contentLength: header(options.headers, "content-length"),
      contentRange: header(options.headers, "content-range"),
      contentType: header(options.headers, "content-type"),
      bodyLength: options.body?.byteLength ?? 0,
    });
    if (url.pathname === "/token") return response(200, {}, { token: "t".repeat(32) });
    if (method === "HEAD") return response(404);
    if (method === "POST") {
      assert.equal(header(options.headers, "content-length"), "0");
      assert.equal(header(options.headers, "connection"), "close");
      assert.equal(options.body?.byteLength ?? 0, 0);
      return response(202, {
        location: `${repositoryPath}/blobs/upload/chunk-0`,
      });
    }
    if (method === "PATCH") {
      assert.equal(url.pathname, expectedUploadPath);
      assert.equal(url.search, "");
      const start = patchIndex * chunkSize;
      const end = Math.min(start + chunkSize, layerBytes.byteLength) - 1;
      const expected = layerBytes.subarray(start, end + 1);
      assert.equal(header(options.headers, "content-length"), String(expected.byteLength));
      assert.equal(header(options.headers, "content-range"), `${start}-${end}`);
      assert.equal(header(options.headers, "content-type"), "application/octet-stream");
      assert.equal(header(options.headers, "connection"), "close");
      assert.equal(Buffer.from(options.body).equals(expected), true);
      acceptedEnd = end;
      patchIndex += 1;
      expectedUploadPath = patchIndex === 1
        ? `${repositoryPath}/blobs/upload/chunk-0`
        : `${repositoryPath}/blobs/upload/chunk-${patchIndex}`;
      return response(202, {
        location: expectedUploadPath,
        range: `0-${acceptedEnd}`,
      });
    }
    if (method === "PUT" && url.pathname.includes("/blobs/upload/")) {
      assert.equal(url.pathname, expectedUploadPath);
      assert.equal(url.searchParams.get("digest"), layerDigest);
      assert.deepEqual([...url.searchParams.keys()], ["digest"]);
      assert.equal(header(options.headers, "content-length"), "0");
      assert.equal(header(options.headers, "connection"), "close");
      assert.equal(options.body?.byteLength ?? 0, 0);
      return response(201, { "docker-content-digest": layerDigest });
    }
    if (method === "PUT" && url.pathname === `${repositoryPath}/manifests/${manifestDigest}`) {
      assert.equal(Buffer.from(options.body).equals(manifestBytes), true);
      return response(201, { "docker-content-digest": manifestDigest });
    }
    throw new Error(`unexpected fake registry request: ${method} ${url.pathname}`);
  };
  const adapter = await createGhcrRegistryPublicationAdapter({
    username: "operator",
    tokenBytes: Buffer.from("credential-sentinel-028b"),
    request,
  });
  await adapter.copyVerifiedImage({
    image: { imageManifestDigest: manifestDigest },
    inspected: {
      imageManifestDigest: manifestDigest,
      blobs: [
        { digest: layerDigest, bytes: layerBytes },
        { digest: manifestDigest, bytes: manifestBytes },
      ],
    },
    remoteRepository,
  });
  const patchRequests = requests.filter(({ method }) => method === "PATCH");
  assert.equal(patchIndex, 61);
  assert.equal(patchRequests.length, 61);
  for (let index = 0; index < 60; index += 1) {
    assert.deepEqual(patchRequests[index], {
      method: "PATCH",
      pathname: `${repositoryPath}/blobs/upload/chunk-${index === 1 ? 0 : index}`,
      search: "",
      contentLength: String(chunkSize),
      contentRange: `${index * chunkSize}-${((index + 1) * chunkSize) - 1}`,
      contentType: "application/octet-stream",
      bodyLength: chunkSize,
    });
  }
  assert.deepEqual(patchRequests[60], {
    method: "PATCH",
    pathname: `${repositoryPath}/blobs/upload/chunk-60`,
    search: "",
    contentLength: "195332",
    contentRange: "15728640-15923971",
    contentType: "application/octet-stream",
    bodyLength: 195_332,
  });
  adapter.dispose();

  const failureCases = [
    { name: "missing-location", patch: 1, headers: { range: `0-${chunkSize - 1}` } },
    { name: "missing-range", patch: 1, headers: { location: `${repositoryPath}/blobs/upload/next` } },
    { name: "bad-range", patch: 1, headers: { location: `${repositoryPath}/blobs/upload/next`, range: "1-2" } },
    { name: "cross-authority", patch: 1, headers: { location: `https://registry.invalid${repositoryPath}/blobs/upload/next`, range: `0-${chunkSize - 1}` } },
    { name: "cross-repository", patch: 1, headers: { location: "/v2/other/repository/blobs/upload/next", range: `0-${chunkSize - 1}` } },
    { name: "stale-location", patch: 2, headers: { location: `${repositoryPath}/blobs/upload/chunk-0`, range: `0-${(2 * chunkSize) - 1}` } },
    { name: "mid-chunk-416", patch: 2, status: 416, headers: { range: `0-${chunkSize - 1}` } },
    { name: "mid-chunk-socket", patch: 2, throws: true },
    { name: "oversize-minimum", patch: 0, minimum: String(chunkSize + 1) },
    { name: "invalid-minimum", patch: 0, minimum: "256KiB" },
  ];
  for (const failureCase of failureCases) {
    let patchCalls = 0;
    let finalizeCalls = 0;
    let manifestCalls = 0;
    const failureRequest = async (input, options = {}) => {
      const url = new URL(input);
      const method = options.method ?? "GET";
      if (url.pathname === "/token") return response(200, {}, { token: "t".repeat(32) });
      if (method === "HEAD") return response(404);
      if (method === "POST") {
        assert.equal(header(options.headers, "connection"), "close", failureCase.name);
        return response(202, {
          location: `${repositoryPath}/blobs/upload/chunk-0`,
          ...(failureCase.minimum === undefined ? {} : { "oci-chunk-min-length": failureCase.minimum }),
        });
      }
      if (method === "PATCH") {
        assert.equal(header(options.headers, "connection"), "close", failureCase.name);
        patchCalls += 1;
        if (patchCalls < failureCase.patch) {
          return response(202, {
            location: `${repositoryPath}/blobs/upload/chunk-${patchCalls}`,
            range: `0-${(patchCalls * chunkSize) - 1}`,
          });
        }
        if (failureCase.throws) throw Object.assign(new Error("synthetic socket ambiguity"), { code: "UND_ERR_SOCKET" });
        return response(failureCase.status ?? 202, failureCase.headers ?? {});
      }
      if (method === "PUT" && url.pathname.includes("/blobs/upload/")) {
        assert.equal(header(options.headers, "connection"), "close", failureCase.name);
        finalizeCalls += 1;
        return response(201, { "docker-content-digest": layerDigest });
      }
      if (method === "PUT" && url.pathname.includes("/manifests/")) {
        manifestCalls += 1;
        return response(201, { "docker-content-digest": manifestDigest });
      }
      throw new Error("unexpected fake registry request");
    };
    const failureAdapter = await createGhcrRegistryPublicationAdapter({
      username: "operator",
      tokenBytes: Buffer.from("credential-sentinel-028b"),
      request: failureRequest,
    });
    await assert.rejects(() => failureAdapter.copyVerifiedImage({
      image: { imageManifestDigest: manifestDigest },
      inspected: {
        imageManifestDigest: manifestDigest,
        blobs: [
          { digest: layerDigest, bytes: layerBytes },
          { digest: manifestDigest, bytes: manifestBytes },
        ],
      },
      remoteRepository,
    }), undefined, failureCase.name);
    assert.equal(patchCalls, failureCase.patch, failureCase.name);
    assert.equal(finalizeCalls, 0, failureCase.name);
    assert.equal(manifestCalls, 0, failureCase.name);
    failureAdapter.dispose();
  }
});

test("028B rejects cross-port, cross-repository or arbitrary upload Location before bearer PUT", async () => {
  const { createGhcrRegistryPublicationAdapter } = await import("../../scripts/ghcr-registry-adapter.mjs");
  const remoteRepository = "ghcr.io/example-owner/orivra-caddy";
  const manifestDigest = sha("1");
  const layerDigest = sha("2");
  const locations = [
    "https://registry.example.test/v2/example-owner/orivra-caddy/blobs/upload/run-1",
    "https://ghcr.io:444/v2/example-owner/orivra-caddy/blobs/upload/run-1",
    "https://ghcr.io/v2/other-owner/other-package/blobs/upload/run-1",
    "https://ghcr.io/v2/example-owner/orivra-caddy/blobs/upload/",
    "https://ghcr.io/v2/example-owner/orivra-caddy/blobs/upload/run-1/extra",
    "https://operator:credential@ghcr.io/v2/example-owner/orivra-caddy/blobs/upload/run-1",
    "https://ghcr.io/v2/example-owner/orivra-caddy/blobs/upload/run-1#credential-fragment",
    "https://ghcr.io/token",
  ];
  for (const location of locations) {
    let bearerPuts = 0;
    const response = (status, headers = {}, payload = undefined) => ({
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      json: async () => payload,
    });
    const request = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname === "/token") {
        return response(200, {}, { token: "t".repeat(32) });
      }
      if (options.method === "HEAD") return response(404);
      if (options.method === "POST") return response(202, { location });
      if (options.method === "PUT") {
        bearerPuts += 1;
        return response(201, {
          "docker-content-digest": url.pathname.includes("/manifests/") ? manifestDigest : layerDigest,
        });
      }
      throw new Error("unexpected fake registry request");
    };
    const adapter = await createGhcrRegistryPublicationAdapter({
      username: "operator",
      tokenBytes: Buffer.from("credential-sentinel-028b"),
      request,
    });
    await assert.rejects(() => adapter.copyVerifiedImage({
      image: { imageManifestDigest: manifestDigest },
      inspected: {
        imageManifestDigest: manifestDigest,
        blobs: [
          { digest: layerDigest, bytes: Buffer.from("layer") },
          { digest: manifestDigest, bytes: Buffer.from("manifest") },
        ],
      },
      remoteRepository,
    }), { code: "GHCR_REGISTRY_FAILED" });
    assert.equal(bearerPuts, 0);
    adapter.dispose();
  }
});

test("028B never chains staging from a mutable publication object", async () => {
  const module = await runtime();
  const { images, targetMap } = publicationFixture();
  let stagingCalls = 0;
  const evidence = { kind: "canonical-publication-placeholder" };
  const result = await module.runGhcrPublication({
    images,
    targetMap,
    inspectArchive: async (image) => ({ imageManifestDigest: image.imageManifestDigest, blobs: [] }),
    registryAdapter: {
      copyVerifiedImage: async () => undefined,
      inspectRemoteDigest: async ({ image }) => image.imageManifestDigest,
    },
    createEvidence: async () => evidence,
    appendEvidence: async (value) => assert.equal(value, evidence),
    startStaging: async () => { stagingCalls += 1; },
    cleanup: async () => undefined,
  });
  assert.equal(result, evidence);
  assert.equal(stagingCalls, 0);
});
