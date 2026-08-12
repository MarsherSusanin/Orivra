import { constants } from "node:fs";
import { open } from "node:fs/promises";

export async function readBoundedPrivateFile(path, {
  maximumBytes,
  mode = 0o400,
  minimumBytes = 1,
} = {}) {
  let handle;
  try {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0") ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
      !Number.isSafeInteger(minimumBytes) || minimumBytes < 0 || minimumBytes > maximumBytes) {
      throw new Error("Private file authority is invalid");
    }
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile() || (status.mode & 0o777) !== mode ||
      status.size < minimumBytes || status.size > maximumBytes) {
      throw new Error("Private file metadata is invalid");
    }
    const bytes = Buffer.alloc(status.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error("Private file read is incomplete");
    return bytes;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
