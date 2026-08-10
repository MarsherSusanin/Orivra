// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

type DatabaseAuthorityModule = {
  parseExactApplicationDatabaseUrl?: (
    value: string,
    expectedLogin: string,
  ) => string;
};

async function authorityModule(): Promise<DatabaseAuthorityModule> {
  const path = pathToFileURL(fileURLToPath(
    new URL("../src/deployment-database-url.ts", import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

async function expectRedactedRejection(
  operation: () => unknown,
  forbidden: readonly string[],
) {
  let thrown: unknown;
  try {
    operation();
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toMatchObject({
    code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
    message: "Deployment secret configuration is invalid",
  });
  const exposed = `${JSON.stringify(thrown)}\n${String((thrown as Error)?.message)}`;
  for (const marker of forbidden) expect(exposed).not.toContain(marker);
}

const exact = {
  api: "postgres://proofline_api_login:R7nQ4vZ8mK2p@postgres:5432/proofline",
  worker: "postgres://proofline_worker_login:R7nQ4vZ8mK2p@postgres:5432/proofline",
  importer:
    "postgres://proofline_recording_importer_login:R7nQ4vZ8mK2p@postgres:5432/proofline",
  migrator:
    "postgres://proofline_migrator_login:R7nQ4vZ8mK2p@postgres:5432/proofline",
} as const;
const PASSWORD_SENTINEL = "R7nQ4vZ8mK2p";

describe("Slice 027B exact application database authority", () => {
  it.each([
    ["api", exact.api, "proofline_api_login"],
    ["worker", exact.worker, "proofline_worker_login"],
    ["recording importer", exact.importer, "proofline_recording_importer_login"],
    ["migration runner", exact.migrator, "proofline_migrator_login"],
    [
      "percent-decoded API",
      "postgres://proofline%5Fapi%5Flogin:R7nQ4vZ8mK2p@postgres:5432/proofline",
      "proofline_api_login",
    ],
  ])("accepts only the exact %s login on the private deployment database", async (
    _label,
    value,
    login,
  ) => {
    const module = await authorityModule();
    expect(module.parseExactApplicationDatabaseUrl).toBeTypeOf("function");
    expect(module.parseExactApplicationDatabaseUrl!(value, login)).toBe(value);
  });

  it.each([
    ["swapped API/worker login", exact.worker, "proofline_api_login"],
    [
      "admin login",
      "postgres://proofline:R7nQ4vZ8mK2p@postgres:5432/proofline",
      "proofline_api_login",
    ],
    [
      "wrong host",
      "postgres://proofline_api_login:R7nQ4vZ8mK2p@db.invalid:5432/proofline",
      "proofline_api_login",
    ],
    [
      "wrong port",
      "postgres://proofline_api_login:R7nQ4vZ8mK2p@postgres:5433/proofline",
      "proofline_api_login",
    ],
    [
      "wrong database",
      "postgres://proofline_api_login:R7nQ4vZ8mK2p@postgres:5432/other",
      "proofline_api_login",
    ],
    [
      "empty password",
      "postgres://proofline_api_login@postgres:5432/proofline",
      "proofline_api_login",
    ],
    [
      "query",
      "postgres://proofline_api_login:R7nQ4vZ8mK2p@postgres:5432/proofline?ssl=true",
      "proofline_api_login",
    ],
    [
      "fragment",
      "postgres://proofline_api_login:R7nQ4vZ8mK2p@postgres:5432/proofline#private",
      "proofline_api_login",
    ],
    [
      "alternate protocol",
      "postgresql://proofline_api_login:R7nQ4vZ8mK2p@postgres:5432/proofline",
      "proofline_api_login",
    ],
  ])("rejects %s with one fixed non-leaking error", async (_label, value, login) => {
    const module = await authorityModule();
    expect(module.parseExactApplicationDatabaseUrl).toBeTypeOf("function");
    await expectRedactedRejection(
      () => module.parseExactApplicationDatabaseUrl!(value, login),
      [value, PASSWORD_SENTINEL],
    );
  });

  it("wires exact role validation after secret resolution and before every application Pool", async () => {
    const [api, worker, importer, migrator, roleBootstrap] = await Promise.all([
      readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../../worker/src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/import-canonical-url-attack-recording.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/migrate.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/db-role-bootstrap-core.ts", import.meta.url), "utf8"),
    ]);
    const authorities = [
      [api, "proofline_api_login"],
      [worker, "proofline_worker_login"],
      [importer, "proofline_recording_importer_login"],
      [migrator, "proofline_migrator_login"],
    ] as const;
    for (const [source, login] of authorities) {
      const resolve = source.indexOf("resolveDeploymentEnvironment");
      const authority = source.indexOf("parseExactApplicationDatabaseUrl");
      const pool = source.indexOf("new Pool");
      expect(resolve).toBeGreaterThanOrEqual(0);
      expect(authority).toBeGreaterThan(resolve);
      expect(pool).toBeGreaterThan(authority);
      expect(source).toContain(login);
    }
    expect(roleBootstrap).toMatch(/parseExactDatabaseUrl|parseExactApplicationDatabaseUrl/);
    expect(roleBootstrap).toContain("proofline_migrator_login");
    expect(roleBootstrap).toContain("proofline_api_login");
    expect(roleBootstrap).toContain("proofline_worker_login");
    expect(roleBootstrap).toContain("proofline_recording_importer_login");
  });

  it("keeps the bounded secret reader separate from role authority", async () => {
    const source = await readFile(
      new URL("../src/deployment-secrets.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /proofline_(?:api|worker|recording_importer|migrator)_login/,
    );
    expect(source).not.toMatch(/parseExactApplicationDatabaseUrl/);
    expect(source).toMatch(/O_NOFOLLOW/);
    expect(source).toMatch(/O_NONBLOCK/);
  });
});
