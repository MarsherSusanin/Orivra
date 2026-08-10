import { access, readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDockerPrefetch } from "./docker-prefetch-orchestration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(resolve(root, "docker/base-images.json"), "utf8"));
const walGLock = JSON.parse(await readFile(resolve(root, "docker/wal-g-release.v1.json"), "utf8"));
const inspectionCommand = ["buildx", "imagetools", "inspect"];
void inspectionCommand;
if (lock.version !== "1" || lock.platform !== "linux/amd64") {
  throw new Error("Invalid base image lock");
}
for (const name of ["node", "caddy", "postgres", "postgresRecovery", "minio", "minioClient"]) {
  const image = lock.images?.[name];
  if (
    !image ||
    !/^sha256:[a-f0-9]{64}$/.test(image.indexDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(image.linuxAmd64Digest)
  ) {
    throw new Error("Invalid locked image identity");
  }
}

const pluginCandidates = [
  "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx",
  "/usr/local/lib/docker/cli-plugins/docker-buildx",
  "/usr/libexec/docker/cli-plugins/docker-buildx",
];
let dockerCliPluginPath;
for (const candidate of pluginCandidates) {
  try {
    await access(candidate);
    dockerCliPluginPath = await realpath(candidate);
    break;
  } catch {}
}

await runDockerPrefetch({
  root,
  lock,
  walGLock,
  dockerCliPluginPath,
  environment: process.env,
});
