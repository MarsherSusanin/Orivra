import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AUTHORITY_NAMES = new Set([
  "DOCKER_AUTH_CONFIG",
  "REGISTRY_AUTH_FILE",
  "DOCKER_CONTEXT",
  "GHCR_TOKEN",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "PROOFLINE_VERIFIER_API_KEY",
  "PROOFLINE_COSTON2_PRIVATE_KEY",
]);

function isolatedEnvironment(environment, directory) {
  const isolated = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || AUTHORITY_NAMES.has(name)) continue;
    if (/(?:TOKEN|SECRET|PRIVATE_KEY|API_KEY)$/i.test(name)) continue;
    isolated[name] = value;
  }
  isolated.DOCKER_CONFIG = join(directory, "docker-cli");
  isolated.HOME = join(directory, "home");
  isolated.XDG_CONFIG_HOME = join(directory, "xdg");
  return isolated;
}

function runDocker(dockerExecutable, args, options) {
  const result = spawnSync(dockerExecutable, args, {
    cwd: options.root,
    encoding: "utf8",
    env: options.environment,
  });
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Docker prefetch command failed (${args[0]})`);
  }
  return result.stdout ?? "";
}

export async function runDockerPrefetch({
  dockerExecutable = "docker",
  environment = process.env,
  root = process.cwd(),
  lock,
  dockerCliPluginPath,
} = {}) {
  const imageLock = lock ?? JSON.parse(
    await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(root, "docker/base-images.json"), "utf8")),
  );
  if (imageLock.version !== "1" || imageLock.platform !== "linux/amd64") {
    throw new Error("Invalid base image lock");
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "proofline-docker-cli-"));
  try {
    await chmod(temporaryDirectory, 0o700);
    const childEnvironment = isolatedEnvironment(environment, temporaryDirectory);
    await Promise.all([
      mkdir(childEnvironment.DOCKER_CONFIG, { mode: 0o700 }),
      mkdir(childEnvironment.HOME, { mode: 0o700 }),
      mkdir(childEnvironment.XDG_CONFIG_HOME, { mode: 0o700 }),
    ]);
    await writeFile(
      join(childEnvironment.DOCKER_CONFIG, "config.json"),
      '{"auths":{}}',
      { mode: 0o600 },
    );
    if (dockerCliPluginPath) {
      const pluginDirectory = join(childEnvironment.DOCKER_CONFIG, "cli-plugins");
      await mkdir(pluginDirectory, { mode: 0o700 });
      await symlink(dockerCliPluginPath, join(pluginDirectory, "docker-buildx"));
    }
    const commandOptions = { root, environment: childEnvironment };

    for (const name of ["node", "caddy", "postgres"]) {
      const image = imageLock.images?.[name];
      if (
        !image ||
        !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(image.repository) ||
        !/^sha256:[a-f0-9]{64}$/.test(image.indexDigest) ||
        !/^sha256:[a-f0-9]{64}$/.test(image.linuxAmd64Digest)
      ) {
        throw new Error("Invalid locked image identity");
      }
      const inspection = runDocker(dockerExecutable, [
        "buildx",
        "imagetools",
        "inspect",
        `${image.repository}:${image.tag}`,
      ], commandOptions);
      if (
        !inspection.includes(image.indexDigest) ||
        !inspection.includes(image.linuxAmd64Digest)
      ) {
        throw new Error("Published image identity does not match the lock");
      }
      runDocker(dockerExecutable, [
        "pull",
        "--platform",
        "linux/amd64",
        `${image.repository}@${image.linuxAmd64Digest}`,
      ], commandOptions);
    }

    runDocker(dockerExecutable, [
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
    ], commandOptions);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
