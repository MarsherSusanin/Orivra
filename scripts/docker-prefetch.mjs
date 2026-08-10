import { access, readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDockerPrefetch } from "./docker-prefetch-orchestration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(resolve(root, "docker/base-images.json"), "utf8"));
const inspectionCommand = ["buildx", "imagetools", "inspect"];
void inspectionCommand;
if (lock.version !== "1" || lock.platform !== "linux/amd64") {
  throw new Error("Invalid base image lock");
}
for (const name of ["node", "caddy", "postgres"]) {
  const image = lock.images?.[name];
  if (
    !image ||
    !/^sha256:[a-f0-9]{64}$/.test(image.indexDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(image.linuxAmd64Digest)
  ) {
    throw new Error("Invalid locked image identity");
  }
}

let dockerHost = process.env.DOCKER_HOST;
if (!dockerHost) {
  const selection = spawnSync("docker", [
    "context",
    "inspect",
    "--format",
    "{{.Endpoints.docker.Host}}",
  ], { cwd: root, encoding: "utf8" });
  if (selection.status !== 0 || !selection.stdout.trim()) {
    throw new Error("Docker daemon selection failed");
  }
  dockerHost = selection.stdout.trim();
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
  dockerCliPluginPath,
  environment: { ...process.env, DOCKER_HOST: dockerHost },
});
