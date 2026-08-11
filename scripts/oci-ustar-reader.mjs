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
