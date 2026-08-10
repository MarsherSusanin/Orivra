import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runOfflineDockerBuilds } from "./docker-build-orchestration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageLock = JSON.parse(readFileSync(resolve(root, "docker/base-images.json"), "utf8"));
const walGLock = JSON.parse(readFileSync(resolve(root, "docker/wal-g-release.v1.json"), "utf8"));
const applicationBuilds = [
  ["--target", "web", "--tag", "proofline/web:027a-qa"],
  ["--target", "api", "--tag", "proofline/api:027a-qa"],
  ["--target", "worker", "--tag", "proofline/worker:027a-qa"],
];
const caddyBuild = [
  "--file",
  "docker/caddy.Dockerfile",
  "--tag",
  "proofline/caddy:027a-qa",
];
const recoveryImage = imageLock.images?.postgresRecovery;
const buildPlatform = "linux/amd64";
const npmOfflineBuildArgument = ["--build-arg", "NPM_CONFIG_OFFLINE=true"];
const pull_policy = false;
const offlineBuildPolicy = [`--pull=${pull_policy}`, "--network", "none"];
const repetitions = [];
for (const repetition of [1, 2]) repetitions.push(repetition);
const recoveryBuild = recoveryImage &&
  /^sha256:[a-f0-9]{64}$/.test(recoveryImage.linuxAmd64Digest)
  ? [
      "--file",
      "docker/postgres-recovery.Dockerfile",
      "--tag",
      "proofline/postgres-recovery:027c-qa",
      "--build-context",
      "wal_g_release=docker/.prefetch/wal_g_release",
    ]
  : undefined;
// Docker's boolean syntax for the required --pull false policy is --pull=false.

function runDocker(args) {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Offline Docker build failed");
}

await runOfflineDockerBuilds({
  root,
  imageLock,
  walGLock,
  runDocker,
  applicationBuilds,
  caddyBuild,
  recoveryBuild,
  buildPolicy: offlineBuildPolicy,
  buildPlatform,
  npmOfflineBuildArgument,
  repetitions,
});
