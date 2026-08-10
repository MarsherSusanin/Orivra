// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";

describe.runIf(enabled)("Slice 027C real PostgreSQL backup authority", () => {
  let container: StartedTestContainer;
  let admin: pg.Pool;
  let directory: string;

  beforeAll(async () => {
    container = await new GenericContainer(
      "postgres@sha256:747d5ed1fdeeb124b880fbe3d7c6557d2c4064ae41d6b6297d417882effce4be",
    )
      .withEnvironment({
        POSTGRES_PASSWORD: "proofline-027c-admin",
        POSTGRES_USER: "proofline",
        POSTGRES_DB: "proofline",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(
        /database system is ready to accept connections/,
        2,
      ))
      .start();
    admin = new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: "proofline",
      password: "proofline-027c-admin",
      database: "proofline",
    });
    directory = await mkdtemp(join(tmpdir(), "proofline-027c-real-backup-role-"));
    const inputs = {
      DATABASE_URL_FILE: "postgres://proofline:proofline-027c-admin@postgres:5432/proofline",
      PROOFLINE_MIGRATOR_DATABASE_URL_FILE: "postgres://proofline_migrator_login:migrator-secret@postgres:5432/proofline",
      PROOFLINE_API_DATABASE_URL_FILE: "postgres://proofline_api_login:api-secret@postgres:5432/proofline",
      PROOFLINE_WORKER_DATABASE_URL_FILE: "postgres://proofline_worker_login:worker-secret@postgres:5432/proofline",
      PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: "postgres://proofline_recording_importer_login:importer-secret@postgres:5432/proofline",
      PROOFLINE_BACKUP_DATABASE_URL_FILE: "postgres://proofline_backup_login:backup-secret@postgres:5432/proofline",
    };
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(inputs)) {
      const path = join(directory, name.toLowerCase());
      await writeFile(path, value, { mode: 0o600 });
      environment[name] = path;
    }
    const modulePath = pathToFileURL(fileURLToPath(
      new URL("../../src/db-role-bootstrap.ts", import.meta.url),
    )).href;
    const module = await import(/* @vite-ignore */ `${modulePath}?pg=${Date.now()}`)
      .catch(() => ({} as Record<string, any>));
    expect(module.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    await module.bootstrapProductionDatabaseRoles({
      environment,
      connect: async () => admin.connect(),
    });
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    await container?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("creates the exact non-superuser PostgreSQL 17 replication login", async () => {
    const role = await admin.query(`
      SELECT rolname, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
             rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = 'proofline_backup_login'
    `);
    expect(role.rows).toEqual([{
      rolname: "proofline_backup_login",
      rolinherit: true,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: true,
      rolbypassrls: false,
    }]);
  });

  it("grants monitoring and exact backup functions but no application authority", async () => {
    const privileges = await admin.query(`
      SELECT
        has_database_privilege('proofline_backup_login', 'proofline', 'CONNECT') AS can_connect,
        pg_has_role('proofline_backup_login', 'pg_monitor', 'MEMBER') AS monitors,
        has_function_privilege('proofline_backup_login', 'pg_catalog.pg_backup_start(text, boolean)', 'EXECUTE') AS starts,
        has_function_privilege('proofline_backup_login', 'pg_catalog.pg_backup_stop(boolean)', 'EXECUTE') AS stops,
        has_function_privilege('proofline_backup_login', 'pg_catalog.pg_switch_wal()', 'EXECUTE') AS switches
    `);
    expect(privileges.rows).toEqual([{
      can_connect: true,
      monitors: true,
      starts: true,
      stops: true,
      switches: true,
    }]);
    const memberships = await admin.query<{ group_name: string }>(`
      SELECT parent.rolname AS group_name
      FROM pg_auth_members membership
      JOIN pg_roles parent ON parent.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      WHERE member.rolname = 'proofline_backup_login'
        AND parent.rolname LIKE 'proofline_%'
    `);
    expect(memberships.rows).toEqual([]);
  });
});
