import { createHash } from "node:crypto";
import { chmod, lstat, open, readFile, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  deriveCanonicalOciArchiveEntries,
  inspectSinglePlatformOciLayout,
} from "../packages/domain/src/oci-release-runtime.mjs";

const ARCHIVE_ERROR = "OCI release archive is invalid";

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
  tarOctal(header, 100, 8, entry.mode);
  tarOctal(header, 108, 8, entry.uid);
  tarOctal(header, 116, 8, entry.gid);
  tarOctal(header, 124, 12, entry.bytes.byteLength);
  tarOctal(header, 136, 12, entry.mtime);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  tarString(header, 257, 6, "ustar\0");
  tarString(header, 263, 2, "00");
  tarOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0));
  return header;
}

async function loadLayout(layoutRoot) {
  if (typeof layoutRoot !== "string" || !isAbsolute(layoutRoot) || layoutRoot.includes("\0")) fail();
  const rootMetadata = await lstat(layoutRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) fail();
  const rootEntries = (await readdir(layoutRoot)).sort();
  const acceptedRootInventories = [
    "blobs\0index.json\0oci-layout",
    "blobs\0index.json\0ingest\0oci-layout",
  ];
  if (!acceptedRootInventories.includes(rootEntries.join("\0"))) fail();
  if (rootEntries.includes("ingest")) {
    const ingestMetadata = await lstat(join(layoutRoot, "ingest"));
    if (!ingestMetadata.isDirectory() || ingestMetadata.isSymbolicLink() ||
      (await readdir(join(layoutRoot, "ingest"))).length !== 0) fail();
  }
  const layout = await readFile(join(layoutRoot, "oci-layout"));
  if (!layout.equals(Buffer.from('{"imageLayoutVersion":"1.0.0"}'))) fail();
  const blobsRoot = join(layoutRoot, "blobs");
  const algorithmEntries = await readdir(blobsRoot);
  if (algorithmEntries.length !== 1 || algorithmEntries[0] !== "sha256") fail();
  const digestRoot = join(blobsRoot, "sha256");
  const blobs = new Map();
  for (const filename of (await readdir(digestRoot)).sort()) {
    if (!/^[a-f0-9]{64}$/.test(filename)) fail();
    const path = join(digestRoot, filename);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) fail();
    blobs.set(`sha256:${filename}`, new Uint8Array(await readFile(path)));
  }
  const indexPath = join(layoutRoot, "index.json");
  const indexMetadata = await lstat(indexPath);
  if (!indexMetadata.isFile() || indexMetadata.isSymbolicLink()) fail();
  const rawIndex = JSON.parse((await readFile(indexPath)).toString("utf8"));
  const descriptor = rawIndex?.manifests?.[0];
  const rootKeys = Object.keys(rawIndex ?? {}).sort().join("\0");
  const descriptorKeys = Object.keys(descriptor ?? {}).sort().join("\0");
  const acceptedDescriptorKeys = [
    "digest\0mediaType\0platform\0size",
    "annotations\0digest\0mediaType\0platform\0size",
  ];
  if (rootKeys !== "manifests\0mediaType\0schemaVersion" || rawIndex.manifests.length !== 1 ||
    !acceptedDescriptorKeys.includes(descriptorKeys) ||
    (descriptor.annotations && Object.keys(descriptor.annotations).some((key) => ![
      "io.containerd.image.name",
      "org.opencontainers.image.created",
      "org.opencontainers.image.ref.name",
    ].includes(key)))) fail();
  const normalizedIndex = Buffer.from(JSON.stringify({
    schemaVersion: rawIndex.schemaVersion,
    mediaType: rawIndex.mediaType,
    manifests: [{
      mediaType: descriptor.mediaType,
      digest: descriptor.digest,
      size: descriptor.size,
      platform: descriptor.platform,
    }],
  }));
  return { index: new Uint8Array(normalizedIndex), blobs };
}

export async function writeCanonicalOciArchive({ layoutRoot, outputPath } = {}) {
  let handle;
  try {
    if (typeof outputPath !== "string" || !isAbsolute(outputPath) || outputPath.includes("\0")) fail();
    const layout = await loadLayout(layoutRoot);
    const inspected = inspectSinglePlatformOciLayout(layout);
    const entries = deriveCanonicalOciArchiveEntries(layout);
    handle = await open(outputPath, "wx", 0o600);
    const archiveHash = createHash("sha256");
    let archiveSizeBytes = 0;
    const append = async (bytes) => {
      await handle.write(bytes);
      archiveHash.update(bytes);
      archiveSizeBytes += bytes.byteLength;
    };
    for (const entry of entries) {
      await append(tarHeader(entry));
      await append(entry.bytes);
      const padding = (512 - (entry.bytes.byteLength % 512)) % 512;
      if (padding > 0) await append(Buffer.alloc(padding));
    }
    await append(Buffer.alloc(1024));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(outputPath, 0o600);
    return Object.freeze({
      archiveSizeBytes,
      archiveSha256: `sha256:${archiveHash.digest("hex")}`,
      imageManifestDigest: inspected.imageManifestDigest,
      platform: inspected.platform,
    });
  } catch (cause) {
    await handle?.close().catch(() => undefined);
    if (typeof outputPath === "string") await rm(outputPath, { force: true }).catch(() => undefined);
    if (cause?.code === "OCI_RELEASE_ARCHIVE_INVALID") throw cause;
    fail();
  }
}
