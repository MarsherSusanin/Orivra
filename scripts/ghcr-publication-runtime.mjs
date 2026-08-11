import { sha256Bytes } from "../packages/contracts/src/release-runtime.mjs";
import { GhcrPublicationTargetsV1Schema } from "../packages/contracts/src/publication-runtime.mjs";
import { inspectSinglePlatformOciLayout } from "../packages/domain/src/oci-release-runtime.mjs";

const imageIds = Object.freeze(["caddy", "web", "api", "worker", "postgres-recovery"]);
const blobPath = /^blobs\/sha256\/([a-f0-9]{64})$/;

function failure(code, message, details) {
  return Object.assign(new Error(message), { code, ...details });
}

function isPrivateAbsolutePath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.includes("\0");
}

async function requireSecretFile(path, inspect) {
  if (!isPrivateAbsolutePath(path)) throw failure("PUBLICATION_CREDENTIAL_INVALID", "Publication credential file is invalid");
  const stat = await inspect(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o400) {
    throw failure("PUBLICATION_CREDENTIAL_INVALID", "Publication credential file is invalid");
  }
}

export async function createPublicationCredentialEnvironment({ ambientEnvironment = {}, username, tokenFile, inspectSecretFile }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username ?? "") || typeof inspectSecretFile !== "function") {
    throw failure("PUBLICATION_CREDENTIAL_INVALID", "Publication credential input is invalid");
  }
  await requireSecretFile(tokenFile, inspectSecretFile);
  return Object.freeze({
    PATH: typeof ambientEnvironment.PATH === "string" ? ambientEnvironment.PATH : "/usr/bin:/bin",
    PROOFLINE_GHCR_USERNAME: username,
    PROOFLINE_GHCR_WRITE_TOKEN_FILE: tokenFile,
  });
}

function parseJson(bytes) {
  if (!(bytes instanceof Uint8Array)) throw failure("OCI_PUBLICATION_ARCHIVE_INVALID", "OCI publication archive is invalid");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function inspectFrozenOciArchiveForPublication({
  archivePath,
  expected,
  inspectArchive,
  checksumArchive,
  readEntries,
  limits,
}) {
  try {
    if (!isPrivateAbsolutePath(archivePath) || !expected || !limits ||
      !Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 3 ||
      !Number.isSafeInteger(limits.maxJsonBytes) || limits.maxJsonBytes < 1 ||
      !Number.isSafeInteger(limits.maxTotalBlobBytes) || limits.maxTotalBlobBytes < 1) throw new Error("invalid input");
    const stat = await inspectArchive(archivePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.archiveSizeBytes ||
      (stat.mode & 0o777) !== 0o400 || await checksumArchive(archivePath) !== expected.archiveSha256) throw new Error("archive mismatch");
    const entries = await readEntries(archivePath, limits);
    if (!Array.isArray(entries) || entries.length > limits.maxEntries) throw new Error("entry limit");
    const seen = new Set();
    const blobs = new Map();
    let indexBytes;
    let layoutBytes;
    let totalBlobBytes = 0;
    for (const entry of entries) {
      if (!entry || entry.type !== "file" || typeof entry.path !== "string" ||
        entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.split("/").includes("..") ||
        seen.has(entry.path) || !(entry.bytes instanceof Uint8Array)) throw new Error("unsafe entry");
      seen.add(entry.path);
      if (entry.path === "index.json") indexBytes = entry.bytes;
      else if (entry.path === "oci-layout") layoutBytes = entry.bytes;
      else {
        const match = blobPath.exec(entry.path);
        if (!match) throw new Error("unexpected entry");
        const digest = `sha256:${match[1]}`;
        if (sha256Bytes(entry.bytes) !== digest) throw new Error("blob mismatch");
        totalBlobBytes += entry.bytes.byteLength;
        if (totalBlobBytes > limits.maxTotalBlobBytes) throw new Error("blob limit");
        blobs.set(digest, entry.bytes);
      }
    }
    if (!indexBytes || !layoutBytes || indexBytes.byteLength > limits.maxJsonBytes || layoutBytes.byteLength > limits.maxJsonBytes) throw new Error("control entry missing");
    const layout = parseJson(layoutBytes);
    if (Object.keys(layout).length !== 1 || layout.imageLayoutVersion !== "1.0.0") throw new Error("layout invalid");
    const inspected = inspectSinglePlatformOciLayout({ index: indexBytes, blobs });
    if (inspected.platform !== expected.platform || inspected.imageManifestDigest !== expected.imageManifestDigest) throw new Error("manifest mismatch");
    return Object.freeze({
      imageManifestDigest: inspected.imageManifestDigest,
      platform: inspected.platform,
      blobs: Object.freeze(inspected.reachableBlobDigests.map((digest) => Object.freeze({ digest, bytes: blobs.get(digest) }))),
    });
  } catch (cause) {
    if (cause?.code === "OCI_PUBLICATION_ARCHIVE_INVALID") throw cause;
    throw failure("OCI_PUBLICATION_ARCHIVE_INVALID", "OCI publication archive is invalid", { cause });
  }
}

function validatePublicationInputs(images, targetMap) {
  const targets = GhcrPublicationTargetsV1Schema.parse(targetMap);
  if (!Array.isArray(images) || images.length !== imageIds.length) throw failure("GHCR_PUBLICATION_INVALID", "Publication inventory is invalid");
  images.forEach((image, index) => {
    const target = targets.images[index];
    if (image.id !== imageIds[index] || target.id !== image.id || target.sourceRepository !== image.sourceRepository ||
      !/^sha256:[a-f0-9]{64}$/.test(image.imageManifestDigest) ||
      image.imageManifestDigest === image.archiveSha256) throw failure("GHCR_PUBLICATION_INVALID", "Publication inventory is invalid");
  });
  return targets;
}

export async function publishFrozenImagesToGhcr({ images, targetMap, inspectArchive, registryAdapter }) {
  const targets = validatePublicationInputs(images, targetMap);
  const inspected = [];
  for (const image of images) inspected.push(await inspectArchive(image));
  const results = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const remoteRepository = targets.images[index].remoteRepository;
    if (inspected[index]?.imageManifestDigest !== image.imageManifestDigest) {
      throw failure("GHCR_PUBLICATION_INVALID", "Verified image digest is invalid", { failedImageId: image.id });
    }
    await registryAdapter.copyVerifiedImage({ image, inspected: inspected[index], remoteRepository });
    const remoteDigest = await registryAdapter.inspectRemoteDigest({ image, remoteRepository });
    if (remoteDigest !== image.imageManifestDigest) {
      throw failure("GHCR_REMOTE_DIGEST_MISMATCH", "GHCR remote manifest digest mismatch", { failedImageId: image.id });
    }
    results.push(Object.freeze({ id: image.id, remoteRepository, remoteDigest }));
  }
  return Object.freeze(results);
}

export async function appendPublicationEvidence({ filename, bytes, putIfAbsent, readExisting }) {
  if (filename !== "publication-evidence.v1.json" || !(bytes instanceof Uint8Array)) {
    throw failure("PUBLICATION_EVIDENCE_INVALID", "Publication evidence append is invalid");
  }
  if (!await putIfAbsent({ filename, bytes })) {
    await readExisting(filename);
    throw failure("PUBLICATION_EVIDENCE_EXISTS", "Publication evidence already exists");
  }
  return true;
}

export async function runGhcrPublication({ images, targetMap, inspectArchive, registryAdapter, appendEvidence, startStaging, cleanup, createEvidence }) {
  let original;
  let result;
  const publishedImageIds = [];
  let failedImageId;
  let publicationEvidenceWritten = false;
  let stagingStarted = false;
  try {
    const targets = validatePublicationInputs(images, targetMap);
    const inspected = [];
    for (const image of images) inspected.push(await inspectArchive(image));
    const remoteResults = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      failedImageId = image.id;
      const remoteRepository = targets.images[index].remoteRepository;
      if (inspected[index]?.imageManifestDigest !== image.imageManifestDigest) {
        throw failure("GHCR_PUBLICATION_INVALID", "Verified image digest is invalid");
      }
      await registryAdapter.copyVerifiedImage({ image, inspected: inspected[index], remoteRepository });
      const remoteDigest = await registryAdapter.inspectRemoteDigest({ image, remoteRepository });
      if (remoteDigest !== image.imageManifestDigest) throw failure("GHCR_REMOTE_DIGEST_MISMATCH", "GHCR remote manifest digest mismatch");
      publishedImageIds.push(image.id);
      remoteResults.push({ id: image.id, remoteRepository, remoteDigest });
    }
    const evidence = typeof createEvidence === "function" ? await createEvidence(remoteResults) : { remoteResults };
    await appendEvidence(evidence);
    publicationEvidenceWritten = true;
    if (typeof startStaging === "function") {
      await startStaging(evidence);
      stagingStarted = true;
    }
    result = evidence;
  } catch (cause) {
    original = cause;
    const failed = failedImageId && !publishedImageIds.includes(failedImageId) ? failedImageId : undefined;
    if (cause && typeof cause === "object") {
      Object.assign(cause, {
        partialPublication: {
          publishedImageIds: [...publishedImageIds],
          failedImageId: failed,
          publicationEvidenceWritten,
          stagingStarted,
        },
      });
    }
  }
  let cleanupFailure;
  try { await cleanup(); } catch (cause) { cleanupFailure = cause; }
  if (original && cleanupFailure) throw Object.assign(new AggregateError([original, cleanupFailure], "Publication and cleanup failed"), { cause: original });
  if (original) throw original;
  if (cleanupFailure) throw cleanupFailure;
  return result;
}
