import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
// Docker's boolean syntax for the required --pull false policy is --pull=false.

function run(args) {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Offline Docker build failed");
}

for (const repetition of [1, 2]) {
  for (const target of applicationBuilds) {
    run([
      "build",
      "--platform",
      "linux/amd64",
      "--pull=false",
      "--network",
      "none",
      "--build-arg",
      "NPM_CONFIG_OFFLINE=true",
      ...target,
      "--file",
      "docker/Dockerfile",
      root,
    ]);
  }
  run([
    "build",
    "--platform",
    "linux/amd64",
    "--pull=false",
    "--network",
    "none",
    ...caddyBuild,
    root,
  ]);
  process.stdout.write(`Offline build pass ${repetition} complete\n`);
}
