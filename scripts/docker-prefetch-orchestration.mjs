import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

export const PREFETCH_CHILD_ENV_NAMES = Object.freeze([
  "DOCKER_CONFIG",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
]);

export const PREFETCH_FORBIDDEN_AMBIENT_AUTHORITY_NAMES = Object.freeze([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
]);

const WAL_G_ASSET_URL =
  "https://github.com/wal-g/wal-g/releases/download/v3.0.8/wal-g-pg-22.04-amd64.tar.gz";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validateWalGLock(lock) {
  if (
    lock?.version !== "1" ||
    lock?.walGVersion !== "v3.0.8" ||
    lock?.platform !== "linux/amd64" ||
    lock?.assetUrl !== WAL_G_ASSET_URL ||
    !Number.isSafeInteger(lock?.maximumBytes) ||
    lock.maximumBytes < 1_000_000 ||
    lock.maximumBytes > 100_000_000 ||
    !/^sha256:[a-f0-9]{64}$/.test(lock?.assetSha256 ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(lock?.binarySha256 ?? "") ||
    lock.assetSha256 === lock.binarySha256
  ) {
    throw new Error("Invalid WAL-G release lock");
  }
}

function requestAsset(url, maximumBytes, redirectCount = 0) {
  return new Promise((resolvePromise, reject) => {
    const parsed = new URL(url);
    const initial = parsed.href === WAL_G_ASSET_URL;
    const redirected =
      parsed.protocol === "https:" &&
      parsed.hostname === "release-assets.githubusercontent.com";
    if ((!initial && !redirected) || redirectCount > 4) {
      reject(new Error("WAL-G release redirect is not allowed"));
      return;
    }
    const request = httpsGet(parsed, { timeout: 30_000 }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        if (!response.headers.location) {
          reject(new Error("WAL-G release redirect is invalid"));
          return;
        }
        const next = new URL(response.headers.location, parsed).href;
        requestAsset(next, maximumBytes, redirectCount + 1).then(resolvePromise, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("WAL-G release download failed"));
        return;
      }
      const length = Number(response.headers["content-length"] ?? 0);
      if (length && (!Number.isSafeInteger(length) || length > maximumBytes)) {
        response.destroy(new Error("WAL-G release exceeds maximumBytes"));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maximumBytes) {
          response.destroy(new Error("WAL-G release exceeds maximumBytes"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => resolvePromise(Buffer.concat(chunks)));
      response.once("error", reject);
    });
    request.once("timeout", () => request.destroy(new Error("WAL-G release download timed out")));
    request.once("error", reject);
  });
}

function extractWalGBinary(archive) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeRaw = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeRaw || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) {
      throw new Error("Invalid WAL-G release archive");
    }
    if (name === "wal-g-pg-22.04-amd64") {
      return Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("WAL-G binary is absent from the release archive");
}

export async function prefetchWalGRelease({ root, lock, download = requestAsset }) {
  validateWalGLock(lock);
  const archive = await download(lock.assetUrl, lock.maximumBytes);
  if (sha256(archive) !== lock.assetSha256) throw new Error("WAL-G archive checksum mismatch");
  const binary = extractWalGBinary(archive);
  if (sha256(binary) !== lock.binarySha256) throw new Error("WAL-G binary checksum mismatch");
  const destination = join(root, "docker/.prefetch/wal_g_release");
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(dirname(destination), ".wal-g-release-"));
  try {
    await writeFile(join(temporary, "wal-g"), binary, { mode: 0o555 });
    await writeFile(join(temporary, "receipt.v1.json"), JSON.stringify({
      binarySha256: lock.binarySha256,
      binarySize: binary.length,
      version: "1",
    }), { mode: 0o444 });
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true });
    throw cause;
  }
}

function exactString(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

export function createCredentialFreePrefetchEnvironment({
  ambientEnvironment,
  dockerConfigDirectory,
  homeDirectory,
  xdgConfigDirectory,
  temporaryDirectory,
} = {}) {
  const isolated = {
    DOCKER_CONFIG: dockerConfigDirectory,
    HOME: homeDirectory,
    LANG: "C",
    LC_ALL: "C",
    PATH: ambientEnvironment?.PATH,
    TMPDIR: temporaryDirectory,
    TZ: "UTC",
    XDG_CONFIG_HOME: xdgConfigDirectory,
  };
  if (
    Object.keys(isolated).length !== PREFETCH_CHILD_ENV_NAMES.length ||
    PREFETCH_CHILD_ENV_NAMES.some((name) => !exactString(isolated[name])) ||
    PREFETCH_FORBIDDEN_AMBIENT_AUTHORITY_NAMES.some((name) =>
      Object.hasOwn(isolated, name))
  ) {
    throw new Error("Docker prefetch environment is invalid");
  }
  return Object.freeze(isolated);
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
  walGLock,
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
    const childEnvironment = createCredentialFreePrefetchEnvironment({
      ambientEnvironment: environment,
      dockerConfigDirectory: join(temporaryDirectory, "docker-cli"),
      homeDirectory: join(temporaryDirectory, "home"),
      xdgConfigDirectory: join(temporaryDirectory, "xdg"),
      temporaryDirectory: join(temporaryDirectory, "tmp"),
    });
    await Promise.all([
      mkdir(childEnvironment.DOCKER_CONFIG, { mode: 0o700 }),
      mkdir(childEnvironment.HOME, { mode: 0o700 }),
      mkdir(childEnvironment.XDG_CONFIG_HOME, { mode: 0o700 }),
      mkdir(childEnvironment.TMPDIR, { mode: 0o700 }),
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

    if (walGLock) await prefetchWalGRelease({ root, lock: walGLock });

    for (const name of ["node", "caddy", "postgres", "postgresRecovery", "minio", "minioClient"]) {
      const image = imageLock.images?.[name];
      if (!image) continue;
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
