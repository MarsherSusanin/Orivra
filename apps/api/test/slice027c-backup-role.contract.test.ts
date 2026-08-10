// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  backup: "postgres://proofline_backup_login:backup-secret@postgres:5432/proofline",
} as const;

async function optionalModule(relative: string): Promise<Record<string, any>> {
  const path = pathToFileURL(fileURLToPath(
    new URL(`../src/${relative}.ts`, import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

async function fileEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027c-backup-role-"));
  temporaryDirectories.push(directory);
  const paths: Record<string, string> = {};
  for (const [name, value] of Object.entries(urls)) {
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
    PROOFLINE_BACKUP_DATABASE_URL_FILE: paths.backup,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("Slice 027C backup database authority", () => {
  it("resolves one bounded file-only backup profile without leaking its URL", async () => {
    const module = await optionalModule("deployment-secrets");
    expect(module.resolveDeploymentEnvironment).toBeTypeOf("function");
    const environment = await fileEnvironment();
    const result = await module.resolveDeploymentEnvironment("backup", {
      PROOFLINE_BACKUP_DATABASE_URL_FILE:
        environment.PROOFLINE_BACKUP_DATABASE_URL_FILE,
    });
    expect(result).toEqual({ PROOFLINE_BACKUP_DATABASE_URL: urls.backup });
    expect(result).not.toHaveProperty("PROOFLINE_BACKUP_DATABASE_URL_FILE");
  });

  it("requires the sixth exact backup URL before the administrator connection", async () => {
    const module = await optionalModule("db-role-bootstrap-core");
    expect(module.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    const connect = vi.fn(async () => ({
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      release: vi.fn(),
    }));
    const environment = await fileEnvironment();
    await expect(module.bootstrapProductionDatabaseRoles({
      environment,
      connect,
    })).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(urls.admin);
    expect(JSON.stringify(connect.mock.calls)).not.toContain("backup-secret");
  });

  it.each([
    "postgres://proofline_worker_login:secret@postgres:5432/proofline",
    "postgres://proofline_backup_login@postgres:5432/proofline",
    "postgres://proofline_backup_login:secret@db.invalid:5432/proofline",
    "postgres://proofline_backup_login:secret@postgres:5433/proofline",
    "postgres://proofline_backup_login:secret@postgres:5432/other",
  ])("rejects invalid backup URL before a database effect: %s", async (backup) => {
    const source = await readFile(fileURLToPath(
      new URL("../src/db-role-bootstrap-core.ts", import.meta.url),
    ), "utf8");
    expect(source).toContain("proofline_backup_login");
    const module = await optionalModule("db-role-bootstrap-core");
    const environment = await fileEnvironment();
    const directory = await mkdtemp(join(tmpdir(), "proofline-027c-invalid-backup-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "backup.url");
    await writeFile(path, backup, { mode: 0o600 });
    const connect = vi.fn();
    await expect(module.bootstrapProductionDatabaseRoles({
      environment: { ...environment, PROOFLINE_BACKUP_DATABASE_URL_FILE: path },
      connect,
    })).rejects.toMatchObject({
      code: "DEPLOYMENT_SECRET_CONFIGURATION_INVALID",
      message: "Deployment secret configuration is invalid",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("creates one exact REPLICATION login through bind parameters and no secret SQL", async () => {
    const module = await optionalModule("db-role-bootstrap-core");
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values });
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    await module.bootstrapProductionDatabaseRoles({
      environment: await fileEnvironment(),
      connect: vi.fn(async () => client),
    });
    const sql = calls.map(({ sql }) => sql).join("\n");
    const backupCall = calls.find(({ values }) =>
      values?.includes("proofline_backup_login"));
    expect(backupCall?.values).toEqual([
      "proofline_backup_login",
      "backup-secret",
      false,
      true,
    ]);
    expect(sql).not.toContain("backup-secret");
    expect(sql).toMatch(/allow_replication\s+boolean/i);
    expect(sql).toMatch(/LOGIN[\s\S]*INHERIT[\s\S]*NOSUPERUSER[\s\S]*NOCREATEDB[\s\S]*NOCREATEROLE[\s\S]*REPLICATION[\s\S]*NOBYPASSRLS/i);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("grants only CONNECT, pg_monitor and exact PostgreSQL 17 backup functions", async () => {
    const module = await optionalModule("db-role-bootstrap-core");
    const statements: string[] = [];
    await module.bootstrapProductionDatabaseRoles({
      environment: await fileEnvironment(),
      connect: vi.fn(async () => ({
        query: vi.fn(async (sql: string) => {
          statements.push(sql);
          return { rowCount: 0, rows: [] };
        }),
        release: vi.fn(),
      })),
    });
    const sql = statements.join("\n");
    expect(sql).toMatch(/GRANT\s+CONNECT\s+ON DATABASE proofline TO proofline_backup_login/i);
    expect(sql).toMatch(/GRANT\s+pg_monitor\s+TO proofline_backup_login/i);
    for (const signature of [
      "pg_backup_start(text, boolean)",
      "pg_backup_stop(boolean)",
      "pg_switch_wal()",
    ]) expect(sql).toContain(signature);
    expect(sql).not.toMatch(/proofline_(?:api|worker|recording_importer)\s+TO proofline_backup_login/i);
    expect(sql).not.toMatch(/GRANT[\s\S]{0,80}(?:INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,80}proofline_backup_login/i);
  });

  it("keeps the existing exact application URL parser GREEN", async () => {
    const module = await optionalModule("deployment-database-url");
    expect(module.parseExactApplicationDatabaseUrl(
      urls.worker,
      "proofline_worker_login",
    )).toBe(urls.worker);
  });
});
