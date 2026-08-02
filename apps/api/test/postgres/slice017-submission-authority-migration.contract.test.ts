// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validManifest } from "../../../../packages/contracts/test/fixtures";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const PROJECT_ID = "11111111-1111-4111-8111-111111111117";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa017";

async function migrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^00[1-5]_.+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(`${migrationsDirectory}/${name}`, "utf8"),
  })));
}

async function migration005() {
  return (await migrations()).find(({ name }) => /^005_/.test(name)) ?? null;
}

describe("Slice 017 migration 005 source contract", () => {
  it("ships one transactional idempotent version-5 migration", async () => {
    const migration = await migration005();
    expect(migration, "Slice 017 requires additive migration 005").not.toBeNull();
    const sql = migration?.sql ?? "";
    expect(sql).toMatch(/\bBEGIN\b/i);
    expect(sql).toMatch(/\bCOMMIT\b/i);
    expect(sql).toMatch(/DROP INDEX IF EXISTS|CREATE UNIQUE INDEX IF NOT EXISTS/i);
    expect(sql).toMatch(
      /INSERT INTO proofline_private\.schema_migrations\s*\(version\)[\s\S]*VALUES\s*\(5\)[\s\S]*ON CONFLICT/i,
    );
  });

  it("extends one active run authority to wallet, relayer and replay and fails on legacy conflicts", async () => {
    const migration = await migration005();
    const normalized = (migration?.sql ?? "").replace(/\s+/g, " ");
    for (const kind of [
      "ATTACH_WALLET_TRANSACTION",
      "SUBMIT_RELAYER",
      "APPLY_REPLAY_EVIDENCE",
    ]) {
      expect(normalized).toContain(`'${kind}'`);
    }
    expect(normalized).toMatch(/CREATE UNIQUE INDEX[^;]+run_commands[^;]+\(\s*run_id\s*\)/i);
    expect(normalized).toMatch(/status\s*<>\s*'cancelled'/i);
    expect(normalized).toMatch(/RAISE EXCEPTION[^;]+submission/i);
    expect(normalized).toMatch(/GROUP BY\s+run_id[^;]+HAVING[^;]+COUNT/i);
  });
});

describe.runIf(enabled)("Slice 017 real PostgreSQL migration 005", () => {
  let container: StartedTestContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_PASSWORD: "proofline",
        POSTGRES_USER: "proofline",
        POSTGRES_DB: "proofline",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: "proofline",
      password: "proofline",
      database: "proofline",
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function reset() {
    await pool.query("DROP SCHEMA IF EXISTS proofline_private CASCADE");
  }

  async function applyThrough(version: number) {
    for (const migration of await migrations()) {
      if (Number(migration.name.slice(0, 3)) <= version) await pool.query(migration.sql);
    }
  }

  async function seedRun() {
    await pool.query(
      "INSERT INTO proofline_private.projects (id, name) VALUES ($1, 'Slice 017')",
      [PROJECT_ID],
    );
    await pool.query(
      `INSERT INTO proofline_private.runs
        (id, project_id, idempotency_key, request_fingerprint, manifest, projection)
       VALUES ($1, $2, 'slice017-run', $3, $4::jsonb, '{}'::jsonb)`,
      [RUN_ID, PROJECT_ID, Buffer.alloc(32, 17), JSON.stringify(validManifest)],
    );
  }

  async function insertCommand(id: string, key: string, kind: string, status = "queued") {
    return pool.query(
      `INSERT INTO proofline_private.run_commands
        (id, project_id, run_id, idempotency_key, kind, payload, status)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6)`,
      [id, PROJECT_ID, RUN_ID, key, kind, status],
    );
  }

  it("applies the complete 001→005 chain to an empty database", async () => {
    await reset();
    await applyThrough(5);
    const version = await pool.query(
      "SELECT version FROM proofline_private.schema_migrations WHERE version = 5",
    );
    expect(version.rowCount).toBe(1);
  });

  it("upgrades the previous schema and remains idempotent", async () => {
    await reset();
    await applyThrough(4);
    const migration = await migration005();
    expect(migration).not.toBeNull();
    await pool.query(migration!.sql);
    await pool.query(migration!.sql);
    const indexes = await pool.query(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'proofline_private' AND tablename = 'run_commands'`,
    );
    expect(indexes.rows.map((row) => row.indexdef).join("\n")).toContain(
      "APPLY_REPLAY_EVIDENCE",
    );
  });

  it("allows exactly one active authority including replay while cancelled history remains allowed", async () => {
    await reset();
    await applyThrough(5);
    await seedRun();
    await insertCommand(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb017",
      "cancelled-wallet",
      "ATTACH_WALLET_TRANSACTION",
      "cancelled",
    );
    await insertCommand(
      "cccccccc-cccc-4ccc-8ccc-cccccccccc17",
      "active-replay",
      "APPLY_REPLAY_EVIDENCE",
    );
    await expect(insertCommand(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd17",
      "active-relayer",
      "SUBMIT_RELAYER",
    )).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses previous-schema rows that already selected replay and another authority", async () => {
    await reset();
    await applyThrough(4);
    await seedRun();
    await insertCommand(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee17",
      "legacy-replay",
      "APPLY_REPLAY_EVIDENCE",
    );
    await insertCommand(
      "ffffffff-ffff-4fff-8fff-ffffffffff17",
      "legacy-relayer",
      "SUBMIT_RELAYER",
    );
    const migration = await migration005();
    await expect(pool.query(migration!.sql)).rejects.toThrow(/submission/i);
  });
});
