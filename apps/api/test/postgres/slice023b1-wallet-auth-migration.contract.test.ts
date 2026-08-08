// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WalletChallengeV1Schema, WalletSessionV1Schema } from "@proofline/contracts";
import { createProductionApi } from "../../src/bootstrap";
import { digestOpaqueToken } from "../../src/postgres";
import { createProductionProoflineService } from "../../src/production-service";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const SIGNATURE = `0x${"11".repeat(65)}`;
const DIGEST_KEY = "slice-023b1-digest-key";

async function migrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(`${migrationsDirectory}/${name}`, "utf8"),
  })));
}

async function migration006() {
  return (await migrations()).find(({ name }) => /^006_/.test(name)) ?? null;
}

describe("Slice 023B1 migration 006 source contract", () => {
  it("ships one transactional idempotent version-6 migration", async () => {
    const migration = await migration006();
    expect(migration, "Slice 023B1 requires additive migration 006").not.toBeNull();
    const sql = migration?.sql ?? "";
    expect(sql).toMatch(/\bBEGIN\b/i);
    expect(sql).toMatch(/\bCOMMIT\b/i);
    expect(sql).toMatch(
      /INSERT INTO proofline_private\.schema_migrations\s*\(version\)[\s\S]*VALUES\s*\(6\)[\s\S]*ON CONFLICT/i,
    );
  });

  it("adds durable wallet identity, challenge and browser-token metadata without breaking legacy tokens", async () => {
    const sql = (await migration006())?.sql ?? "";
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS proofline_private\.wallet_identities/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS proofline_private\.wallet_challenges/i);
    for (const column of ["chain_id", "address", "default_project_id", "created_at"]) {
      expect(sql).toMatch(new RegExp(`wallet_identities[\\s\\S]*\\b${column}\\b`, "i"));
    }
    expect(sql).toMatch(/UNIQUE\s*\(\s*chain_id\s*,\s*address\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*default_project_id\s*\)/i);
    expect(sql).toMatch(/chain_id[^;]+CHECK\s*\([^)]*chain_id\s*=\s*114/i);
    expect(sql).toMatch(/address[^;]+octet_length\s*\(\s*address\s*\)\s*=\s*20/i);

    for (const column of [
      "id",
      "address",
      "nonce",
      "message",
      "issued_at",
      "expires_at",
      "consumed_at",
    ]) {
      expect(sql).toMatch(new RegExp(`wallet_challenges[\\s\\S]*\\b${column}\\b`, "i"));
    }
    expect(sql).toMatch(/nonce[^;]+octet_length\s*\(\s*nonce\s*\)\s*=\s*32/i);
    expect(sql).toMatch(/id[^;]+challenge_\[a-f0-9\][^;]*64/i);
    expect(sql).toMatch(/message[^;]+octet_length\s*\(\s*message\s*\)[^;]+8192/i);
    expect(sql).toMatch(/expires_at\s*=\s*issued_at\s*\+\s*interval\s*'5 minutes'/i);
    for (const column of ["issued_at", "expires_at"]) {
      expect(sql).toMatch(
        new RegExp(`${column}\\s*=\\s*date_trunc\\s*\\(\\s*'milliseconds'\\s*,\\s*${column}\\s*\\)`, "i"),
      );
    }
    expect(sql).toMatch(/consumed_at\s+IS\s+NULL\s+OR\s+consumed_at\s*>=\s*issued_at/i);
    expect(sql).toMatch(/CREATE INDEX[^;]+wallet_challenges[^;]+expires_at/i);

    for (const column of ["kind", "label", "expires_at", "wallet_identity_id"]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE proofline_private\\.api_tokens[\\s\\S]*ADD COLUMN IF NOT EXISTS ${column}`, "i"));
    }
    expect(sql).toMatch(/kind[^;]+DEFAULT\s+'legacy'/i);
    for (const kind of ["legacy", "browser", "cli", "action"]) {
      expect(sql).toMatch(new RegExp(`['\"]${kind}['\"]`, "i"));
    }
    expect(sql).toMatch(/kind\s*<>\s*'browser'|kind\s*=\s*'browser'[\s\S]+expires_at\s+IS\s+NOT\s+NULL/i);
  });

  it("grants only the API role the minimum new-table privileges", async () => {
    const sql = (await migration006())?.sql ?? "";
    expect(sql).toMatch(/REVOKE ALL[^;]+wallet_identities[^;]+FROM PUBLIC/i);
    expect(sql).toMatch(/REVOKE ALL[^;]+wallet_challenges[^;]+FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT SELECT\s*,\s*INSERT[^;]+wallet_identities[^;]+TO proofline_api/i);
    expect(sql).toMatch(/GRANT SELECT\s*,\s*INSERT[^;]+wallet_challenges[^;]+TO proofline_api/i);
    expect(sql).toMatch(/GRANT UPDATE\s*\(\s*consumed_at\s*\)[^;]+wallet_challenges[^;]+TO proofline_api/i);
    expect(sql).not.toMatch(/GRANT[^;]+wallet_(?:identities|challenges)[^;]+TO proofline_worker/i);
  });
});

describe.runIf(enabled)("Slice 023B1 real PostgreSQL wallet sessions", () => {
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

  async function databaseClock() {
    const clock = await pool.query<{ at: Date }>(
      "SELECT date_trunc('milliseconds', clock_timestamp()) AS at",
    );
    return clock.rows[0]!.at.getTime();
  }

  function service(
    recoveredAddress = ADDRESS,
    recoverAddress = vi.fn(async () => recoveredAddress),
  ) {
    const factory = createProductionProoflineService as unknown as (
      input: Record<string, unknown>,
    ) => {
      createWalletChallenge(input: unknown): Promise<unknown>;
      createWalletSession(input: unknown): Promise<unknown>;
    };
    return factory({
      pool,
      tokenDigestKey: DIGEST_KEY,
      publicWebOrigin: "https://proofline.example",
      walletAuthPorts: {
        recoverAddress,
      },
    });
  }

  it("upgrades legacy rows idempotently and keeps worker access out", async () => {
    await reset();
    await applyThrough(5);
    const projectId = "11111111-1111-4111-8111-111111111126";
    await pool.query("INSERT INTO proofline_private.projects (id, name) VALUES ($1, 'Legacy')", [projectId]);
    await pool.query(
      `INSERT INTO proofline_private.api_tokens
        (id, project_id, token_digest, scope)
       VALUES ($1, $2, $3, 'project')`,
      ["22222222-2222-4222-8222-222222222126", projectId, Buffer.alloc(32, 6)],
    );
    const migration = await migration006();
    expect(migration).not.toBeNull();
    await pool.query(migration!.sql);
    await pool.query(migration!.sql);

    const version = await pool.query(
      "SELECT version FROM proofline_private.schema_migrations WHERE version = 6",
    );
    expect(version.rowCount).toBe(1);
    const legacy = await pool.query(
      "SELECT kind, label, expires_at, wallet_identity_id FROM proofline_private.api_tokens",
    );
    expect(legacy.rows).toEqual([{
      kind: "legacy",
      label: null,
      expires_at: null,
      wallet_identity_id: null,
    }]);
    const workerGrants = await pool.query(
      `SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'proofline_worker'
         AND table_schema = 'proofline_private'
         AND table_name IN ('wallet_identities', 'wallet_challenges')`,
    );
    expect(workerGrants.rows).toEqual([]);
  });

  it("allows only one concurrent session and stores one identity, project and digest-only token", async () => {
    await reset();
    await applyThrough(6);
    const auth = service();
    const challenge = WalletChallengeV1Schema.parse(await auth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }));
    const attempts = await Promise.allSettled([
      auth.createWalletSession({ version: "1", challengeId: challenge.challengeId, signature: SIGNATURE }),
      auth.createWalletSession({ version: "1", challengeId: challenge.challengeId, signature: SIGNATURE }),
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "CHALLENGE_UNAVAILABLE",
    });
    const session = WalletSessionV1Schema.parse(
      (fulfilled[0] as PromiseFulfilledResult<unknown>).value,
    );

    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::integer FROM proofline_private.wallet_identities) AS identities,
        (SELECT count(*)::integer FROM proofline_private.projects) AS projects,
        (SELECT count(*)::integer FROM proofline_private.api_tokens WHERE kind = 'browser') AS tokens`,
    );
    expect(counts.rows[0]).toEqual({ identities: 1, projects: 1, tokens: 1 });
    const token = await pool.query(
      `SELECT token_digest, expires_at, revoked_at
       FROM proofline_private.api_tokens WHERE kind = 'browser'`,
    );
    expect(Buffer.from(token.rows[0].token_digest)).toEqual(
      Buffer.from(digestOpaqueToken(session.projectToken, DIGEST_KEY)),
    );
    expect(JSON.stringify(token.rows)).not.toContain(session.projectToken);

    const activeApi = createProductionApi({
      environment: {
        PROOFLINE_TOKEN_DIGEST_KEY: DIGEST_KEY,
        PROOFLINE_WEB_ORIGIN: "https://proofline.example",
      },
      pool,
    }).api;
    const authenticated = await activeApi.fetch(new Request(
      `https://api.proofline.example/v1/runs/${crypto.randomUUID()}`,
      { headers: { authorization: `Bearer ${session.projectToken}` } },
    ));
    expect(authenticated.status).toBe(404);
    await pool.query(
      "UPDATE proofline_private.api_tokens SET expires_at = now() - interval '1 second' WHERE kind = 'browser'",
    );
    const expired = await activeApi.fetch(new Request(
      `https://api.proofline.example/v1/runs/${crypto.randomUUID()}`,
      { headers: { authorization: `Bearer ${session.projectToken}` } },
    ));
    expect(expired.status).toBe(401);
    await pool.query(
      `UPDATE proofline_private.api_tokens
       SET expires_at = now() + interval '1 hour', revoked_at = now()
       WHERE kind = 'browser'`,
    );
    const revoked = await activeApi.fetch(new Request(
      `https://api.proofline.example/v1/runs/${crypto.randomUUID()}`,
      { headers: { authorization: `Bearer ${session.projectToken}` } },
    ));
    expect(revoked.status).toBe(401);

    const legacyRaw = `project_${"e".repeat(64)}`;
    await pool.query(
      `INSERT INTO proofline_private.api_tokens
        (id, project_id, token_digest, scope)
       VALUES ($1, $2, $3, 'project')`,
      [
        "33333333-3333-4333-8333-333333333126",
        session.project.projectId,
        Buffer.from(digestOpaqueToken(legacyRaw, DIGEST_KEY)),
      ],
    );
    const legacy = await activeApi.fetch(new Request(
      `https://api.proofline.example/v1/runs/${crypto.randomUUID()}`,
      { headers: { authorization: `Bearer ${legacyRaw}` } },
    ));
    expect(legacy.status).toBe(404);
  });

  it("commits consumption even when local EOA recovery rejects the signature", async () => {
    await reset();
    await applyThrough(6);
    const invalidAuth = service(OTHER_ADDRESS);
    const challenge = WalletChallengeV1Schema.parse(await invalidAuth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }));
    await expect(invalidAuth.createWalletSession({
      version: "1",
      challengeId: challenge.challengeId,
      signature: SIGNATURE,
    })).rejects.toMatchObject({ code: "WALLET_SIGNATURE_INVALID" });
    await expect(service().createWalletSession({
      version: "1",
      challengeId: challenge.challengeId,
      signature: SIGNATURE,
    })).rejects.toMatchObject({ code: "CHALLENGE_UNAVAILABLE" });
    const persisted = await pool.query(
      "SELECT consumed_at FROM proofline_private.wallet_challenges WHERE id = $1",
      [challenge.challengeId],
    );
    expect(persisted.rows[0].consumed_at).not.toBeNull();
  });

  it("keeps challenge, concurrent session and invalid-signature flows on the database clock", async () => {
    await reset();
    await applyThrough(6);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
      const validAuth = service();
      const challengeWindowStart = await databaseClock();
      const challenge = WalletChallengeV1Schema.parse(await validAuth.createWalletChallenge({
        version: "1",
        address: ADDRESS,
      }));
      const challengeWindowEnd = await databaseClock();
      expect(Date.parse(challenge.issuedAt)).toBeGreaterThanOrEqual(challengeWindowStart);
      expect(Date.parse(challenge.issuedAt)).toBeLessThanOrEqual(challengeWindowEnd);
      expect(Date.parse(challenge.expiresAt) - Date.parse(challenge.issuedAt)).toBe(5 * 60_000);

      const sessionWindowStart = await databaseClock();
      const concurrent = await Promise.allSettled([
        validAuth.createWalletSession({
          version: "1",
          challengeId: challenge.challengeId,
          signature: SIGNATURE,
        }),
        validAuth.createWalletSession({
          version: "1",
          challengeId: challenge.challengeId,
          signature: SIGNATURE,
        }),
      ]);
      const sessionWindowEnd = await databaseClock();
      const fulfilled = concurrent.filter((attempt) => attempt.status === "fulfilled");
      const rejected = concurrent.filter((attempt) => attempt.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "CHALLENGE_UNAVAILABLE",
      });
      const session = WalletSessionV1Schema.parse(
        (fulfilled[0] as PromiseFulfilledResult<unknown>).value,
      );
      expect(Date.parse(session.issuedAt)).toBeGreaterThanOrEqual(sessionWindowStart);
      expect(Date.parse(session.issuedAt)).toBeLessThanOrEqual(sessionWindowEnd);
      expect(Date.parse(session.expiresAt) - Date.parse(session.issuedAt)).toBe(12 * 60 * 60_000);
      const persistedToken = await pool.query<{ created_at: Date; expires_at: Date }>(
        `SELECT created_at, expires_at
         FROM proofline_private.api_tokens
         WHERE kind = 'browser'`,
      );
      expect(persistedToken.rows).toHaveLength(1);
      expect(persistedToken.rows[0]!.created_at.toISOString()).toBe(session.issuedAt);
      expect(persistedToken.rows[0]!.expires_at.toISOString()).toBe(session.expiresAt);

      vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
      const invalidAuth = service(OTHER_ADDRESS);
      const invalidWindowStart = await databaseClock();
      const invalidChallenge = WalletChallengeV1Schema.parse(await invalidAuth.createWalletChallenge({
        version: "1",
        address: ADDRESS,
      }));
      const invalidWindowEnd = await databaseClock();
      expect(Date.parse(invalidChallenge.issuedAt)).toBeGreaterThanOrEqual(invalidWindowStart);
      expect(Date.parse(invalidChallenge.issuedAt)).toBeLessThanOrEqual(invalidWindowEnd);
      expect(Date.parse(invalidChallenge.expiresAt) - Date.parse(invalidChallenge.issuedAt)).toBe(5 * 60_000);
      await expect(invalidAuth.createWalletSession({
        version: "1",
        challengeId: invalidChallenge.challengeId,
        signature: SIGNATURE,
      })).rejects.toMatchObject({ code: "WALLET_SIGNATURE_INVALID" });
      await expect(invalidAuth.createWalletSession({
        version: "1",
        challengeId: invalidChallenge.challengeId,
        signature: SIGNATURE,
      })).rejects.toMatchObject({ code: "CHALLENGE_UNAVAILABLE" });
      const consumed = await pool.query<{ consumed_at: Date | null }>(
        "SELECT consumed_at FROM proofline_private.wallet_challenges WHERE id = $1",
        [invalidChallenge.challengeId],
      );
      expect(consumed.rows[0]!.consumed_at).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects sub-millisecond evidence at storage and again at atomic consumption", async () => {
    await reset();
    await applyThrough(6);

    await expect(pool.query(
      `INSERT INTO proofline_private.wallet_challenges
        (id, address, nonce, message, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
      [
        `challenge_${"c".repeat(64)}`,
        Buffer.from(ADDRESS.slice(2), "hex"),
        Buffer.alloc(32, 3),
        "sub-millisecond storage probe",
        "2026-08-09T00:00:00.000001Z",
        "2026-08-09T00:05:00.000001Z",
      ],
    )).rejects.toMatchObject({ code: "23514" });

    const precisionConstraints = await pool.query<{ ddl: string }>(
      `SELECT format(
         'ALTER TABLE proofline_private.wallet_challenges DROP CONSTRAINT %I',
         conname
       ) AS ddl
       FROM pg_constraint
       WHERE conrelid = 'proofline_private.wallet_challenges'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%date_trunc%'`,
    );
    expect(precisionConstraints.rowCount).toBeGreaterThan(0);
    for (const { ddl } of precisionConstraints.rows) await pool.query(ddl);

    const recoverAddress = vi.fn(async () => ADDRESS);
    const auth = service(ADDRESS, recoverAddress);
    const corrupted = WalletChallengeV1Schema.parse(await auth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }));
    const shifted = await pool.query(
      `UPDATE proofline_private.wallet_challenges
       SET issued_at = issued_at + interval '1 microsecond',
           expires_at = expires_at + interval '1 microsecond'
       WHERE id = $1`,
      [corrupted.challengeId],
    );
    expect(shifted.rowCount).toBe(1);

    const attemptCorrupted = () => auth.createWalletSession({
      version: "1",
      challengeId: corrupted.challengeId,
      signature: SIGNATURE,
    });
    await expect(attemptCorrupted()).rejects.toMatchObject({
      status: 409,
      code: "CHALLENGE_UNAVAILABLE",
    });
    await expect(attemptCorrupted()).rejects.toMatchObject({
      status: 409,
      code: "CHALLENGE_UNAVAILABLE",
    });
    expect(recoverAddress).not.toHaveBeenCalled();
    const rejectedCounts = await pool.query(
      `SELECT
        (SELECT count(*)::integer FROM proofline_private.wallet_identities) AS identities,
        (SELECT count(*)::integer FROM proofline_private.projects) AS projects,
        (SELECT count(*)::integer FROM proofline_private.api_tokens WHERE kind = 'browser') AS tokens,
        (SELECT consumed_at IS NULL FROM proofline_private.wallet_challenges WHERE id = $1) AS available`,
      [corrupted.challengeId],
    );
    expect(rejectedCounts.rows[0]).toEqual({
      identities: 0,
      projects: 0,
      tokens: 0,
      available: true,
    });

    const canonical = WalletChallengeV1Schema.parse(await auth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }));
    WalletSessionV1Schema.parse(await auth.createWalletSession({
      version: "1",
      challengeId: canonical.challengeId,
      signature: SIGNATURE,
    }));
    expect(recoverAddress).toHaveBeenCalledOnce();
  });
});
