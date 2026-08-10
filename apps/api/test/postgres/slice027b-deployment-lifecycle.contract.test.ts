// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(
  new URL("../../db/migrations/", import.meta.url),
);
const migration010Path = fileURLToPath(
  new URL("../../db/migrations/010_deployment_lifecycle.sql", import.meta.url),
);

async function migration010(): Promise<string> {
  return readFile(migration010Path, "utf8").catch(() => "");
}

async function optionalRunner(): Promise<Record<string, any>> {
  const path = pathToFileURL(fileURLToPath(
    new URL("../../src/migration-runner.ts", import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

describe("Slice 027B migration 010 deployment lifecycle schema", () => {
  it("ships one exact transactional version-10 migration without changing 001 through 009", async () => {
    const names = (await readdir(migrationsDirectory))
      .filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort();
    expect(names).toEqual([
      "001_initial.sql",
      "002_one_active_submission.sql",
      "003_run_discovery.sql",
      "004_preflight_report.sql",
      "005_explicit_submission_authority.sql",
      "006_wallet_identity_sessions.sql",
      "007_account_token_management.sql",
      "008_persisted_admission_quotas.sql",
      "009_canonical_url_attack_recordings.sql",
      "010_deployment_lifecycle.sql",
    ]);
    const sql = await migration010();
    expect(sql.startsWith("BEGIN;\n")).toBe(true);
    expect(sql.endsWith("\nCOMMIT;\n")).toBe(true);
    expect(sql).toMatch(
      /INSERT INTO proofline_private\.schema_migrations\s*\(version\)[\s\S]*VALUES\s*\(10\)[\s\S]*ON CONFLICT/i,
    );
  });

  it("creates the exact one-to-one bounded migration checksum ledger", async () => {
    const sql = await migration010();
    expect(sql).toMatch(
      /CREATE TABLE(?: IF NOT EXISTS)? proofline_private\.migration_checksums/i,
    );
    expect(sql).toMatch(
      /version\s+integer\s+PRIMARY KEY\s+REFERENCES\s+proofline_private\.schema_migrations\s*\(version\)\s+ON DELETE RESTRICT/i,
    );
    expect(sql).toMatch(/filename\s+text\s+NOT NULL\s+UNIQUE/i);
    expect(sql).toMatch(/filename\s*~\s*'\^\[0-9\]\{3\}_[a-z0-9_]+/i);
    expect(sql).toMatch(/sha256\s+bytea\s+NOT NULL/i);
    expect(sql).toMatch(/octet_length\s*\(sha256\)\s*=\s*32/i);
  });

  it("makes both version and checksum ledgers immutable after insert", async () => {
    const sql = await migration010();
    for (const table of ["schema_migrations", "migration_checksums"]) {
      expect(sql).toMatch(new RegExp(
        `BEFORE UPDATE OR DELETE ON proofline_private\\.${table}`,
        "i",
      ));
      expect(sql).toMatch(new RegExp(
        `BEFORE TRUNCATE ON proofline_private\\.${table}`,
        "i",
      ));
    }
    expect(sql).not.toMatch(/DROP TABLE|ALTER TABLE[^;]+DROP|ON DELETE CASCADE/i);
  });

  it("creates the exact DB-clock deployment worker heartbeat shape and indexes", async () => {
    const sql = await migration010();
    expect(sql).toMatch(
      /CREATE TABLE(?: IF NOT EXISTS)? proofline_private\.deployment_worker_heartbeats/i,
    );
    expect(sql).toMatch(/deployment_id\s+text\s+NOT NULL[\s\S]*\^deployment_\[a-f0-9\]\{64\}\$/i);
    expect(sql).toMatch(/worker_instance_id\s+uuid\s+NOT NULL/i);
    expect(sql).toMatch(/release_tree_sha\s+text\s+NOT NULL[\s\S]*\^\[a-f0-9\]\{40\}\$/i);
    expect(sql).toMatch(/PRIMARY KEY\s*\(deployment_id\s*,\s*worker_instance_id\)/i);
    for (const column of ["started_at", "last_heartbeat_at"]) {
      expect(sql).toMatch(new RegExp(`${column}\\s+timestamptz\\s+NOT NULL`, "i"));
      expect(sql).toMatch(new RegExp(
        `${column}\\s*=\\s*date_trunc\\(\\s*'milliseconds'\\s*,\\s*${column}\\s*\\)`,
        "i",
      ));
    }
    expect(sql).toMatch(/last_heartbeat_at\s*>=\s*started_at/i);
    expect(sql).toMatch(/stopped_at\s+IS NULL[\s\S]*stopped_at\s*>=\s*last_heartbeat_at/i);
    expect(sql).toMatch(
      /\(deployment_id\s*,\s*release_tree_sha\s*,\s*last_heartbeat_at\s+DESC\)[\s\S]*WHERE\s+stopped_at\s+IS NULL/i,
    );
    expect(sql).toMatch(
      /\(last_heartbeat_at\s*,\s*deployment_id\s*,\s*worker_instance_id\)/i,
    );
  });

  it("grants exact read/write authority and keeps PUBLIC plus importer away from heartbeat mutation", async () => {
    const sql = await migration010();
    expect(sql).toMatch(/REVOKE ALL[^;]+migration_checksums[^;]+FROM PUBLIC/i);
    expect(sql).toMatch(/REVOKE ALL[^;]+deployment_worker_heartbeats[^;]+FROM PUBLIC/i);
    for (const role of ["proofline_api", "proofline_worker", "proofline_recording_importer"]) {
      expect(sql).toMatch(new RegExp(
        `GRANT SELECT[^;]+(?:schema_migrations|migration_checksums)[^;]+TO[^;]+${role}`,
        "i",
      ));
    }
    expect(sql).toMatch(/GRANT SELECT[^;]+deployment_worker_heartbeats[^;]+TO proofline_api/i);
    expect(sql).toMatch(/GRANT SELECT\s*,\s*INSERT\s*,\s*DELETE[^;]+deployment_worker_heartbeats[^;]+TO proofline_worker/i);
    expect(sql).toMatch(/GRANT UPDATE\s*\(\s*last_heartbeat_at\s*,\s*stopped_at\s*\)[^;]+TO proofline_worker/i);
    expect(sql).not.toMatch(/deployment_worker_heartbeats[^;]+proofline_recording_importer/i);
  });

  it("stores no credential, URL, command lease, backup or restore authority", async () => {
    const sql = await migration010();
    expect(sql).not.toMatch(/password|database_url|private.?key|verifier|run_commands|lease_token|WAL|MinIO|S3|Spaces|backup|restore/i);
  });
});

describe.runIf(enabled)("Slice 027B real PostgreSQL migration/heartbeat authority", () => {
  let container: StartedTestContainer;
  let admin: pg.Pool;
  let migrator: pg.Pool;
  let runner: Record<string, any>;
  let roleDirectory: string | undefined;

  beforeAll(async () => {
    container = await new GenericContainer(
      "postgres@sha256:747d5ed1fdeeb124b880fbe3d7c6557d2c4064ae41d6b6297d417882effce4be",
    )
      .withEnvironment({
        POSTGRES_PASSWORD: "proofline-027b-admin",
        POSTGRES_USER: "proofline",
        POSTGRES_DB: "proofline",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    admin = new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: "proofline",
      password: "proofline-027b-admin",
      database: "proofline",
    });
    const roleModulePath = pathToFileURL(fileURLToPath(
      new URL("../../src/db-role-bootstrap.ts", import.meta.url),
    )).href;
    const roleModule = await import(/* @vite-ignore */ `${roleModulePath}?pg=${Date.now()}`)
      .catch(() => ({} as Record<string, any>));
    expect(roleModule.bootstrapProductionDatabaseRoles).toBeTypeOf("function");
    roleDirectory = await mkdtemp(join(tmpdir(), "proofline-027b-real-roles-"));
    const roleUrls = {
      DATABASE_URL_FILE: "postgres://proofline:proofline-027b-admin@postgres:5432/proofline",
      PROOFLINE_MIGRATOR_DATABASE_URL_FILE: "postgres://proofline_migrator_login:migrator-secret@postgres:5432/proofline",
      PROOFLINE_API_DATABASE_URL_FILE: "postgres://proofline_api_login:api-secret@postgres:5432/proofline",
      PROOFLINE_WORKER_DATABASE_URL_FILE: "postgres://proofline_worker_login:worker-secret@postgres:5432/proofline",
      PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: "postgres://proofline_recording_importer_login:importer-secret@postgres:5432/proofline",
    };
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(roleUrls)) {
      const path = join(roleDirectory, name.toLowerCase());
      await writeFile(path, value, { mode: 0o600 });
      environment[name] = path;
    }
    await roleModule.bootstrapProductionDatabaseRoles({
      environment,
      connect: async () => admin.connect(),
    });
    migrator = new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: "proofline_migrator_login",
      password: "migrator-secret",
      database: "proofline",
    });
    runner = await optionalRunner();
    expect(runner.runProductionMigrations).toBeTypeOf("function");
  }, 120_000);

  afterAll(async () => {
    await migrator?.end();
    await admin?.end();
    await container?.stop();
    if (roleDirectory) {
      await rm(roleDirectory, { recursive: true, force: true });
    }
  });

  it("applies fresh 001 through 010 atomically and verifies the exact immutable ledger", async () => {
    await expect(runner.runProductionMigrations({
      pool: migrator,
      migrationsDirectory,
    })).resolves.toMatchObject({ fromVersion: 0, toVersion: 10 });
    const history = await admin.query<{
      version: number;
      filename: string;
      digest: string;
    }>(`SELECT m.version, c.filename, encode(c.sha256, 'hex') AS digest
       FROM proofline_private.schema_migrations m
       JOIN proofline_private.migration_checksums c USING (version)
       ORDER BY m.version`);
    expect(history.rows).toHaveLength(10);
    expect(history.rows.map(({ version }) => version)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    const roles = await admin.query<{
      rolname: string;
      rolcreaterole: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolname, rolcreaterole, rolsuper, rolcreatedb, rolreplication, rolbypassrls
        FROM pg_roles
        WHERE rolname = ANY($1::text[])
        ORDER BY rolname`, [[
      "proofline_api_login",
      "proofline_migrator_login",
      "proofline_recording_importer_login",
      "proofline_worker_login",
    ]]);
    expect(roles.rows).toHaveLength(4);
    for (const role of roles.rows) {
      expect(role.rolcreaterole).toBe(role.rolname === "proofline_migrator_login");
      expect(role).toMatchObject({
        rolsuper: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false,
      });
    }
    const owner = await admin.query<{ owner: string }>(
      `SELECT pg_get_userbyid(nspowner) AS owner
       FROM pg_namespace WHERE nspname = 'proofline_private'`,
    );
    expect(owner.rows).toEqual([{ owner: "proofline_migrator_login" }]);
    const memberships = await admin.query<{ group_name: string; login_name: string }>(
      `SELECT parent.rolname AS group_name, member.rolname AS login_name
       FROM pg_auth_members membership
       JOIN pg_roles parent ON parent.oid = membership.roleid
       JOIN pg_roles member ON member.oid = membership.member
       WHERE member.rolname = ANY($1::text[])
       ORDER BY parent.rolname, member.rolname`, [[
        "proofline_api_login",
        "proofline_worker_login",
        "proofline_recording_importer_login",
      ]],
    );
    expect(memberships.rows).toEqual([
      { group_name: "proofline_api", login_name: "proofline_api_login" },
      {
        group_name: "proofline_recording_importer",
        login_name: "proofline_recording_importer_login",
      },
      { group_name: "proofline_worker", login_name: "proofline_worker_login" },
    ]);
    await expect(admin.query(
      "UPDATE proofline_private.migration_checksums SET filename = filename WHERE version = 1",
    )).rejects.toThrow(/immutable|forbidden|update/i);
    await expect(admin.query(
      "DELETE FROM proofline_private.schema_migrations WHERE version = 1",
    )).rejects.toThrow(/immutable|forbidden|delete/i);
  });

  it("serializes two concurrent runners on a fresh schema and makes the waiter mutation-free", async () => {
    await admin.query("DROP SCHEMA proofline_private CASCADE");
    const [left, right] = await Promise.all([
      runner.runProductionMigrations({ pool: migrator, migrationsDirectory }),
      runner.runProductionMigrations({ pool: migrator, migrationsDirectory }),
    ]);
    expect([left, right]).toEqual([
      expect.objectContaining({ toVersion: 10 }),
      expect.objectContaining({ toVersion: 10 }),
    ]);
    const history = await admin.query("SELECT version FROM proofline_private.migration_checksums ORDER BY version");
    expect(history.rows).toHaveLength(10);
    expect(history.rows.map(({ version }) => version)).toEqual(
      [1,2,3,4,5,6,7,8,9,10],
    );
  });

  it("enforces heartbeat shape, least privilege and DB-clock stale/stopped semantics", async () => {
    const deploymentId = `deployment_${"a".repeat(64)}`;
    const tree = "b".repeat(40);
    const instance = "11111111-1111-4111-8111-111111111110";
    const connection = (user: string, password: string) => new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user,
      password,
      database: "proofline",
    });
    const worker = connection("proofline_worker_login", "worker-secret");
    const api = connection("proofline_api_login", "api-secret");
    const importer = connection(
      "proofline_recording_importer_login",
      "importer-secret",
    );
    try {
      await worker.query(
        `INSERT INTO proofline_private.deployment_worker_heartbeats
         (deployment_id, worker_instance_id, release_tree_sha, started_at, last_heartbeat_at)
         VALUES ($1, $2, $3, date_trunc('milliseconds', clock_timestamp()),
           date_trunc('milliseconds', clock_timestamp()))`,
        [deploymentId, instance, tree],
      );
      const current = await api.query(
        `SELECT last_heartbeat_at > clock_timestamp() - interval '30 seconds' AS current
         FROM proofline_private.deployment_worker_heartbeats
         WHERE deployment_id = $1 AND release_tree_sha = $2 AND stopped_at IS NULL`,
        [deploymentId, tree],
      );
      expect(current.rows).toEqual([{ current: true }]);
      await expect(api.query(
        `INSERT INTO proofline_private.deployment_worker_heartbeats
         (deployment_id, worker_instance_id, release_tree_sha, started_at, last_heartbeat_at)
         VALUES ($1, gen_random_uuid(), $2, now(), now())`,
        [deploymentId, tree],
      )).rejects.toThrow(/permission|denied/i);
      await expect(importer.query(
        "SELECT 1 FROM proofline_private.deployment_worker_heartbeats LIMIT 1",
      )).rejects.toThrow(/permission|denied/i);
      await expect(worker.query(
        `UPDATE proofline_private.deployment_worker_heartbeats
         SET release_tree_sha = $3
         WHERE deployment_id = $1 AND worker_instance_id = $2`,
        [deploymentId, instance, "c".repeat(40)],
      )).rejects.toThrow(/permission|denied/i);
      await worker.query(
        `UPDATE proofline_private.deployment_worker_heartbeats
         SET stopped_at = date_trunc('milliseconds', clock_timestamp())
         WHERE deployment_id = $1 AND worker_instance_id = $2`,
        [deploymentId, instance],
      );
      await expect(worker.query(
        `INSERT INTO proofline_private.deployment_worker_heartbeats
         (deployment_id, worker_instance_id, release_tree_sha, started_at, last_heartbeat_at)
         VALUES ('bad', gen_random_uuid(), $1, now(), now())`,
        [tree],
      )).rejects.toThrow(/check|deployment/i);
    } finally {
      await Promise.all([worker.end(), api.end(), importer.end()]);
    }
  });

  it("rejects legacy version-only 1 through 9 without adopting checksums", async () => {
    await admin.query("DROP SCHEMA proofline_private CASCADE");
    await admin.query(`CREATE SCHEMA proofline_private;
      CREATE TABLE proofline_private.schema_migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO proofline_private.schema_migrations(version)
      SELECT generate_series(1, 9);`);
    await expect(runner.runProductionMigrations({
      pool: admin,
      migrationsDirectory,
    })).rejects.toMatchObject({ code: "MIGRATION_HISTORY_UNVERIFIED" });
    const ledger = await admin.query<{ ledger: string | null }>(
      "SELECT to_regclass('proofline_private.migration_checksums')::text AS ledger",
    );
    expect(ledger.rows).toEqual([{ ledger: null }]);
  });
});
