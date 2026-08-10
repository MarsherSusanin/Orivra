// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];
const urls = {
  admin: "postgres://proofline:admin-secret@postgres:5432/proofline",
  migrator: "postgres://proofline_migrator_login:migrator-secret@postgres:5432/proofline",
  api: "postgres://proofline_api_login:api-secret@postgres:5432/proofline",
  worker: "postgres://proofline_worker_login:worker-secret@postgres:5432/proofline",
  importer: "postgres://proofline_recording_importer_login:importer-secret@postgres:5432/proofline",
} as const;

async function optionalBootstrap(): Promise<Record<string, any>> {
  const path = pathToFileURL(fileURLToPath(
    new URL("../src/db-role-bootstrap.ts", import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

async function environment(overrides: Partial<typeof urls> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027b-role-bootstrap-"));
  temporaryDirectories.push(directory);
  const values = { ...urls, ...overrides };
  const paths: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    const path = join(directory, `${name}.url`);
    await writeFile(path, value, { mode: 0o600 });
    paths[name] = path;
  }
  return {
    DATABASE_URL_FILE: paths.admin,
    PROOFLINE_MIGRATOR_DATABASE_URL_FILE: paths.migrator,
    PROOFLINE_API_DATABASE_URL_FILE: paths.api,
    PROOFLINE_WORKER_DATABASE_URL_FILE: paths.worker,
    PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: paths.importer,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("Slice 027B database login-role bootstrap", () => {
  it("requires five exact file-only URLs and resolves them before connecting", async () => {
    const module = await optionalBootstrap();
    expect(module.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    const env = await environment();
    const connect = vi.fn(async () => ({ query: vi.fn(), release: vi.fn() }));
    await module.bootstrapProductionDatabaseRoles({ environment: env, connect });
    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(urls.admin);
    expect(JSON.stringify(connect.mock.calls)).not.toMatch(/(?:migrator|api|worker|importer)-secret/);
  });

  it.each([
    ["wrong API user", { api: "postgres://wrong:secret@postgres:5432/proofline" }],
    ["wrong database", { worker: "postgres://proofline_worker_login:secret@postgres:5432/other" }],
    ["wrong host", { importer: "postgres://proofline_recording_importer_login:secret@db.invalid:5432/proofline" }],
    ["wrong port", { migrator: "postgres://proofline_migrator_login:secret@postgres:5433/proofline" }],
    ["empty password", { api: "postgres://proofline_api_login@postgres:5432/proofline" }],
  ] as const)("rejects %s before the administrator connection", async (_label, override) => {
    const module = await optionalBootstrap();
    expect(module.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    const connect = vi.fn();
    await expect(module.bootstrapProductionDatabaseRoles({
      environment: await environment(override),
      connect,
    })).rejects.toMatchObject({
      code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
      message: "Deployment secret configuration is invalid",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("creates or rotates exact LOGIN roles through one pg_temp bind-parameter function", async () => {
    const module = await optionalBootstrap();
    expect(module.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values });
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    await module.bootstrapProductionDatabaseRoles({
      environment: await environment(),
      connect: vi.fn(async () => client),
    });
    const sql = calls.map(({ sql }) => sql).join("\n");
    expect(sql).toMatch(/pg_temp\.ensure_login/i);
    expect(sql).toMatch(/LOGIN[\s\S]*INHERIT[\s\S]*NOSUPERUSER[\s\S]*NOCREATEDB[\s\S]*NOREPLICATION[\s\S]*NOBYPASSRLS/i);
    expect(sql).toMatch(/proofline_migrator_login[\s\S]*CREATEROLE/i);
    expect(sql).toMatch(/GRANT\s+CONNECT\s*,?\s*CREATE\s+ON DATABASE/i);
    for (const [name, url] of Object.entries(urls).slice(1)) {
      const parsed = new URL(url);
      expect(calls.some(({ values }) =>
        values?.includes(parsed.username) && values?.includes(parsed.password)))
        .toBe(true);
      expect(sql).not.toContain(parsed.password);
      expect(sql).not.toContain(name === "importer" ? "importer-secret" : `${name}-secret`);
    }
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("gives no application login elevated attributes or pre-migration table authority", async () => {
    const module = await optionalBootstrap();
    expect(module.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    const queries: string[] = [];
    await module.bootstrapProductionDatabaseRoles({
      environment: await environment(),
      connect: vi.fn(async () => ({
        query: vi.fn(async (sql: string) => {
          queries.push(sql);
          return { rowCount: 0, rows: [] };
        }),
        release: vi.fn(),
      })),
    });
    const sql = queries.join("\n");
    for (const role of [
      "proofline_api_login",
      "proofline_worker_login",
      "proofline_recording_importer_login",
    ]) {
      const mentions = sql.split("\n").filter((line) => line.includes(role)).join("\n");
      expect(mentions).not.toMatch(/CREATEROLE|SUPERUSER|CREATEDB|REPLICATION|BYPASSRLS/);
    }
    expect(sql).not.toMatch(/proofline_private\.|GRANT\s+proofline_(?:api|worker|recording_importer)\s+TO/i);
  });

  it("uses the migrator only after schema creation to grant exact NOLOGIN memberships", async () => {
    const module = await optionalBootstrap();
    expect(module.grantApplicationRoleMemberships).toBeTypeOf("function");
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
    await module.grantApplicationRoleMemberships({ query });
    const sql = query.mock.calls.map(([value]) => String(value)).join("\n");
    expect(sql).toMatch(/GRANT proofline_api TO proofline_api_login/i);
    expect(sql).toMatch(/GRANT proofline_worker TO proofline_worker_login/i);
    expect(sql).toMatch(/GRANT proofline_recording_importer TO proofline_recording_importer_login/i);
    expect(sql).not.toMatch(/GRANT proofline_(?:api|worker|recording_importer) TO proofline_migrator_login/i);
    expect(sql).not.toMatch(/proofline_migrator\b/);
  });

  it("normalizes every setup failure without URL, password, SQL, path or cause leakage", async () => {
    const module = await optionalBootstrap();
    expect(module.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    const raw = "postgres://proofline:never-echo@postgres:5432/proofline";
    let thrown: unknown;
    try {
      await module.bootstrapProductionDatabaseRoles({
        environment: await environment({ admin: raw }),
        connect: vi.fn(async () => {
          throw new Error(`private driver failure ${raw} /tmp/secret-admin-url`);
        }),
      });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toMatchObject({
      code: "DEPLOYMENT_ROLE_BOOTSTRAP_FAILED",
      message: "Database role bootstrap failed",
    });
    expect(`${JSON.stringify(thrown)}\n${String((thrown as Error)?.message)}`)
      .not.toMatch(/never-echo|postgres:|secret-admin|private driver|SELECT|CREATE ROLE/i);
  });
});
