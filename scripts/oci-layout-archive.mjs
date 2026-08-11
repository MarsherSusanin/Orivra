import { createHash } from "node:crypto";
import { chmod, lstat, open, readFile, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const ARCHIVE_ERROR = "OCI release archive is invalid";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IMAGE_INDEX = "application/vnd.oci.image.index.v1+json";
const IMAGE_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const IMAGE_CONFIG = "application/vnd.oci.image.config.v1+json";

function fail() {
  throw Object.assign(new Error(ARCHIVE_ERROR), { code: "OCI_RELEASE_ARCHIVE_INVALID" });
}

function tarString(buffer, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) fail();
  bytes.copy(buffer, offset);
}

function tarOctal(buffer, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  const text = value.toString(8).padStart(length - 1, "0");
  if (text.length !== length - 1) fail();
  tarString(buffer, offset, length, `${text}\0`);
}

function tarHeader(entry) {
  const header = Buffer.alloc(512);
  tarString(header, 0, 100, entry.path);
  tarOctal(header, 100, 8, 0o644);
  tarOctal(header, 108, 8, 0);
  tarOctal(header, 116, 8, 0);
  tarOctal(header, 124, 12, entry.sizeBytes);
  tarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  tarString(header, 257, 6, "ustar\0");
  tarString(header, 263, 2, "00");
  tarOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0));
  return header;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function parseJson(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
}

async function hashRegularFile(path, expectedSize, expectedDigest) {
  let handle;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== expectedSize || expectedSize < 1) fail();
    handle = await open(path, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < expectedSize) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expectedSize - position), position);
      if (bytesRead < 1) fail();
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (`sha256:${hash.digest("hex")}` !== expectedDigest) fail();
    return Object.freeze({ path, sizeBytes: expectedSize });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function requireRegularFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail();
  return metadata;
}

async function requireDirectory(path) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail();
  return metadata;
}

async function loadVerifiedLayout(layoutRoot) {
  if (typeof layoutRoot !== "string" || !isAbsolute(layoutRoot) || layoutRoot.includes("\0")) fail();
  const rootMetadata = await lstat(layoutRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) fail();
  const rootEntries = (await readdir(layoutRoot)).sort();
  if (!["blobs\0index.json\0oci-layout", "blobs\0index.json\0ingest\0oci-layout"].includes(rootEntries.join("\0"))) fail();
  if (rootEntries.includes("ingest")) {
    const ingest = join(layoutRoot, "ingest");
    const metadata = await lstat(ingest);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await readdir(ingest)).length !== 0) fail();
  }
  const layoutPath = join(layoutRoot, "oci-layout");
  const indexPath = join(layoutRoot, "index.json");
  await requireRegularFile(layoutPath);
  await requireRegularFile(indexPath);
  const layoutBytes = await readFile(layoutPath);
  if (!layoutBytes.equals(Buffer.from('{"imageLayoutVersion":"1.0.0"}'))) fail();

  const rawIndex = parseJson(await readFile(indexPath));
  const descriptor = rawIndex?.manifests?.[0];
  if (!exactKeys(rawIndex, ["schemaVersion", "mediaType", "manifests"]) ||
    rawIndex.schemaVersion !== 2 || rawIndex.mediaType !== IMAGE_INDEX || rawIndex.manifests.length !== 1 ||
    !descriptor || descriptor.mediaType !== IMAGE_MANIFEST || !SHA256.test(descriptor.digest ?? "") ||
    !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 ||
    !exactKeys(descriptor.platform, ["architecture", "os"]) ||
    descriptor.platform.architecture !== "amd64" || descriptor.platform.os !== "linux") fail();
  const descriptorKeys = Object.keys(descriptor).sort().join("\0");
  if (!["digest\0mediaType\0platform\0size", "annotations\0digest\0mediaType\0platform\0size"].includes(descriptorKeys) ||
    (descriptor.annotations && Object.keys(descriptor.annotations).some((key) => ![
      "io.containerd.image.name", "org.opencontainers.image.created", "org.opencontainers.image.ref.name",
    ].includes(key)))) fail();

  const blobsRoot = join(layoutRoot, "blobs");
  await requireDirectory(blobsRoot);
  const algorithms = await readdir(blobsRoot);
  if (algorithms.length !== 1 || algorithms[0] !== "sha256") fail();
  const digestRoot = join(blobsRoot, "sha256");
  await requireDirectory(digestRoot);
  const blobNames = (await readdir(digestRoot)).sort();
  if (blobNames.some((name) => !/^[a-f0-9]{64}$/.test(name))) fail();
  const blobPath = (digest) => join(digestRoot, digest.slice(7));

  await hashRegularFile(blobPath(descriptor.digest), descriptor.size, descriptor.digest);
  const manifestBytes = await readFile(blobPath(descriptor.digest));
  const manifest = parseJson(manifestBytes);
  if (!exactKeys(manifest, ["schemaVersion", "mediaType", "config", "layers"]) ||
    manifest.schemaVersion !== 2 || manifest.mediaType !== IMAGE_MANIFEST || !Array.isArray(manifest.layers) ||
    manifest.config?.mediaType !== IMAGE_CONFIG) fail();
  const descriptors = [manifest.config, ...manifest.layers];
  const reachable = new Set([descriptor.digest]);
  const entries = [];
  for (const child of descriptors) {
    if (!SHA256.test(child?.digest ?? "") || !Number.isSafeInteger(child?.size) || child.size < 1 ||
      typeof child.mediaType !== "string") fail();
    await hashRegularFile(blobPath(child.digest), child.size, child.digest);
    reachable.add(child.digest);
  }
  const configuration = parseJson(await readFile(blobPath(manifest.config.digest)));
  if (configuration?.architecture !== "amd64" || configuration?.os !== "linux") fail();
  if (reachable.size !== blobNames.length || blobNames.some((name) => !reachable.has(`sha256:${name}`))) fail();
  for (const digest of [...reachable].sort()) {
    const path = blobPath(digest);
    const metadata = await lstat(path);
    entries.push({ path: `blobs/sha256/${digest.slice(7)}`, filePath: path, sizeBytes: metadata.size });
  }
  const normalizedIndex = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: IMAGE_INDEX,
    manifests: [{
      mediaType: descriptor.mediaType,
      digest: descriptor.digest,
      size: descriptor.size,
      platform: descriptor.platform,
    }],
  }));
  entries.push({ path: "index.json", bytes: normalizedIndex, sizeBytes: normalizedIndex.byteLength });
  entries.push({ path: "oci-layout", bytes: layoutBytes, sizeBytes: layoutBytes.byteLength });
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return Object.freeze({ entries, imageManifestDigest: descriptor.digest });
}

export async function writeCanonicalOciArchive({ layoutRoot, outputPath } = {}) {
  let outputHandle;
  let createdOutput = false;
  try {
    if (typeof outputPath !== "string" || !isAbsolute(outputPath) || outputPath.includes("\0")) fail();
    const layout = await loadVerifiedLayout(layoutRoot);
    outputHandle = await open(outputPath, "wx", 0o600);
    createdOutput = true;
    const archiveHash = createHash("sha256");
    let archiveSizeBytes = 0;
    const append = async (bytes) => {
      await outputHandle.write(bytes);
      archiveHash.update(bytes);
      archiveSizeBytes += bytes.byteLength;
    };
    for (const entry of layout.entries) {
      await append(tarHeader(entry));
      if (entry.bytes) {
        await append(entry.bytes);
      } else {
        const input = await open(entry.filePath, "r");
        try {
          const buffer = Buffer.allocUnsafe(1024 * 1024);
          let position = 0;
          while (position < entry.sizeBytes) {
            const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, entry.sizeBytes - position), position);
            if (bytesRead < 1) fail();
            await append(buffer.subarray(0, bytesRead));
            position += bytesRead;
          }
        } finally {
          await input.close();
        }
      }
      const padding = (512 - (entry.sizeBytes % 512)) % 512;
      if (padding > 0) await append(Buffer.alloc(padding));
    }
    await append(Buffer.alloc(1024));
    await outputHandle.sync();
    await outputHandle.close();
    outputHandle = undefined;
    await chmod(outputPath, 0o600);
    return Object.freeze({
      archiveSizeBytes,
      archiveSha256: `sha256:${archiveHash.digest("hex")}`,
      imageManifestDigest: layout.imageManifestDigest,
      platform: "linux/amd64",
    });
  } catch (cause) {
    await outputHandle?.close().catch(() => undefined);
    if (createdOutput) await rm(outputPath, { force: true }).catch(() => undefined);
    if (cause?.code === "OCI_RELEASE_ARCHIVE_INVALID") throw cause;
    fail();
  }
}
