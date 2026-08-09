// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../../src/production-service";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const PROJECT_A = "11111111-1111-4111-8111-111111111138";
const PROJECT_B = "22222222-2222-4222-8222-222222222238";

type QuotaPolicy = {
  walletChallengeAddressPerMinute: number;
  walletChallengeGlobalPerMinute: number;
  projectRunsPerUtcDay: number;
  projectActiveLiveRuns: number;
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

async function migration008() {
  return (await migrations()).find(({ name }) => /^008_/.test(name)) ?? null;
}

describe("Slice 023D1 migration 008 source contract", () => {
  it("ships one transactional idempotent version-8 migration", async () => {
    const migration = await migration008();
    expect(migration, "Slice 023D1 requires additive migration 008").not.toBeNull();
    const sql = migration?.sql ?? "";
    expect(sql).toMatch(/\bBEGIN\b/i);
    expect(sql).toMatch(/\bCOMMIT\b/i);
    expect(sql).toMatch(
      /INSERT INTO proofline_private\.schema_migrations\s*\(version\)[\s\S]*VALUES\s*\(8\)[\s\S]*ON CONFLICT/i,
    );
  });

  it("adds constrained persisted quota windows and an expiry cleanup index", async () => {
    const sql = (await migration008())?.sql ?? "";
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS proofline_private\.quota_windows/i);
    for (const column of [
      "quota_kind",
      "subject_digest",
      "window_start",
      "window_end",
      "limit_value",
      "used_count",
    ]) {
      expect(sql).toMatch(new RegExp(`quota_windows[\\s\\S]*\\b${column}\\b`, "i"));
    }
    for (const kind of [
      "wallet_challenge_address_minute",
      "wallet_challenge_global_minute",
      "project_run_day",
      "active_live",
    ]) {
      expect(sql).toContain(`'${kind}'`);
    }
    expect(sql).toMatch(/PRIMARY KEY\s*\(\s*quota_kind\s*,\s*subject_digest\s*,\s*window_start\s*\)/i);
    expect(sql).toMatch(/octet_length\s*\(\s*subject_digest\s*\)\s*=\s*32/i);
    expect(sql).toMatch(/limit_value\s*>\s*0/i);
    expect(sql).toMatch(/active_live[^;]+used_count\s*=\s*0|used_count\s*=\s*0[^;]+active_live/i);
    expect(sql).toMatch(/used_count\s+BETWEEN\s+1\s+AND\s+limit_value|used_count\s*>=\s*1[\s\S]+used_count\s*<=\s*limit_value/i);
    expect(sql).toMatch(/wallet_challenge_[^;]+interval\s*'1 minute'/i);
    expect(sql).toMatch(/project_run_day[^;]+interval\s*'1 day'/i);
    expect(sql).toMatch(/active_live[^;]+interval\s*'1 day'/i);
    expect(sql).toMatch(/date_trunc\s*\(\s*'minute'\s*,\s*window_start\s*\)/i);
    expect(sql).toMatch(/date_trunc\s*\(\s*'day'\s*,\s*window_start\s*,\s*'UTC'\s*\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS[^;]+quota_windows[^;]+window_end/i);
  });

  it("grants only the API the minimum quota and stale-challenge cleanup privileges", async () => {
    const sql = (await migration008())?.sql ?? "";
    expect(sql).toMatch(/REVOKE ALL[^;]+quota_windows[^;]+FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT SELECT\s*,\s*INSERT\s*,\s*DELETE[^;]+quota_windows[^;]+TO proofline_api/i);
    expect(sql).toMatch(/GRANT UPDATE\s*\(\s*used_count\s*\)[^;]+quota_windows[^;]+TO proofline_api/i);
    expect(sql).toMatch(/GRANT DELETE[^;]+wallet_challenges[^;]+TO proofline_api/i);
    expect(sql).not.toMatch(/GRANT[^;]+(?:quota_windows|wallet_challenges)[^;]+TO proofline_worker/i);
    expect(sql).not.toMatch(/GRANT UPDATE(?!\s*\(\s*used_count\s*\))[^;]+quota_windows/i);
  });
});

describe.runIf(enabled)("Slice 023D1 real PostgreSQL admission quotas", () => {
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
      max: 20,
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query("DROP SCHEMA IF EXISTS proofline_private CASCADE");
    const all = await migrations();
    expect(all.map(({ name }) => name)).toEqual([
      "001_initial.sql",
      "002_one_active_submission.sql",
      "003_run_discovery.sql",
      "004_preflight_report.sql",
      "005_explicit_submission_authority.sql",
      "006_wallet_identity_sessions.sql",
      "007_account_token_management.sql",
      expect.stringMatching(/^008_.+\.sql$/),
    ]);
    for (const migration of all) await pool.query(migration.sql);
  }, 120_000);

  function service(policy: QuotaPolicy, address = ADDRESS_A) {
    const factory = createProductionProoflineService as unknown as (input: {
      pool: pg.Pool;
      tokenDigestKey: string;
      publicWebOrigin: string;
      quotaPolicy: QuotaPolicy;
      walletAuthPorts: { recoverAddress(input: unknown): Promise<string> };
    }) => ReturnType<typeof createProductionProoflineService>;
    return factory({
      pool,
      tokenDigestKey: "slice-023d1-real-pg-key",
      publicWebOrigin: "https://proofline.example",
      quotaPolicy: policy,
      walletAuthPorts: { recoverAddress: vi.fn(async () => address) },
    });
  }

  const policy = (overrides: Partial<QuotaPolicy> = {}): QuotaPolicy => ({
    walletChallengeAddressPerMinute: 5,
    walletChallengeGlobalPerMinute: 300,
    projectRunsPerUtcDay: 100,
    projectActiveLiveRuns: 3,
    ...overrides,
  });

  async function project(id: string, name: string) {
    await pool.query(
      "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
      [id, name],
    );
  }

  it("reapplies 008, freezes the first window limit and gives the worker no quota authority", async () => {
    const migration = await migration008();
    expect(migration).not.toBeNull();
    await pool.query(migration!.sql);
    const version = await pool.query(
      "SELECT version FROM proofline_private.schema_migrations WHERE version = 8",
    );
    expect(version.rowCount).toBe(1);

    const first = service(policy({
      walletChallengeAddressPerMinute: 2,
      walletChallengeGlobalPerMinute: 10,
    }));
    await first.createWalletChallenge({ version: "1", address: ADDRESS_A });
    await first.createWalletChallenge({ version: "1", address: ADDRESS_A });

    const restartedWithLargerLimit = service(policy({
      walletChallengeAddressPerMinute: 3,
      walletChallengeGlobalPerMinute: 10,
    }));
    await expect(restartedWithLargerLimit.createWalletChallenge({
      version: "1",
      address: ADDRESS_A,
    })).rejects.toMatchObject({
      status: 429,
      code: "WALLET_CHALLENGE_RATE_LIMITED",
      retryAfterSeconds: expect.any(Number),
    });
    const addressWindow = await pool.query<{ limit_value: number; used_count: number }>(
      `SELECT limit_value, used_count
       FROM proofline_private.quota_windows
       WHERE quota_kind = 'wallet_challenge_address_minute'`,
    );
    expect(addressWindow.rows).toEqual([{ limit_value: 2, used_count: 2 }]);
    const worker = await pool.query(
      `SELECT privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = 'proofline_worker'
         AND table_schema = 'proofline_private'
         AND table_name IN ('quota_windows', 'wallet_challenges')`,
    );
    expect(worker.rows).toEqual([]);
  });

  it("admits exact concurrent address/global winners across restarted services on the database clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
      const quotaPolicy = policy({
        walletChallengeAddressPerMinute: 2,
        walletChallengeGlobalPerMinute: 3,
      });
      const services = Array.from({ length: 8 }, (_, index) =>
        service(quotaPolicy, index % 2 === 0 ? ADDRESS_A : ADDRESS_B)
      );
      const attempts = await Promise.allSettled(services.map((item, index) =>
        item.createWalletChallenge({
          version: "1",
          address: index % 2 === 0 ? ADDRESS_A : ADDRESS_B,
        })
      ));
      expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(3);
      for (const rejected of attempts.filter(
        (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
      )) {
        expect(rejected.reason).toMatchObject({
          status: 429,
          code: "WALLET_CHALLENGE_RATE_LIMITED",
        });
        expect(rejected.reason.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(rejected.reason.retryAfterSeconds).toBeLessThanOrEqual(60);
      }
      const windows = await pool.query(
        `SELECT quota_kind, sum(used_count)::integer AS used
         FROM proofline_private.quota_windows
         GROUP BY quota_kind
         ORDER BY quota_kind`,
      );
      expect(windows.rows).toEqual(expect.arrayContaining([
        { quota_kind: "wallet_challenge_address_minute", used: 3 },
        { quota_kind: "wallet_challenge_global_minute", used: 3 },
      ]));
      const persistedClock = await pool.query<{ future_windows: number }>(
        `SELECT count(*)::integer AS future_windows
         FROM proofline_private.quota_windows
         WHERE window_start > clock_timestamp() + interval '1 minute'`,
      );
      expect(persistedClock.rows[0]?.future_windows).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays before quota, counts every new mode daily and excludes replay only from active-live admission", async () => {
    await project(PROJECT_A, "Quota project A");
    const production = service(policy({
      projectRunsPerUtcDay: 2,
      projectActiveLiveRuns: 1,
    }));
    const wallet = await production.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "wallet-one",
      manifest: validManifest,
    });
    await expect(production.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "wallet-one",
      manifest: structuredClone(validManifest),
    })).resolves.toEqual(wallet);
    const replayManifest = {
      ...validManifest,
      submission: { ...validManifest.submission, mode: "replay" as const },
    };
    await expect(production.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "replay-two",
      manifest: replayManifest,
    })).resolves.toMatchObject({ status: "accepted" });
    await expect(production.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "daily-three",
      manifest: replayManifest,
    })).rejects.toMatchObject({
      status: 429,
      code: "PROJECT_RUN_QUOTA_EXHAUSTED",
      retryAfterSeconds: expect.any(Number),
    });
    const evidence = await pool.query(
      `SELECT
        (SELECT used_count FROM proofline_private.quota_windows
          WHERE quota_kind = 'project_run_day') AS used,
        (SELECT count(*)::integer FROM proofline_private.runs) AS runs,
        (SELECT count(*)::integer FROM proofline_private.run_events) AS events,
        (SELECT count(*)::integer FROM proofline_private.run_commands) AS commands`,
    );
    expect(evidence.rows[0]).toEqual({ used: 2, runs: 2, events: 2, commands: 2 });
  });

  it("serializes active live admission per project, releases a terminal slot and isolates projects", async () => {
    await project(PROJECT_A, "Active project A");
    await project(PROJECT_B, "Active project B");
    const quotaPolicy = policy({
      projectRunsPerUtcDay: 10,
      projectActiveLiveRuns: 1,
    });
    const firstService = service(quotaPolicy);
    const secondService = service({ ...quotaPolicy, projectActiveLiveRuns: 2 });
    await expect(firstService.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "live-a1",
      manifest: validManifest,
    })).resolves.toMatchObject({ status: "accepted" });
    await expect(secondService.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "live-a2",
      manifest: { ...validManifest, submission: { ...validManifest.submission, mode: "relayer" as const } },
    })).rejects.toMatchObject({ status: 409, code: "ACTIVE_LIVE_RUN_LIMIT_REACHED" });
    const frozenActivePolicy = await pool.query(
      `SELECT limit_value, used_count
       FROM proofline_private.quota_windows
       WHERE quota_kind = 'active_live' AND subject_digest IS NOT NULL`,
    );
    expect(frozenActivePolicy.rows).toEqual([{ limit_value: 1, used_count: 0 }]);

    const concurrentOtherProject = await Promise.allSettled([
      firstService.createRun({ projectId: PROJECT_B, idempotencyKey: "live-b1", manifest: validManifest }),
      service(quotaPolicy).createRun({
        projectId: PROJECT_B,
        idempotencyKey: "live-b2",
        manifest: { ...validManifest, submission: { ...validManifest.submission, mode: "relayer" as const } },
      }),
    ]);
    expect(concurrentOtherProject.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(concurrentOtherProject.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect((concurrentOtherProject.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ status: 409, code: "ACTIVE_LIVE_RUN_LIMIT_REACHED" });

    await pool.query(
      `UPDATE proofline_private.runs
       SET projection = jsonb_set(projection, '{terminal}', 'true'::jsonb)
       WHERE project_id = $1`,
      [PROJECT_A],
    );
    await expect(secondService.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "live-a3",
      manifest: { ...validManifest, submission: { ...validManifest.submission, mode: "relayer" as const } },
    })).resolves.toMatchObject({ status: "accepted" });
  });

  it("cleans only stale bounded windows/challenges and preserves durable product evidence", async () => {
    await project(PROJECT_A, "Cleanup preservation");
    const production = service(policy());
    await production.createRun({
      projectId: PROJECT_A,
      idempotencyKey: "cleanup-run",
      manifest: validManifest,
    });
    await pool.query(
      `UPDATE proofline_private.quota_windows
       SET window_start = window_start - interval '2 days',
           window_end = window_end - interval '2 days'`,
    );
    await production.createWalletChallenge({ version: "1", address: ADDRESS_A });
    await pool.query(
      `UPDATE proofline_private.wallet_challenges
       SET issued_at = issued_at - interval '2 days',
           expires_at = expires_at - interval '2 days'`,
    );
    await production.createWalletChallenge({ version: "1", address: ADDRESS_B });

    const remaining = await pool.query(
      `SELECT
        (SELECT count(*)::integer FROM proofline_private.quota_windows
          WHERE window_end < now() - interval '24 hours') AS stale_windows,
        (SELECT count(*)::integer FROM proofline_private.wallet_challenges
          WHERE expires_at < now() - interval '24 hours') AS stale_challenges,
        (SELECT count(*)::integer FROM proofline_private.runs) AS runs,
        (SELECT count(*)::integer FROM proofline_private.run_events) AS events,
        (SELECT count(*)::integer FROM proofline_private.run_commands) AS commands`,
    );
    expect(remaining.rows[0]).toEqual({
      stale_windows: 0,
      stale_challenges: 0,
      runs: 1,
      events: 1,
      commands: 1,
    });
  });
});
