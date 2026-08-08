// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountTokenCreatedV1Schema, AccountV1Schema } from "@proofline/contracts";
import { createProductionApi } from "../../src/bootstrap";
import { digestOpaqueToken } from "../../src/postgres";
import { createProductionProoflineService } from "../../src/production-service";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const DIGEST_KEY = "slice-023b2-digest-key";
const PROJECT_ID = "11111111-1111-4111-8111-111111111127";
const WALLET_ID = "22222222-2222-4222-8222-222222222127";
const ADDRESS = "0x1111111111111111111111111111111111111111";

type AccountService = {
  getAccount(input: { projectId: string }): Promise<unknown>;
  createAccountToken(input: {
    version: "1";
    projectId: string;
    idempotencyKey: string;
    kind: "cli" | "action";
    label: string;
    expiresInDays: number;
  }): Promise<unknown>;
  revokeAccountToken(input: { projectId: string; tokenId: string }): Promise<unknown>;
};

async function migrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(`${migrationsDirectory}/${name}`, "utf8"),
  })));
}

async function migration007() {
  return (await migrations()).find(({ name }) => /^007_/.test(name)) ?? null;
}

describe("Slice 023B2 migration 007 source contract", () => {
  it("ships one transactional idempotent version-7 migration", async () => {
    const migration = await migration007();
    expect(migration, "Slice 023B2 requires additive migration 007").not.toBeNull();
    const sql = migration?.sql ?? "";
    expect(sql).toMatch(/\bBEGIN\b/i);
    expect(sql).toMatch(/\bCOMMIT\b/i);
    expect(sql).toMatch(
      /INSERT INTO proofline_private\.schema_migrations\s*\(version\)[\s\S]*VALUES\s*\(7\)[\s\S]*ON CONFLICT/i,
    );
  });

  it("adds bounded issuance evidence and partial uniqueness only for CLI and Action rows", async () => {
    const sql = (await migration007())?.sql ?? "";
    for (const column of ["issuance_key_digest", "issuance_fingerprint"]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE proofline_private\\.api_tokens[\\s\\S]*ADD COLUMN IF NOT EXISTS ${column}\\s+bytea`, "i"),
      );
      expect(sql).toMatch(new RegExp(`octet_length\\s*\\(\\s*${column}\\s*\\)\\s*=\\s*32`, "i"));
    }
    expect(sql).toMatch(/kind\s+IN\s*\(\s*'cli'\s*,\s*'action'\s*\)[\s\S]+label\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/char_length\s*\(\s*label\s*\)[\s\S]+BETWEEN\s+1\s+AND\s+128/i);
    expect(sql).toMatch(/label\s*=\s*btrim\s*\(\s*label\s*\)/i);
    expect(sql).toMatch(/created_at\s*=\s*date_trunc\s*\(\s*'milliseconds'\s*,\s*created_at\s*\)/i);
    expect(sql).toMatch(/expires_at\s*=\s*date_trunc\s*\(\s*'milliseconds'\s*,\s*expires_at\s*\)/i);
    expect(sql).toMatch(/expires_at\s*>\s*created_at/i);
    expect(sql).toMatch(/expires_at\s*<=\s*created_at\s*\+\s*interval\s*'90 days'/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS[^;]+\(\s*project_id\s*,\s*issuance_key_digest\s*\)[^;]+WHERE[^;]+kind\s+IN\s*\(\s*'cli'\s*,\s*'action'\s*\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS[^;]+\(\s*wallet_identity_id\s*,\s*created_at\s+DESC\s*,\s*id\s+DESC\s*\)[^;]+WHERE[^;]+kind\s+IN/i);
  });

  it("tightens API-token grants without giving the worker account-token access", async () => {
    const sql = (await migration007())?.sql ?? "";
    expect(sql).toMatch(/REVOKE ALL[^;]+proofline_private\.api_tokens[^;]+FROM PUBLIC/i);
    expect(sql).toMatch(/REVOKE ALL[^;]+proofline_private\.api_tokens[^;]+FROM proofline_api/i);
    expect(sql).toMatch(/GRANT SELECT\s*,\s*INSERT[^;]+proofline_private\.api_tokens[^;]+TO proofline_api/i);
    expect(sql).toMatch(/GRANT UPDATE\s*\(\s*revoked_at\s*\)[^;]+proofline_private\.api_tokens[^;]+TO proofline_api/i);
    expect(sql).not.toMatch(/GRANT[^;]+proofline_private\.api_tokens[^;]+TO proofline_worker/i);
  });
});

describe.runIf(enabled)("Slice 023B2 real PostgreSQL account tokens", () => {
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

  async function seedIdentity(
    projectId = PROJECT_ID,
    walletId = WALLET_ID,
    address = ADDRESS,
  ) {
    await pool.query(
      "INSERT INTO proofline_private.projects (id, name) VALUES ($1, 'Wallet project')",
      [projectId],
    );
    await pool.query(
      `INSERT INTO proofline_private.wallet_identities
        (id, chain_id, address, default_project_id)
       VALUES ($1, 114, $2, $3)`,
      [walletId, Buffer.from(address.slice(2), "hex"), projectId],
    );
  }

  function accountService(): AccountService {
    return (createProductionProoflineService as unknown as (
      input: Record<string, unknown>,
    ) => AccountService)({
      pool,
      tokenDigestKey: DIGEST_KEY,
      publicWebOrigin: "https://proofline.example",
    });
  }

  it("upgrades migration 006 rows idempotently and preserves browser and legacy compatibility", async () => {
    await reset();
    await applyThrough(6);
    await seedIdentity();
    await pool.query(
      `INSERT INTO proofline_private.api_tokens
        (id, project_id, token_digest, scope, kind, expires_at, wallet_identity_id)
       VALUES
        ($1, $2, $3, 'project', 'browser', now() + interval '12 hours', $4),
        ($5, $2, $6, 'project', 'legacy', NULL, NULL)`,
      [
        "33333333-3333-4333-8333-333333333127",
        PROJECT_ID,
        Buffer.alloc(32, 3),
        WALLET_ID,
        "44444444-4444-4444-8444-444444444127",
        Buffer.alloc(32, 4),
      ],
    );
    const migration = await migration007();
    expect(migration).not.toBeNull();
    await pool.query(migration!.sql);
    await pool.query(migration!.sql);
    const version = await pool.query(
      "SELECT version FROM proofline_private.schema_migrations WHERE version = 7",
    );
    expect(version.rowCount).toBe(1);
    const rows = await pool.query(
      `SELECT kind, issuance_key_digest, issuance_fingerprint
       FROM proofline_private.api_tokens ORDER BY kind`,
    );
    expect(rows.rows).toEqual([
      { kind: "browser", issuance_key_digest: null, issuance_fingerprint: null },
      { kind: "legacy", issuance_key_digest: null, issuance_fingerprint: null },
    ]);
    const worker = await pool.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'proofline_worker'
         AND table_schema = 'proofline_private'
         AND table_name = 'api_tokens'`,
    );
    expect(worker.rows).toEqual([]);
  });

  it("issues a digest-only token that authenticates, expires and remains revoked", async () => {
    await reset();
    await applyThrough(7);
    await seedIdentity();
    const account = accountService();
    const created = AccountTokenCreatedV1Schema.parse(await account.createAccountToken({
      version: "1",
      projectId: PROJECT_ID,
      idempotencyKey: `token_issue_${"1".repeat(64)}`,
      kind: "cli",
      label: "Local CLI",
      expiresInDays: 30,
    }));
    expect(Date.parse(created.item.expiresAt) - Date.parse(created.item.createdAt)).toBe(30 * 86_400_000);
    const persisted = await pool.query(
      `SELECT token_digest, issuance_key_digest, issuance_fingerprint, created_at, expires_at
       FROM proofline_private.api_tokens WHERE kind = 'cli'`,
    );
    expect(persisted.rows).toHaveLength(1);
    expect(Buffer.from(persisted.rows[0].token_digest)).toEqual(
      Buffer.from(digestOpaqueToken(created.token, DIGEST_KEY)),
    );
    expect(JSON.stringify(persisted.rows)).not.toContain(created.token);
    expect(persisted.rows[0].created_at.toISOString()).toBe(created.item.createdAt);
    expect(persisted.rows[0].expires_at.toISOString()).toBe(created.item.expiresAt);

    const api = createProductionApi({
      environment: {
        PROOFLINE_TOKEN_DIGEST_KEY: DIGEST_KEY,
        PROOFLINE_WEB_ORIGIN: "https://proofline.example",
      },
      pool,
    }).api;
    const authenticated = await api.fetch(new Request("https://api.proofline.example/v1/runs" , {
      headers: { authorization: `Bearer ${created.token}` },
    }));
    expect(authenticated.status).toBe(200);
    await pool.query(
      `UPDATE proofline_private.api_tokens
       SET created_at = date_trunc('milliseconds', now()) - interval '2 days',
           expires_at = date_trunc('milliseconds', now()) - interval '1 day'
       WHERE kind = 'cli'`,
    );
    const expired = await api.fetch(new Request("https://api.proofline.example/v1/runs", {
      headers: { authorization: `Bearer ${created.token}` },
    }));
    expect(expired.status).toBe(401);
    await pool.query(
      `UPDATE proofline_private.api_tokens
       SET created_at = date_trunc('milliseconds', now()),
           expires_at = date_trunc('milliseconds', now()) + interval '1 day'
       WHERE kind = 'cli'`,
    );
    const concurrentRevocations = await Promise.all([
      account.revokeAccountToken({ projectId: PROJECT_ID, tokenId: created.item.tokenId }),
      account.revokeAccountToken({ projectId: PROJECT_ID, tokenId: created.item.tokenId }),
    ]);
    expect(concurrentRevocations).toHaveLength(2);
    const revokedAt = await pool.query("SELECT revoked_at FROM proofline_private.api_tokens WHERE kind = 'cli'");
    await account.revokeAccountToken({ projectId: PROJECT_ID, tokenId: created.item.tokenId });
    const revokedAgain = await pool.query("SELECT revoked_at FROM proofline_private.api_tokens WHERE kind = 'cli'");
    expect(revokedAgain.rows[0].revoked_at.toISOString()).toBe(revokedAt.rows[0].revoked_at.toISOString());
    const revoked = await api.fetch(new Request("https://api.proofline.example/v1/runs", {
      headers: { authorization: `Bearer ${created.token}` },
    }));
    expect(revoked.status).toBe(401);
  });

  it("revokes the exact current browser session once and treats retry as signed out", async () => {
    await reset();
    await applyThrough(7);
    await seedIdentity();
    const rawBrowser = `project_${"b".repeat(64)}`;
    const browserTokenId = "99999999-9999-4999-8999-999999999127";
    await pool.query(
      `INSERT INTO proofline_private.api_tokens
        (id, project_id, token_digest, scope, kind, created_at, expires_at, wallet_identity_id)
       SELECT $1, $2, $3, 'project', 'browser', issued_at,
         issued_at + interval '12 hours', $4
       FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS issued_at) clock`,
      [
        browserTokenId,
        PROJECT_ID,
        Buffer.from(digestOpaqueToken(rawBrowser, DIGEST_KEY)),
        WALLET_ID,
      ],
    );
    const api = createProductionApi({
      environment: {
        PROOFLINE_TOKEN_DIGEST_KEY: DIGEST_KEY,
        PROOFLINE_WEB_ORIGIN: "https://proofline.example",
      },
      pool,
    }).api;
    const account = await api.fetch(new Request("https://api.proofline.example/v1/account", {
      headers: {
        origin: "https://proofline.example",
        authorization: `Bearer ${rawBrowser}`,
      },
    }));
    expect(account.status).toBe(200);

    const revoke = await api.fetch(new Request(
      "https://api.proofline.example/v1/auth/wallet/sessions/current",
      {
        method: "DELETE",
        headers: {
          origin: "https://proofline.example",
          authorization: `Bearer ${rawBrowser}`,
        },
      },
    ));
    expect(revoke.status).toBe(204);
    expect(await revoke.text()).toBe("");
    expect(revoke.headers.get("cache-control")).toBe("no-store");
    expect(revoke.headers.get("referrer-policy")).toBe("no-referrer");
    expect(revoke.headers.get("access-control-allow-origin")).toBe("https://proofline.example");
    const persisted = await pool.query(
      "SELECT revoked_at FROM proofline_private.api_tokens WHERE id = $1",
      [browserTokenId],
    );
    expect(persisted.rows[0].revoked_at).not.toBeNull();
    expect(persisted.rows[0].revoked_at.toISOString()).toMatch(/\.\d{3}Z$/);

    const repeated = await api.fetch(new Request(
      "https://api.proofline.example/v1/auth/wallet/sessions/current",
      {
        method: "DELETE",
        headers: {
          origin: "https://proofline.example",
          authorization: `Bearer ${rawBrowser}`,
        },
      },
    ));
    expect(repeated.status).toBe(401);
  });

  it("makes concurrent issuance single-secret and preserves stable retry outcomes", async () => {
    await reset();
    await applyThrough(7);
    await seedIdentity();
    const account = accountService();
    const intent = {
      version: "1" as const,
      projectId: PROJECT_ID,
      idempotencyKey: `token_issue_${"2".repeat(64)}`,
      kind: "action" as const,
      label: "Release Action",
      expiresInDays: 90,
    };
    const attempts = await Promise.allSettled([
      account.createAccountToken(intent),
      account.createAccountToken(intent),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: "ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED" });
    await expect(account.createAccountToken(intent)).rejects.toMatchObject({
      code: "ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED",
    });
    await expect(account.createAccountToken({ ...intent, expiresInDays: 89 })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const rows = await pool.query("SELECT count(*)::integer AS count FROM proofline_private.api_tokens WHERE kind = 'action'");
    expect(rows.rows[0].count).toBe(1);
  });

  it("isolates projects and rejects invalid CLI or Action persistence", async () => {
    await reset();
    await applyThrough(7);
    await seedIdentity();
    const otherProject = "55555555-5555-4555-8555-555555555127";
    await seedIdentity(
      otherProject,
      "66666666-6666-4666-8666-666666666127",
      "0x2222222222222222222222222222222222222222",
    );
    const account = accountService();
    const created = AccountTokenCreatedV1Schema.parse(await account.createAccountToken({
      version: "1",
      projectId: PROJECT_ID,
      idempotencyKey: `token_issue_${"3".repeat(64)}`,
      kind: "cli",
      label: "Isolated CLI",
      expiresInDays: 1,
    }));
    await expect(account.revokeAccountToken({
      projectId: otherProject,
      tokenId: created.item.tokenId,
    })).rejects.toMatchObject({ status: 404, code: "ACCOUNT_TOKEN_NOT_FOUND" });
    const own = AccountV1Schema.parse(await account.getAccount({ projectId: PROJECT_ID }));
    const other = AccountV1Schema.parse(await account.getAccount({ projectId: otherProject }));
    expect(own.tokens).toHaveLength(1);
    expect(other.tokens).toEqual([]);

    await expect(pool.query(
      `INSERT INTO proofline_private.api_tokens
        (id, project_id, token_digest, scope, kind, label, created_at, expires_at,
         wallet_identity_id, issuance_key_digest, issuance_fingerprint)
       VALUES ($1, $2, $3, 'project', 'cli', NULL, date_trunc('milliseconds', now()),
         date_trunc('milliseconds', now()) + interval '1 day', $4, $5, $6)`,
      [
        "77777777-7777-4777-8777-777777777127",
        PROJECT_ID,
        Buffer.alloc(32, 7),
        WALLET_ID,
        Buffer.alloc(32, 8),
        Buffer.alloc(32, 9),
      ],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(
      `INSERT INTO proofline_private.api_tokens
        (id, project_id, token_digest, scope, kind, label, created_at, expires_at,
         wallet_identity_id, issuance_key_digest, issuance_fingerprint)
       VALUES ($1, $2, $3, 'project', 'action', 'Too long', date_trunc('milliseconds', now()),
         date_trunc('milliseconds', now()) + interval '91 days', $4, $5, $6)`,
      [
        "88888888-8888-4888-8888-888888888127",
        PROJECT_ID,
        Buffer.alloc(32, 10),
        WALLET_ID,
        Buffer.alloc(32, 11),
        Buffer.alloc(32, 12),
      ],
    )).rejects.toMatchObject({ code: "23514" });
  });
});
