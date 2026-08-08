// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GenericContainer, Wait } from "testcontainers";
import { describe, expect, it } from "vitest";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(
  new URL("../../db/migrations/", import.meta.url),
);
const previousSchemaPath = fileURLToPath(
  new URL("./fixtures/000_previous.sql", import.meta.url),
);

async function loadMigrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  expect(names).toEqual([
    "001_initial.sql",
    "002_one_active_submission.sql",
    "003_run_discovery.sql",
    "004_preflight_report.sql",
    "005_explicit_submission_authority.sql",
    expect.stringMatching(/^006_.+\.sql$/),
    "007_account_token_management.sql",
  ]);
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(`${migrationsDirectory}/${name}`, "utf8"),
    })),
  );
}

describe.runIf(enabled)("PostgreSQL migration against a real container", () => {
  it(
    "runs 001 through 007 on empty and previous schemas repeatedly",
    async () => {
      const container = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({
          POSTGRES_PASSWORD: "proofline",
          POSTGRES_USER: "proofline",
          POSTGRES_DB: "proofline",
        })
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            /database system is ready to accept connections/,
            2,
          ),
        )
        .start();

      const client = new pg.Client({
        host: container.getHost(),
        port: container.getMappedPort(5432),
        user: "proofline",
        password: "proofline",
        database: "proofline",
      });

      try {
        await client.connect();
        const migrations = await loadMigrations();
        const executed: string[] = [];
        const applyAll = async () => {
          for (const migration of migrations) {
            await client.query(migration.sql);
            executed.push(migration.name);
          }
        };

        await applyAll();
        await applyAll();
        const migrationNames = migrations.map(({ name }) => name);
        expect(executed).toEqual([...migrationNames, ...migrationNames]);

        const emptyVersions = await client.query<{ version: number }>(
          "SELECT version FROM proofline_private.schema_migrations ORDER BY version",
        );
        expect(emptyVersions.rows.map(({ version }) => version)).toEqual([
          1, 2, 3, 4, 5, 6, 7,
        ]);

        const tables = await client.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'proofline_private'",
        );
        expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
          expect.arrayContaining(["runs", "run_events", "run_commands"]),
        );
        const relayerUpdateGrants = await client.query<{
          column_name: string;
          privilege_type: string;
        }>(
          `SELECT column_name, privilege_type
           FROM information_schema.role_column_grants
           WHERE grantee = 'proofline_worker'
             AND table_schema = 'proofline_private'
             AND table_name = 'relayer_transactions'
             AND privilege_type = 'UPDATE'
           ORDER BY column_name`,
        );
        expect(relayerUpdateGrants.rows).toEqual([
          { column_name: "broadcast_at", privilege_type: "UPDATE" },
          { column_name: "broadcast_attempted_at", privilege_type: "UPDATE" },
        ]);

        const projectId = "11111111-1111-4111-8111-111111111111";
        const runId = "22222222-2222-4222-8222-222222222222";
        await client.query(
          "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
          [projectId, "Contract fixture"],
        );
        await client.query(
          `INSERT INTO proofline_private.runs
            (id, project_id, idempotency_key, request_fingerprint, manifest, projection, last_sequence)
           VALUES ($1, $2, $3, decode($4, 'hex'), $5::jsonb, $6::jsonb, 1)`,
          [
            runId,
            projectId,
            "create-fixture",
            "aa".repeat(32),
            JSON.stringify({ version: "1" }),
            JSON.stringify({ version: "1", runId, sequence: 1 }),
          ],
        );
        await client.query(
          `INSERT INTO proofline_private.run_events
            (run_id, sequence, dedupe_key, event_type, event_payload, occurred_at)
           VALUES ($1, 1, 'create-fixture', 'RUN_CREATED', $2::jsonb, now())`,
          [runId, JSON.stringify({ version: "1", type: "RUN_CREATED" })],
        );
        await expect(
          client.query(
            "UPDATE proofline_private.run_events SET sequence = sequence WHERE run_id = $1",
            [runId],
          ),
        ).rejects.toThrow(/append|immutable|update/i);
        await expect(
          client.query(
            "DELETE FROM proofline_private.run_events WHERE run_id = $1",
            [runId],
          ),
        ).rejects.toThrow(/append|immutable|delete/i);

        await client.query(
          `INSERT INTO proofline_private.run_artifacts
             (id, run_id, kind, canonical_bytes, sha256, metadata)
           VALUES ($1, $2, 'preflight-report-v1', $3, decode($4, 'hex'), '{}'::jsonb)`,
          [
            "33333333-3333-4333-8333-333333333333",
            runId,
            Buffer.from('{"version":"1"}', "utf8"),
            "bb".repeat(32),
          ],
        );
        await expect(
          client.query(
            `INSERT INTO proofline_private.run_artifacts
               (id, run_id, kind, canonical_bytes, sha256, metadata)
             VALUES ($1, $2, 'preflight-report-v1', $3, decode($4, 'hex'), '{}'::jsonb)`,
            [
              "44444444-4444-4444-8444-444444444444",
              runId,
              Buffer.from('{"version":"1","verdict":"ready"}', "utf8"),
              "cc".repeat(32),
            ],
          ),
        ).rejects.toThrow(/duplicate|unique|preflight/i);

        await client.query("DROP SCHEMA proofline_private CASCADE");
        await client.query(await readFile(previousSchemaPath, "utf8"));
        executed.length = 0;
        await applyAll();
        await applyAll();
        expect(executed).toEqual([...migrationNames, ...migrationNames]);

        const previousVersions = await client.query<{ version: number }>(
          "SELECT version FROM proofline_private.schema_migrations ORDER BY version",
        );
        expect(previousVersions.rows.map(({ version }) => version)).toEqual([
          0, 1, 2, 3, 4, 5, 6, 7,
        ]);
        const upgradedTables = await client.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'proofline_private'",
        );
        expect(upgradedTables.rows.map(({ table_name }) => table_name)).toEqual(
          expect.arrayContaining([
            "projects",
            "runs",
            "run_events",
            "run_artifacts",
            "run_commands",
            "relayer_transactions",
            "share_tokens",
            "wallet_identities",
            "wallet_challenges",
          ]),
        );
        const discoveryIndex = await client.query<{ indexname: string }>(
          `SELECT indexname
           FROM pg_indexes
           WHERE schemaname = 'proofline_private'
             AND indexname = 'runs_project_id_updated_at_id_idx'`,
        );
        expect(discoveryIndex.rows).toEqual([
          { indexname: "runs_project_id_updated_at_id_idx" },
        ]);
      } finally {
        await client.end();
        await container.stop();
      }
    },
    120_000,
  );
});
