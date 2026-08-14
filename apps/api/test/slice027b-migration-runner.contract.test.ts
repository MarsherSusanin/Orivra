// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const LOCK = -4_708_329_426_407_388_777n;

async function runnerModule(): Promise<Record<string, any>> {
  const path = pathToFileURL(fileURLToPath(
    new URL("../src/migration-runner.ts", import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

function plan() {
  return {
    manifest: {
      version: "1",
      lockKey: String(LOCK),
      schema: {
        targetVersion: 10,
        minimumCompatibleVersion: 10,
        maximumCompatibleVersion: 10,
      },
    },
    migrations: Array.from({ length: 10 }, (_, index) => {
      const version = index + 1;
      return {
        version,
        filename: `${String(version).padStart(3, "0")}_${version === 10 ? "deployment_lifecycle" : `fixture_${version}`}.sql`,
        sha256: `sha256:${String(version).padStart(64, "0")}`,
        body: `SELECT ${version};`,
      };
    }),
  };
}

function history(version = 10) {
  const expected = plan().migrations.slice(0, version);
  return {
    versions: expected.map(({ version: value }) => value),
    checksums: expected.map(({ version: value, filename, sha256 }) => ({
      version: value,
      filename,
      sha256,
    })),
  };
}

function expectCode(operation: () => unknown, code: string) {
  try {
    operation();
  } catch (cause) {
    expect(cause).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Slice 027B migration history and runner orchestration", () => {
  it("accepts only fresh or exact contiguous checksummed history", async () => {
    const module = await runnerModule();
    expect(module.verifyMigrationHistory).toBeTypeOf("function");
    expect(module.verifyMigrationHistory(plan(), {
      schemaMigrationsExists: false,
      checksumLedgerExists: false,
      versions: [],
      checksums: [],
    })).toEqual({ kind: "fresh", fromVersion: 0 });
    expect(module.verifyMigrationHistory(plan(), {
      schemaMigrationsExists: true,
      checksumLedgerExists: true,
      ...history(),
    })).toEqual({ kind: "current", fromVersion: 10 });
    expect(module.verifyMigrationHistory(plan(), {
      schemaMigrationsExists: true,
      checksumLedgerExists: true,
      ...history(9),
    })).toEqual({ kind: "pending", fromVersion: 9 });
  });

  it("never adopts legacy version-only history", async () => {
    const module = await runnerModule();
    expect(module.verifyMigrationHistory).toBeTypeOf("function");
    for (const version of [1, 5, 9]) {
      expectCode(() => module.verifyMigrationHistory(plan(), {
        schemaMigrationsExists: true,
        checksumLedgerExists: false,
        versions: Array.from({ length: version }, (_, index) => index + 1),
        checksums: [],
      }), "MIGRATION_HISTORY_UNVERIFIED");
    }
  });

  it.each([
    ["checksum mismatch", { ...history(), checksums: history().checksums.map((row, index) =>
      index === 2 ? { ...row, sha256: `sha256:${"f".repeat(64)}` } : row) }, "MIGRATION_CHECKSUM_MISMATCH"],
    ["version gap", { ...history(), versions: [1, 2, 4, 5, 6, 7, 8, 9, 10] }, "MIGRATION_VERSION_GAP"],
    ["database ahead", { ...history(), versions: [...history().versions, 11] }, "MIGRATION_DATABASE_AHEAD"],
  ] as const)("classifies %s with one fixed code", async (_label, value, code) => {
    const module = await runnerModule();
    expect(module.verifyMigrationHistory).toBeTypeOf("function");
    expectCode(() => module.verifyMigrationHistory(plan(), {
      schemaMigrationsExists: true,
      checksumLedgerExists: true,
      ...value,
    }), code);
  });

  it("classifies a post-apply exact-target mismatch with one fixed code", async () => {
    const module = await runnerModule();
    expect(module.verifyMigrationTarget).toBeTypeOf("function");
    expectCode(
      () => module.verifyMigrationTarget(plan(), history(9)),
      "MIGRATION_TARGET_MISMATCH",
    );
  });

  it("classifies advisory-lock timeout before a transaction or migration body", async () => {
    const module = await runnerModule();
    expect(module.runVerifiedMigrations).toBeTypeOf("function");
    const sql: string[] = [];
    const client = {
      query: vi.fn(async (value: string) => {
        sql.push(value);
        if (/pg_advisory_lock/i.test(value)) {
          throw new Error("private lock timeout postgres://secret@db.invalid");
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    await expect(module.runVerifiedMigrations({
      pool: { connect: vi.fn(async () => client) },
      plan: plan(),
      logger: { info: vi.fn(), error: vi.fn() },
    })).rejects.toMatchObject({ code: "MIGRATION_LOCK_TIMEOUT" });
    expect(sql.join("\n")).not.toMatch(/^BEGIN;?$|SELECT 1;|SELECT 10;/m);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("takes the fixed session lock, owns one outer transaction and unlocks after exact verification", async () => {
    const module = await runnerModule();
    expect(module.runVerifiedMigrations).toBeTypeOf("function");
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values });
        if (/to_regclass/i.test(sql)) {
          return { rowCount: 1, rows: [{ schema_migrations: null, migration_checksums: null }] };
        }
        if (/JOIN proofline_private\.migration_checksums/i.test(sql)) {
          return { rowCount: 10, rows: history().checksums };
        }
        if (/SELECT[^;]+version[^;]+schema_migrations/i.test(sql)) {
          return { rowCount: 10, rows: history().versions.map((version) => ({ version })) };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    await expect(module.runVerifiedMigrations({
      pool,
      plan: plan(),
      logger: { info: vi.fn(), error: vi.fn() },
    })).resolves.toMatchObject({ fromVersion: 0, toVersion: 10 });
    const sql = calls.map(({ sql }) => sql.trim());
    const lock = sql.findIndex((value) => /pg_advisory_lock/i.test(value));
    const begin = sql.findIndex((value) => /^BEGIN;?$/i.test(value));
    const lastBody = sql.findIndex((value) => /^SELECT 10;?$/i.test(value));
    const ledger = sql.findIndex((value) =>
      /INSERT INTO proofline_private\.migration_checksums/i.test(value));
    const commit = sql.findIndex((value) => /^COMMIT;?$/i.test(value));
    const unlock = sql.findIndex((value) => /pg_advisory_unlock/i.test(value));
    expect(sql.some((value) => /statement_timeout[\s\S]*60000/i.test(value))).toBe(true);
    expect(calls[lock]?.values).toContain(LOCK);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(begin).toBeGreaterThan(lock);
    expect(lastBody).toBeGreaterThan(begin);
    expect(ledger).toBeGreaterThan(lastBody);
    expect(calls.slice(ledger, commit).flatMap(({ values }) => values ?? []))
      .toEqual(expect.arrayContaining(plan().migrations.flatMap((migration) => [
        migration.version,
        migration.filename,
        migration.sha256,
      ])));
    expect(commit).toBeGreaterThan(begin);
    expect(unlock).toBeGreaterThan(commit);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("repairs exact application grants even when the checksummed schema is already current", async () => {
    const module = await runnerModule();
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (/to_regclass/i.test(sql)) return { rowCount: 1, rows: [{ schema_migrations: "proofline_private.schema_migrations", migration_checksums: "proofline_private.migration_checksums" }] };
        if (/JOIN proofline_private\.migration_checksums/i.test(sql)) return { rowCount: 10, rows: history().checksums };
        if (/SELECT version FROM proofline_private\.schema_migrations/i.test(sql)) return { rowCount: 10, rows: history().versions.map((version) => ({ version })) };
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    await expect(module.runVerifiedMigrations({ pool: { connect: vi.fn(async () => client) }, plan: plan() }))
      .resolves.toEqual({ fromVersion: 10, toVersion: 10 });
    expect(calls.join("\n")).toMatch(/GRANT SELECT, INSERT ON TABLE proofline_private\.run_commands TO proofline_api/i);
  });

  it("rolls back, unlocks and releases on an apply failure without a target-success log", async () => {
    const module = await runnerModule();
    expect(module.runVerifiedMigrations).toBeTypeOf("function");
    const sql: string[] = [];
    const logger = { info: vi.fn(), error: vi.fn() };
    const client = {
      query: vi.fn(async (value: string) => {
        sql.push(value.trim());
        if (/to_regclass/i.test(value)) {
          return { rowCount: 1, rows: [{ schema_migrations: null, migration_checksums: null }] };
        }
        if (/SELECT 5;/.test(value)) throw new Error("private SQL cause postgres://secret@db.invalid");
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    await expect(module.runVerifiedMigrations({
      pool: { connect: vi.fn(async () => client) },
      plan: plan(),
      logger,
    })).rejects.toMatchObject({ code: "MIGRATION_APPLY_FAILED" });
    expect(sql.some((value) => /^ROLLBACK;?$/i.test(value))).toBe(true);
    expect(sql.some((value) => /pg_advisory_unlock/i.test(value))).toBe(true);
    expect(sql.some((value) => /^COMMIT;?$/i.test(value))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/toVersion["': ]+10/i);
  });

  it("limits logs to bounded migration metadata without SQL, URL, parameters, paths or causes", async () => {
    const source = await readFile(
      new URL("../src/migration-runner.ts", import.meta.url),
      "utf8",
    ).catch(() => "");
    expect(source).toMatch(/event/);
    expect(source).toMatch(/fromVersion/);
    expect(source).toMatch(/toVersion/);
    expect(source).toMatch(/filename/);
    expect(source).not.toMatch(/logger\.(?:info|error)\s*\([^)]*(?:sql|values|params|cause|DATABASE_URL|migrationsDirectory)/i);
  });

  it("keeps the operator entry fixed to the checked-in directory and redacts bounded failures", async () => {
    const source = await readFile(new URL("../src/migrate.ts", import.meta.url), "utf8")
      .catch(() => "");
    expect(source).toMatch(/runProductionMigrations/);
    expect(source).toMatch(/apps\/api\/db\/migrations|\/app\/apps\/api\/db\/migrations/);
    expect(source).not.toMatch(/process\.argv|--directory|https?:|readdir\s*\([^)]*process\.cwd/i);
    expect(source).not.toMatch(/console\.(?:error|log)\s*\([^)]*(?:stack|cause|message|DATABASE_URL)/i);
  });
});
