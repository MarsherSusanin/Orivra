// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RECORDING_BYTES,
  RECORDING_SHA256,
} from "../../../../packages/contracts/test/slice024b-canonical-url-attack-demo.fixtures";
import { makeCanonicalUrlAttackRecording } from "../../../../packages/contracts/test/slice024a-canonical-url-attack.fixtures";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

async function migrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(`${migrationsDirectory}/${name}`, "utf8"),
  })));
}

async function migration009() {
  return (await migrations()).find(({ name }) => name === "009_canonical_url_attack_recordings.sql") ?? null;
}

describe("Slice 024B migration 009 source contract", () => {
  it("ships one additive transactional idempotent version-9 migration", async () => {
    const migration = await migration009();
    expect(migration, "Slice 024B requires migration 009").not.toBeNull();
    const sql = migration?.sql ?? "";
    expect(sql).toMatch(/\bBEGIN\b[\s\S]*\bCOMMIT\b/i);
    expect(sql).toMatch(/schema_migrations[\s\S]*VALUES\s*\(9\)[\s\S]*ON CONFLICT/i);
  });

  it("creates the exact immutable bounded canonical recording table", async () => {
    const sql = (await migration009())?.sql ?? "";
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS proofline_private\.canonical_url_attack_recordings/i);
    for (const column of [
      "recording_sha256", "recording_checksum", "authority_recording_checksum",
      "canonical_bytes", "canonical_utf8_bytes", "recorded_at",
      "release_commit_sha", "release_tree_sha", "attack_run_id", "control_run_id",
      "runtime_authority", "runtime_verified_at", "imported_at",
    ]) expect(sql).toMatch(new RegExp(`canonical_url_attack_recordings[\\s\\S]*\\b${column}\\b`, "i"));
    expect(sql).toMatch(/PRIMARY KEY\s*\(\s*recording_sha256\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*recording_checksum\s*\)/i);
    expect(sql).toMatch(/authority_recording_checksum\s*=\s*recording_checksum/i);
  });

  it("enforces exact digest, canonical byte, release, run and authority constraints", async () => {
    const sql = (await migration009())?.sql ?? "";
    expect(sql).toMatch(/octet_length\s*\(\s*recording_sha256\s*\)\s*=\s*32/i);
    expect(sql).toMatch(/octet_length\s*\(\s*recording_checksum\s*\)\s*=\s*32/i);
    expect(sql).toMatch(/canonical_utf8_bytes\s+BETWEEN\s+1\s+AND\s+6291456/i);
    expect(sql).toMatch(/canonical_utf8_bytes\s*=\s*octet_length\s*\(\s*canonical_bytes\s*\)/i);
    expect(sql).toMatch(/release_commit_sha[^;]+\^\[a-f0-9\]\{40\}\$/i);
    expect(sql).toMatch(/release_tree_sha[^;]+\^\[a-f0-9\]\{40\}\$/i);
    expect(sql).toMatch(/recorded_at\s*=\s*date_trunc\s*\(\s*'milliseconds'\s*,\s*recorded_at\s*\)/i);
    expect(sql).toMatch(/attack_run_id[^;]+\^\[A-Za-z0-9\][^;]+\{0,127\}/i);
    expect(sql).toMatch(/control_run_id[^;]+\^\[A-Za-z0-9\][^;]+\{0,127\}/i);
    expect(sql).toMatch(/attack_run_id\s*<>\s*control_run_id/i);
    expect(sql).toContain("'fdc-coston2-runtime-v1'");
  });

  it("denies UPDATE, DELETE and TRUNCATE with append-only triggers", async () => {
    const sql = (await migration009())?.sql ?? "";
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE[\s\S]+canonical_url_attack_recordings/i);
    expect(sql).toMatch(/BEFORE TRUNCATE[\s\S]+canonical_url_attack_recordings/i);
    expect(sql).toMatch(/append-only|immutable/i);
  });

  it("grants importer SELECT/INSERT, API SELECT, worker nothing and revokes PUBLIC", async () => {
    const sql = (await migration009())?.sql ?? "";
    expect(sql).toMatch(/CREATE ROLE proofline_recording_importer NOLOGIN/i);
    expect(sql).toMatch(/REVOKE ALL[^;]+canonical_url_attack_recordings[^;]+FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT SELECT\s*,\s*INSERT[^;]+canonical_url_attack_recordings[^;]+TO proofline_recording_importer/i);
    expect(sql).toMatch(/GRANT SELECT[^;]+canonical_url_attack_recordings[^;]+TO proofline_api/i);
    expect(sql).not.toMatch(/GRANT[^;]+canonical_url_attack_recordings[^;]+TO proofline_worker/i);
    expect(sql).not.toMatch(/GRANT[^;]+(?:UPDATE|DELETE|TRUNCATE)[^;]+canonical_url_attack_recordings/i);
  });
});

describe.runIf(enabled)("Slice 024B real PostgreSQL immutable recording import", () => {
  let container: StartedTestContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_PASSWORD: "proofline", POSTGRES_USER: "proofline", POSTGRES_DB: "proofline" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new pg.Pool({
      host: container.getHost(), port: container.getMappedPort(5432),
      user: "proofline", password: "proofline", database: "proofline", max: 4,
    });
    for (const migration of await migrations()) await pool.query(migration.sql);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  function values(bytes = Buffer.from(RECORDING_BYTES)) {
    const recording = makeCanonicalUrlAttackRecording();
    return [
      Buffer.from(RECORDING_SHA256.slice(7), "hex"),
      Buffer.from(recording.checksum.slice(7), "hex"),
      bytes,
      bytes.byteLength,
      recording.recordedAt,
      recording.release.commitSha,
      recording.release.treeSha,
      recording.bundles.attack.runId,
      recording.bundles.control.runId,
    ];
  }

  const insert = `INSERT INTO proofline_private.canonical_url_attack_recordings
    (recording_sha256, recording_checksum, authority_recording_checksum,
     canonical_bytes, canonical_utf8_bytes, recorded_at, release_commit_sha,
     release_tree_sha, attack_run_id, control_run_id, runtime_authority,
     runtime_verified_at)
    VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9,
            'fdc-coston2-runtime-v1', now())`;

  it("records migration 009 and accepts one exact valid row", async () => {
    await pool.query((await migration009())!.sql);
    const version = await pool.query("SELECT version FROM proofline_private.schema_migrations WHERE version = 9");
    expect(version.rowCount).toBe(1);
    await pool.query(insert, values());
    const row = await pool.query("SELECT canonical_bytes FROM proofline_private.canonical_url_attack_recordings");
    expect(Buffer.from(row.rows[0].canonical_bytes)).toEqual(Buffer.from(RECORDING_BYTES));
  });

  it("rejects changed bytes under the same digest and checksum identity", async () => {
    await expect(pool.query(insert, values(Buffer.from("{}")))).rejects.toThrow(/duplicate|constraint|canonical/i);
  });

  it.each(["UPDATE", "DELETE", "TRUNCATE"])("rejects %s after import", async (operation) => {
    const sql = operation === "UPDATE"
      ? "UPDATE proofline_private.canonical_url_attack_recordings SET imported_at = imported_at"
      : operation === "DELETE"
        ? "DELETE FROM proofline_private.canonical_url_attack_recordings"
        : "TRUNCATE proofline_private.canonical_url_attack_recordings";
    await expect(pool.query(sql)).rejects.toThrow(/append|immutable|forbidden/i);
  });

  it("enforces least privilege for importer, API, worker and PUBLIC", async () => {
    const grants = await pool.query(`SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'proofline_private'
        AND table_name = 'canonical_url_attack_recordings'
      ORDER BY grantee, privilege_type`);
    expect(grants.rows).toEqual(expect.arrayContaining([
      { grantee: "proofline_api", privilege_type: "SELECT" },
      { grantee: "proofline_recording_importer", privilege_type: "INSERT" },
      { grantee: "proofline_recording_importer", privilege_type: "SELECT" },
    ]));
    expect(grants.rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ grantee: "proofline_worker" }),
      expect.objectContaining({ grantee: "PUBLIC" }),
    ]));
  });

  it("serializes concurrent import transactions under the exact fixed advisory lock", async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    const lock = "SELECT pg_advisory_xact_lock(hashtextextended('proofline:canonical-url-attack-recording-import:v1', 0))";
    try {
      await first.query("BEGIN");
      await first.query(lock);
      await second.query("BEGIN");
      let acquired = false;
      const waiting = second.query(lock).then(() => { acquired = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(acquired).toBe(false);
      await first.query("COMMIT");
      await waiting;
      expect(acquired).toBe(true);
      await second.query("ROLLBACK");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      first.release();
      second.release();
    }
  });
});
