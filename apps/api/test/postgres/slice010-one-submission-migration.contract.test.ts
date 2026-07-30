// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validManifest } from "../../../../packages/contracts/test/fixtures";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(
  new URL("../../db/migrations/", import.meta.url),
);
const initialMigrationPath = fileURLToPath(
  new URL("../../db/migrations/001_initial.sql", import.meta.url),
);
const PROJECT_ID = "11111111-1111-4111-8111-111111111010";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010";

async function findSliceMigration() {
  const files = (await readdir(migrationsDirectory)).sort();
  const name = files.find((candidate) => /^002_.+\.sql$/.test(candidate));
  return name
    ? { name, sql: await readFile(`${migrationsDirectory}/${name}`, "utf8") }
    : null;
}

async function sliceMigration() {
  const migration = await findSliceMigration();
  expect(
    migration,
    "Slice 010 RED: an additive 002 migration must own the cross-kind invariant",
  ).not.toBeNull();
  return migration!;
}

async function insertProjectAndRun(pool: pg.Pool, id = RUN_ID) {
  await pool.query(
    "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
    [PROJECT_ID, "Slice 010 one submission"],
  );
  await pool.query(
    `INSERT INTO proofline_private.runs
      (id, project_id, idempotency_key, request_fingerprint, manifest, projection)
     VALUES ($1, $2, 'slice010-run', $3, $4::jsonb, '{}'::jsonb)`,
    [id, PROJECT_ID, Buffer.alloc(32, 10), JSON.stringify(validManifest)],
  );
}

function insertCommand(
  pool: pg.Pool,
  input: {
    id: string;
    key: string;
    kind: "SUBMIT_RELAYER" | "ATTACH_WALLET_TRANSACTION";
    status?: "queued" | "cancelled";
  },
) {
  return pool.query(
    `INSERT INTO proofline_private.run_commands
      (id, project_id, run_id, idempotency_key, kind, payload, status)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6)`,
    [
      input.id,
      PROJECT_ID,
      RUN_ID,
      input.key,
      input.kind,
      input.status ?? "queued",
    ],
  );
}

describe("Slice 010 submission migration source contract", () => {
  it("ships an additive migration with one run-level cross-kind partial unique index", async () => {
    const migration = await sliceMigration();
    const normalized = migration.sql.replace(/\s+/g, " ");

    expect(migration.name).toMatch(/^002_/);
    expect(normalized).toMatch(
      /CREATE UNIQUE INDEX[^;]+ON proofline_private\.run_commands\s*\(\s*run_id\s*\)[^;]+WHERE[^;]+kind\s+IN\s*\(\s*'SUBMIT_RELAYER'\s*,\s*'ATTACH_WALLET_TRANSACTION'\s*\)[^;]+status\s*<>\s*'cancelled'/i,
    );
  });

  it("fails closed on legacy dual-path rows before creating the unique index", async () => {
    const { sql } = await sliceMigration();
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toMatch(/RAISE EXCEPTION[^;]+submission/i);
    expect(normalized).toMatch(
      /GROUP BY\s+run_id[^;]+HAVING[^;]+COUNT\s*\(\s*(?:DISTINCT\s+)?kind\s*\)\s*>\s*1/i,
    );
  });
});

describe.runIf(enabled)("Slice 010 real PostgreSQL one-submission invariant", () => {
  let container: StartedTestContainer;
  let pool: pg.Pool;
  let initialMigration: string;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_PASSWORD: "proofline",
        POSTGRES_USER: "proofline",
        POSTGRES_DB: "proofline",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
      )
      .start();
    pool = new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: "proofline",
      password: "proofline",
      database: "proofline",
    });
    initialMigration = await readFile(initialMigrationPath, "utf8");
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function resetToPreviousSchema() {
    await pool.query("DROP SCHEMA IF EXISTS proofline_private CASCADE");
    await pool.query(initialMigration);
  }

  it("allows only one winner when wallet and relayer commands race", async () => {
    await resetToPreviousSchema();
    const migration = await findSliceMigration();
    if (migration) await pool.query(migration.sql);
    await insertProjectAndRun(pool);

    const settled = await Promise.allSettled([
      insertCommand(pool, {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb010",
        key: "slice010-relayer-race",
        kind: "SUBMIT_RELAYER",
      }),
      insertCommand(pool, {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccc10",
        key: "slice010-wallet-race",
        kind: "ATTACH_WALLET_TRANSACTION",
      }),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "23505" });
  });

  it("keeps cancelled history outside the one-active-submission boundary", async () => {
    await resetToPreviousSchema();
    const migration = await findSliceMigration();
    if (migration) await pool.query(migration.sql);
    await insertProjectAndRun(pool);

    await insertCommand(pool, {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd10",
      key: "slice010-cancelled-relayer",
      kind: "SUBMIT_RELAYER",
      status: "cancelled",
    });
    await expect(
      insertCommand(pool, {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10",
        key: "slice010-active-wallet",
        kind: "ATTACH_WALLET_TRANSACTION",
      }),
    ).resolves.toBeDefined();
  });

  it("refuses to migrate legacy data that already selected both authorities", async () => {
    await resetToPreviousSchema();
    await insertProjectAndRun(pool);
    await insertCommand(pool, {
      id: "ffffffff-ffff-4fff-8fff-ffffffffff10",
      key: "slice010-legacy-relayer",
      kind: "SUBMIT_RELAYER",
    });
    await insertCommand(pool, {
      id: "99999999-9999-4999-8999-999999999910",
      key: "slice010-legacy-wallet",
      kind: "ATTACH_WALLET_TRANSACTION",
    });

    const migration = await findSliceMigration();
    await expect(
      pool.query(migration?.sql ?? initialMigration),
    ).rejects.toThrow(/submission/i);
    const stillLegacy = await pool.query(
      `SELECT kind FROM proofline_private.run_commands
       WHERE run_id = $1 ORDER BY kind`,
      [RUN_ID],
    );
    expect(stillLegacy.rows.map((row) => row.kind)).toEqual([
      "ATTACH_WALLET_TRANSACTION",
      "SUBMIT_RELAYER",
    ]);
  });
});
