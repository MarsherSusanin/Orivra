import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

function invalid() {
  throw Object.assign(new Error("OCI publication archive is invalid"), { code: "OCI_PUBLICATION_ARCHIVE_INVALID" });
}

function zeroBlock(block) {
  return block.every((byte) => byte === 0);
}

function parseString(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

function parseOctal(block, offset, length) {
  const value = parseString(block, offset, length).trim();
  if (!/^[0-7]+$/.test(value)) invalid();
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) invalid();
  return parsed;
}

async function readExact(handle, length, position) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
    if (bytesRead < 1) invalid();
    offset += bytesRead;
  }
  return bytes;
}

export async function readOciDescriptorRange(handle, { offset, size }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0) invalid();
  return readExact(handle, size, offset);
}

export async function checksumOciArchiveDescriptor(handle) {
  const hash = createHash("sha256");
  for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

async function descriptorEntries(handle, limits) {
  const metadata = await handle.stat();
  const entries = [];
  let position = 0;
  let terminalBlocks = 0;
  while (position < metadata.size) {
    const header = await readExact(handle, 512, position);
    position += 512;
    if (zeroBlock(header)) {
      terminalBlocks += 1;
      if (terminalBlocks === 2) break;
      continue;
    }
    if (terminalBlocks !== 0 || entries.length >= limits.maxEntries) invalid();
    const storedChecksum = parseOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    if (checksumHeader.reduce((sum, byte) => sum + byte, 0) !== storedChecksum ||
      parseString(header, 257, 6) !== "ustar" || ![0, 0x30].includes(header[156]) ||
      parseOctal(header, 100, 8) !== 0o644 || parseOctal(header, 108, 8) !== 0 ||
      parseOctal(header, 116, 8) !== 0 || parseOctal(header, 136, 12) !== 0) invalid();
    const path = parseString(header, 0, 100);
    const size = parseOctal(header, 124, 12);
    if (path.length < 1 || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") ||
      entries.some((entry) => entry.path === path) || size > metadata.size - position) invalid();
    const offset = position;
    position += size;
    const padding = (512 - (size % 512)) % 512;
    if (padding > 0 && !zeroBlock(await readExact(handle, padding, position))) invalid();
    position += padding;
    entries.push(Object.freeze({ path, offset, size }));
  }
  if (terminalBlocks !== 2 || position !== metadata.size) invalid();
  return { metadata, entries };
}

function parseBoundedJson(bytes, maxJsonBytes) {
  if (bytes.byteLength > maxJsonBytes) invalid();
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalid(); }
}

export async function inspectCanonicalOciUstarDescriptor(handle, limits) {
  const { metadata, entries } = await descriptorEntries(handle, limits);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const layoutEntry = byPath.get("oci-layout");
  const indexEntry = byPath.get("index.json");
  if (!layoutEntry || !indexEntry) invalid();
  const layout = parseBoundedJson(await readExact(handle, layoutEntry.size, layoutEntry.offset), limits.maxJsonBytes);
  if (Object.keys(layout).length !== 1 || layout.imageLayoutVersion !== "1.0.0") invalid();
  const index = parseBoundedJson(await readExact(handle, indexEntry.size, indexEntry.offset), limits.maxJsonBytes);
  if (index?.schemaVersion !== 2 || index?.mediaType !== "application/vnd.oci.image.index.v1+json" ||
    !Array.isArray(index.manifests) || index.manifests.length !== 1) invalid();
  const selected = index.manifests[0];
  if (selected?.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
    selected?.platform?.os !== "linux" || selected?.platform?.architecture !== "amd64" ||
    Object.keys(selected.platform).some((key) => !["os", "architecture"].includes(key)) ||
    !/^sha256:[a-f0-9]{64}$/.test(selected.digest ?? "") || !Number.isSafeInteger(selected.size)) invalid();
  const blobEntries = entries.filter(({ path }) => path.startsWith("blobs/sha256/"));
  if (blobEntries.length !== entries.length - 2) invalid();
  const blobs = blobEntries.map((entry) => {
    const match = /^blobs\/sha256\/([a-f0-9]{64})$/.exec(entry.path);
    if (!match) invalid();
    return Object.freeze({ digest: `sha256:${match[1]}`, offset: entry.offset, size: entry.size });
  });
  const byDigest = new Map(blobs.map((blob) => [blob.digest, blob]));
  if (byDigest.size !== blobs.length) invalid();
  const manifestEntry = byDigest.get(selected.digest);
  if (!manifestEntry || manifestEntry.size !== selected.size || manifestEntry.size > limits.maxJsonBytes) invalid();
  const manifestBytes = await readExact(handle, manifestEntry.size, manifestEntry.offset);
  if (`sha256:${createHash("sha256").update(manifestBytes).digest("hex")}` !== selected.digest) invalid();
  const manifest = parseBoundedJson(manifestBytes, limits.maxJsonBytes);
  if (manifest?.schemaVersion !== 2 || manifest?.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
    !manifest.config || !Array.isArray(manifest.layers)) invalid();
  const reachable = [manifest.config, ...manifest.layers];
  for (const reference of reachable) {
    const blob = byDigest.get(reference?.digest);
    if (!blob || blob.size !== reference.size || !/^sha256:[a-f0-9]{64}$/.test(reference.digest ?? "")) invalid();
  }
  if (new Set([selected.digest, ...reachable.map(({ digest }) => digest)]).size !== blobs.length) invalid();
  return Object.freeze({
    stat: Object.freeze({
      isFile: metadata.isFile(),
      isSymbolicLink: metadata.isSymbolicLink(),
      mode: metadata.mode & 0o777,
      size: metadata.size,
      device: metadata.dev,
      inode: metadata.ino,
    }),
    imageManifestDigest: selected.digest,
    platform: "linux/amd64",
    blobs: Object.freeze(blobs),
  });
}

export async function readCanonicalOciUstarEntries(archivePath, limits) {
  const handle = await open(archivePath, "r");
  try {
    const metadata = await handle.stat();
    const entries = [];
    let position = 0;
    let totalBytes = 0;
    let terminalBlocks = 0;
    while (position < metadata.size) {
      const header = await readExact(handle, 512, position);
      position += 512;
      if (zeroBlock(header)) {
        terminalBlocks += 1;
        if (terminalBlocks === 2) break;
        continue;
      }
      if (terminalBlocks !== 0 || entries.length >= limits.maxEntries) invalid();
      const storedChecksum = parseOctal(header, 148, 8);
      const checksumHeader = Buffer.from(header);
      checksumHeader.fill(0x20, 148, 156);
      if (checksumHeader.reduce((sum, byte) => sum + byte, 0) !== storedChecksum ||
        parseString(header, 257, 6) !== "ustar" || ![0, 0x30].includes(header[156]) ||
        parseOctal(header, 100, 8) !== 0o644 || parseOctal(header, 108, 8) !== 0 ||
        parseOctal(header, 116, 8) !== 0 || parseOctal(header, 136, 12) !== 0) invalid();
      const path = parseString(header, 0, 100);
      const size = parseOctal(header, 124, 12);
      if (path.length < 1 || size > limits.maxTotalBlobBytes || totalBytes + size > limits.maxTotalBlobBytes) invalid();
      const bytes = await readExact(handle, size, position);
      position += size;
      const padding = (512 - (size % 512)) % 512;
      if (padding > 0 && !zeroBlock(await readExact(handle, padding, position))) invalid();
      position += padding;
      totalBytes += size;
      entries.push(Object.freeze({ path, type: "file", bytes }));
    }
    if (terminalBlocks !== 2 || position !== metadata.size) invalid();
    return Object.freeze(entries);
  } finally {
    await handle.close();
  }
}
