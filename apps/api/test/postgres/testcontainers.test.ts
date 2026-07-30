// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GenericContainer, Wait } from "testcontainers";
import { describe, expect, it } from "vitest";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationPath = fileURLToPath(
  new URL("../../db/migrations/001_initial.sql", import.meta.url),
);
const previousSchemaPath = fileURLToPath(
  new URL("./fixtures/000_previous.sql", import.meta.url),
);

describe.runIf(enabled)("PostgreSQL migration against a real container", () => {
  it(
    "migrates empty and previous schemas idempotently and enforces append-only events",
    async () => {
      const container = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({
          POSTGRES_PASSWORD: "proofline",
          POSTGRES_USER: "proofline",
          POSTGRES_DB: "proofline",
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
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
        const migration = await readFile(migrationPath, "utf8");
        await client.query(migration);
        await client.query(migration);

        const tables = await client.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'proofline_private'",
        );
        expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
          expect.arrayContaining(["runs", "run_events", "run_commands"]),
        );

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

        await client.query("DROP SCHEMA proofline_private CASCADE");
        await client.query(await readFile(previousSchemaPath, "utf8"));
        await client.query(migration);
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
          ]),
        );
      } finally {
        await client.end();
        await container.stop();
      }
    },
    120_000,
  );
});
