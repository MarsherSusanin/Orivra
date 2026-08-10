import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = resolve(root, "docker/base-images.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock.version !== "1" || lock.platform !== "linux/amd64") {
  throw new Error("Invalid base image lock");
}

function run(args) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`Docker command failed (${args[0]})`);
  }
  return result.stdout;
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
  const inspection = run([
    "buildx",
    "imagetools",
    "inspect",
    `${image.repository}:${image.tag}`,
  ]);
  if (
    !inspection.includes(image.indexDigest) ||
    !inspection.includes(image.linuxAmd64Digest)
  ) {
    throw new Error("Published image identity does not match the lock");
  }
  run([
    "pull",
    "--platform",
    "linux/amd64",
    `${image.repository}@${image.linuxAmd64Digest}`,
  ]);
}

run([
  "build",
  "--platform",
  "linux/amd64",
  "--pull=false",
  "--network=default",
  "--build-arg",
  "NPM_CONFIG_OFFLINE=false",
  "--target",
  "build",
  "--file",
  "docker/Dockerfile",
  root,
]);
