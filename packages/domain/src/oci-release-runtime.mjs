import {
  FrozenOciReleaseManifestV1Schema,
  canonicalJson,
  checksumReleaseArtifactInventory,
  sha256Bytes,
} from "../../contracts/src/release-runtime.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IMAGE_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const IMAGE_CONFIG = "application/vnd.oci.image.config.v1+json";

function compareAscii(left, right) {
  return left.localeCompare(right, "en");
}

function invalid(message = "OCI release input is invalid") {
  throw Object.assign(new Error(message), { code: "OCI_RELEASE_INVALID" });
}

function exactObject(value, keys) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function parseJson(bytes) {
  return JSON.parse(decoder.decode(bytes));
}

function requireBlob(blobs, descriptor) {
  const bytes = blobs.get(descriptor.digest);
  const checks = [
    SHA256.test(descriptor.digest),
    Number.isSafeInteger(descriptor.size),
    descriptor.size > 0,
    bytes instanceof Uint8Array,
    bytes.byteLength === descriptor.size,
    sha256Bytes(bytes) === descriptor.digest,
  ];
  if (checks.includes(false)) invalid();
  return bytes;
}

export function inspectSinglePlatformOciLayout({ index, blobs }) {
  const parsedIndex = parseJson(index);
  const descriptor = parsedIndex.manifests[0];
  const indexChecks = [
    exactObject(parsedIndex, ["schemaVersion", "mediaType", "manifests"]),
    parsedIndex.schemaVersion === 2,
    parsedIndex.mediaType === "application/vnd.oci.image.index.v1+json",
    parsedIndex.manifests.length === 1,
    exactObject(descriptor, ["mediaType", "digest", "size", "platform"]),
    descriptor.mediaType === IMAGE_MANIFEST,
    exactObject(descriptor.platform, ["architecture", "os"]),
    descriptor.platform.architecture === "amd64",
    descriptor.platform.os === "linux",
  ];
  const manifestBytes = requireBlob(blobs, {
    mediaType: descriptor.mediaType,
    digest: descriptor.digest,
    size: descriptor.size,
  });
  const manifest = parseJson(manifestBytes);
  const reachable = new Set([descriptor.digest]);
  requireBlob(blobs, manifest.config);
  reachable.add(manifest.config.digest);
  const configuration = parseJson(blobs.get(manifest.config.digest));
  const manifestChecks = [
    exactObject(manifest, ["schemaVersion", "mediaType", "config", "layers"]),
    manifest.schemaVersion === 2,
    manifest.mediaType === IMAGE_MANIFEST,
    Array.isArray(manifest.layers),
    manifest.config.mediaType === IMAGE_CONFIG,
    configuration.architecture === "amd64",
    configuration.os === "linux",
  ];
  if ([...indexChecks, ...manifestChecks].includes(false)) invalid();
  for (const layer of manifest.layers) {
    requireBlob(blobs, layer);
    reachable.add(layer.digest);
  }
  if (reachable.size !== blobs.size || [...blobs.keys()].some((digest) => !reachable.has(digest))) invalid();
  return Object.freeze({
    imageManifestDigest: descriptor.digest,
    platform: "linux/amd64",
    reachableBlobDigests: Object.freeze([...reachable].sort()),
  });
}

export function deriveCanonicalOciArchiveEntries(input) {
  const inspected = inspectSinglePlatformOciLayout(input);
  const layoutBytes = encoder.encode('{"imageLayoutVersion":"1.0.0"}');
  const entries = [
    ...inspected.reachableBlobDigests.map((digest) => ({
      path: `blobs/sha256/${digest.slice(7)}`,
      bytes: new Uint8Array(input.blobs.get(digest)),
    })),
    { path: "index.json", bytes: new Uint8Array(input.index) },
    { path: "oci-layout", bytes: layoutBytes },
  ].sort((left, right) => compareAscii(left.path, right.path))
    .map((entry) => Object.freeze({ ...entry, uid: 0, gid: 0, mtime: 0, mode: 0o644 }));
  return Object.freeze(entries);
}

export const createFrozenOciReleaseManifest = FrozenOciReleaseManifestV1Schema.parse.bind(FrozenOciReleaseManifestV1Schema);

export function createFrozenOciReleaseReceipt({ producer, manifestBytes, archives }) {
  const artifacts = [
    { filename: "frozen-release-manifest.v1.json", sizeBytes: manifestBytes.byteLength, sha256: sha256Bytes(manifestBytes) },
    ...archives.map(({ filename, bytes }) => ({ filename, sizeBytes: bytes.byteLength, sha256: sha256Bytes(bytes) })),
  ].sort((left, right) => compareAscii(left.filename, right.filename));
  return {
    version: "1",
    kind: "frozen-oci-release-receipt",
    status: "passed",
    verification: "verified",
    releaseClaim: true,
    producer: { ...producer },
    frozenReleaseManifestSha256: sha256Bytes(manifestBytes),
    artifacts,
    artifactInventorySha256: checksumReleaseArtifactInventory(artifacts),
  };
}

export function verifyFrozenOciReleaseHandoff({ manifestBytes, receipt, expectedProducer, artifacts }) {
  const parsedManifest = parseJson(manifestBytes);
  const names = receipt.artifacts.map(({ filename }) => filename);
  const checks = [
    receipt.producer.commitSha === expectedProducer.commitSha,
    receipt.producer.treeSha === expectedProducer.treeSha,
    receipt.frozenReleaseManifestSha256 === sha256Bytes(manifestBytes),
    receipt.artifactInventorySha256 === checksumReleaseArtifactInventory(receipt.artifacts),
    parsedManifest.producer.commitSha === expectedProducer.commitSha,
    parsedManifest.producer.treeSha === expectedProducer.treeSha,
    new Set(names).size === names.length,
    !names.includes("frozen-release-receipt.v1.json"),
    artifacts.size === names.length,
  ];
  if (checks.includes(false)) invalid("Frozen release handoff is invalid");
  for (const artifact of receipt.artifacts) {
    const bytes = artifacts.get(artifact.filename);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== artifact.sizeBytes || sha256Bytes(bytes) !== artifact.sha256) invalid("Frozen release artifact is invalid");
  }
  return true;
}

export { canonicalJson, sha256Bytes };
