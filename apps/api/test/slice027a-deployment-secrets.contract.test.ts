// @vitest-environment node

import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type DeploymentProfile = "api" | "worker" | "recording-importer";
type Environment = Record<string, string | undefined>;
type DeploymentSecretsModule = {
  resolveDeploymentEnvironment?: (
    profile: DeploymentProfile,
    environment: Environment,
  ) => Promise<Environment>;
};

const temporaryDirectories: string[] = [];

async function deploymentSecretsModule(): Promise<DeploymentSecretsModule> {
  const modulePath = fileURLToPath(
    new URL("../src/deployment-secrets.ts", import.meta.url),
  );
  try {
    return await import(/* @vite-ignore */ modulePath) as DeploymentSecretsModule;
  } catch {
    return {};
  }
}

async function resolve(
  profile: DeploymentProfile,
  environment: Environment,
): Promise<Environment> {
  const module = await deploymentSecretsModule();
  expect(module.resolveDeploymentEnvironment).toBeTypeOf("function");
  return module.resolveDeploymentEnvironment!(profile, environment);
}

async function temporaryFile(
  name: string,
  content: string | Uint8Array,
): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027a-secret-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return { directory, path };
}

async function temporaryFifo(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027a-secret-fifo-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  const created = spawnSync("mkfifo", [path], { encoding: "utf8" });
  expect(created.status, created.stderr || "mkfifo must create the bounded test fixture").toBe(0);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Slice 027A deployment secret-file boundary", () => {
  it("preserves direct-environment compatibility for the exact API allowlist", async () => {
    await expect(resolve("api", {
      DATABASE_URL: "  postgres://api.invalid/proofline  ",
      PROOFLINE_TOKEN_DIGEST_KEY: "  digest-key  ",
      PROOFLINE_WEB_ORIGIN: "https://proofline.example",
    })).resolves.toEqual({
      DATABASE_URL: "postgres://api.invalid/proofline",
      PROOFLINE_TOKEN_DIGEST_KEY: "digest-key",
      PROOFLINE_WEB_ORIGIN: "https://proofline.example",
    });
  });

  it.each([
    ["api", {
      DATABASE_URL: "postgres://api.invalid/proofline",
      PROOFLINE_TOKEN_DIGEST_KEY: "digest-key",
    }],
    ["worker", {
      DATABASE_URL: "postgres://worker.invalid/proofline",
      PROOFLINE_VERIFIER_API_KEY: "verifier-key",
      PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"1".repeat(64)}`,
    }],
    ["recording-importer", {
      DATABASE_URL: "postgres://importer.invalid/proofline",
    }],
  ] as const)(
    "reads only the exact %s profile files and removes _FILE indirection",
    async (profile, values) => {
      const environment: Environment = { PORT: "8080" };
      for (const [name, value] of Object.entries(values)) {
        const file = await temporaryFile(name.toLowerCase(), `${value}\n`);
        environment[`${name}_FILE`] = file.path;
      }
      const resolved = await resolve(profile, environment);
      expect(resolved).toMatchObject({ ...values, PORT: "8080" });
      expect(Object.keys(resolved).some((name) => name.endsWith("_FILE"))).toBe(false);
    },
  );

  it.each([
    ["both direct and file", async () => {
      const file = await temporaryFile("database-url", "postgres://file.invalid/db");
      return resolve("recording-importer", {
        DATABASE_URL: "postgres://direct.invalid/db",
        DATABASE_URL_FILE: file.path,
      });
    }],
    ["a missing required secret", () => resolve("api", {
      DATABASE_URL: "postgres://api.invalid/db",
    })],
    ["an unknown Proofline file variable", () => resolve("api", {
      DATABASE_URL: "postgres://api.invalid/db",
      PROOFLINE_TOKEN_DIGEST_KEY: "digest-key",
      PROOFLINE_UNEXPECTED_FILE: "/run/secrets/unexpected",
    })],
    ["an unknown database file variable", () => resolve("api", {
      DATABASE_URL: "postgres://api.invalid/db",
      PROOFLINE_TOKEN_DIGEST_KEY: "digest-key",
      DATABASE_URL_BACKUP_FILE: "/run/secrets/unexpected",
    })],
    ["an unknown deployment profile", () => resolve(
      "unknown" as DeploymentProfile,
      {},
    )],
  ])("fails closed for %s", async (_label, operation) => {
    await expect(operation()).rejects.toMatchObject({
      code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
      message: "Deployment secret configuration is invalid",
    });
  });

  it("rejects directories and symlinks without following them", async () => {
    const target = await temporaryFile("target", "postgres://api.invalid/db");
    const directoryPath = join(target.directory, "directory");
    const symlinkPath = join(target.directory, "link");
    await mkdir(directoryPath);
    await symlink(target.path, symlinkPath);

    for (const path of [directoryPath, symlinkPath]) {
      await expect(resolve("recording-importer", {
        DATABASE_URL_FILE: path,
      })).rejects.toMatchObject({
        code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
        message: "Deployment secret configuration is invalid",
      });
    }
  });

  it("opens deployment secret paths with no-follow and nonblocking flags before fstat", async () => {
    const source = await readFile(
      new URL("../src/deployment-secrets.ts", import.meta.url),
      "utf8",
    );
    const openCall = source.match(/open\(\s*path\s*,([\s\S]*?)\);/)?.[1] ?? "";
    expect(openCall).toMatch(/(?:constants\.)?O_RDONLY/);
    expect(openCall).toMatch(/(?:constants\.)?O_NOFOLLOW/);
    expect(openCall).toMatch(/(?:constants\.)?O_NONBLOCK/);
    expect(source.indexOf("open(path")).toBeLessThan(source.indexOf("handle.stat()"));
  });

  it("rejects a FIFO 30 times without blocking before the regular-file check", async () => {
    for (let repetition = 0; repetition < 30; repetition += 1) {
      const path = await temporaryFifo(`database-url-${repetition}`);
      const startedAt = Date.now();
      const operation = resolve("recording-importer", {
        DATABASE_URL_FILE: path,
      }).then(
        (value) => ({ kind: "resolved" as const, value }),
        (cause: unknown) => ({ kind: "rejected" as const, cause }),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const first = await Promise.race([
        operation,
        new Promise<{ kind: "timeout" }>((resolveTimeout) => {
          timer = setTimeout(() => resolveTimeout({ kind: "timeout" }), 100);
        }),
      ]);
      if (timer) clearTimeout(timer);

      let settled = first;
      if (first.kind === "timeout") {
        const writer = await open(
          path,
          constants.O_WRONLY | constants.O_NONBLOCK,
        );
        await writer.close();
        settled = await operation;
      }

      expect(first.kind, `FIFO repetition ${repetition} exceeded 100 ms`).not.toBe("timeout");
      expect(Date.now() - startedAt).toBeLessThan(500);
      expect(settled).toMatchObject({
        kind: "rejected",
        cause: {
          code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
          message: "Deployment secret configuration is invalid",
        },
      });
    }
  });

  it.each([
    ["empty", new Uint8Array()],
    ["whitespace-only", " \n\t"],
    ["NUL", "postgres://api.invalid/db\0hidden"],
    ["invalid UTF-8", Uint8Array.of(0xff, 0xfe)],
  ])("rejects %s file bytes", async (_label, content) => {
    const file = await temporaryFile("invalid", content);
    await expect(resolve("recording-importer", {
      DATABASE_URL_FILE: file.path,
    })).rejects.toMatchObject({
      code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
      message: "Deployment secret configuration is invalid",
    });
  });

  it("accepts exactly 4096 raw file bytes and rejects boundary plus one", async () => {
    const bounded = await temporaryFile("bounded", "x".repeat(4_096));
    await expect(resolve("recording-importer", {
      DATABASE_URL_FILE: bounded.path,
    })).resolves.toMatchObject({ DATABASE_URL: "x".repeat(4_096) });

    const oversized = await temporaryFile("oversized", "x".repeat(4_097));
    await expect(resolve("recording-importer", {
      DATABASE_URL_FILE: oversized.path,
    })).rejects.toMatchObject({
      code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
      message: "Deployment secret configuration is invalid",
    });
  });

  it("never leaks a missing path, filename or supplied secret in its public error", async () => {
    const marker = "never-echo-this-secret";
    const missing = join(tmpdir(), `proofline-${marker}`, "database-url");
    let thrown: unknown;
    try {
      await resolve("recording-importer", { DATABASE_URL_FILE: missing });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toMatchObject({
      code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
      message: "Deployment secret configuration is invalid",
    });
    expect(JSON.stringify(thrown)).not.toContain(marker);
    expect(String((thrown as Error | undefined)?.message)).not.toContain(missing);
  });

  it("resolves API and importer secrets before Pool, listen, connect or runtime work", async () => {
    const [bootstrap, importer] = await Promise.all([
      import("node:fs/promises").then(({ readFile }) =>
        readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8")),
      import("node:fs/promises").then(({ readFile }) =>
        readFile(new URL("../src/import-canonical-url-attack-recording.ts", import.meta.url), "utf8")),
    ]);
    expect(bootstrap).toMatch(/resolveDeploymentEnvironment[\s\S]*["']api["']/);
    expect(bootstrap).toMatch(/await\s+resolveDeploymentEnvironment/);
    expect(importer).toMatch(/resolveDeploymentEnvironment[\s\S]*recording-importer/);
    expect(importer).not.toMatch(/DATABASE_URL\?\.trim/);
    for (const [name, source] of [["API", bootstrap], ["importer", importer]] as const) {
      const resolution = source.indexOf("resolveDeploymentEnvironment");
      expect(resolution, `${name} resolver must be present`).toBeGreaterThanOrEqual(0);
      for (const boundary of ["new Pool", ".listen(", ".connect("]) {
        const index = source.indexOf(boundary);
        if (index >= 0) expect(resolution, `${name} secrets precede ${boundary}`).toBeLessThan(index);
      }
    }
  });
});
