// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import * as bootstrapModule from "../src/bootstrap";
import { createProductionProoflineService } from "../src/production-service";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111130";
const DB_NOW = new Date("2026-08-09T12:34:56.789Z");
const MINUTE_START = new Date("2026-08-09T12:34:00.000Z");
const MINUTE_END = new Date("2026-08-09T12:35:00.000Z");

type QuotaPolicy = {
  walletChallengeAddressPerMinute: number;
  walletChallengeGlobalPerMinute: number;
  projectRunsPerUtcDay: number;
  projectActiveLiveRuns: number;
};

const DEFAULT_POLICY: QuotaPolicy = {
  walletChallengeAddressPerMinute: 5,
  walletChallengeGlobalPerMinute: 300,
  projectRunsPerUtcDay: 100,
  projectActiveLiveRuns: 3,
};

function result(rows: Array<Record<string, unknown>> = []) {
  return { rowCount: rows.length, rows };
}

function service(pool: unknown, quotaPolicy: QuotaPolicy = DEFAULT_POLICY) {
  const factory = createProductionProoflineService as unknown as (input: {
    pool: unknown;
    tokenDigestKey: string;
    publicWebOrigin: string;
    quotaPolicy: QuotaPolicy;
    walletAuthPorts: { recoverAddress(input: unknown): Promise<string> };
  }) => ReturnType<typeof createProductionProoflineService>;
  return factory({
    pool,
    quotaPolicy,
    tokenDigestKey: "slice-023d1-digest-key",
    publicWebOrigin: "https://proofline.example",
    walletAuthPorts: { recoverAddress: vi.fn(async () => ADDRESS) },
  });
}

function boundedChallengePool(input: {
  max: number;
  cleanupFailure?: boolean;
}) {
  type Call = { owner: "client" | "pool" | "release"; text: string };
  const calls: Call[] = [];
  const waiters: Array<() => void> = [];
  let active = 0;
  let cleanupSettled = 0;

  const acquire = async () => {
    if (active < input.max) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1;
        resolve();
      });
    });
  };
  const release = () => {
    active -= 1;
    calls.push({ owner: "release", text: "RELEASE" });
    const next = waiters.shift();
    if (next) queueMicrotask(next);
  };
  const execute = async (
    owner: "client" | "pool",
    text: string,
  ) => {
    calls.push({ owner, text });
    if (/quota_clock|clock_timestamp\(\)/i.test(text) && !/DELETE\s+FROM/i.test(text)) {
      return result([{
        database_now: DB_NOW,
        minute_start: MINUTE_START,
        minute_end: MINUTE_END,
        issued_at: DB_NOW,
        expires_at: new Date(DB_NOW.getTime() + 5 * 60_000),
      }]);
    }
    if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
      return result([{ used_count: 1, limit_value: 300, window_end: MINUTE_END }]);
    }
    if (/DELETE\s+FROM/i.test(text)) {
      await Promise.resolve();
      cleanupSettled += 1;
      if (input.cleanupFailure) throw new Error(`private cleanup ${ADDRESS}`);
    }
    return result();
  };
  const pool = {
    async connect() {
      await acquire();
      let released = false;
      return {
        query: (text: string) => execute("client", text),
        release() {
          if (released) throw new Error("Pool client released twice");
          released = true;
          release();
        },
      };
    },
    async query(text: string) {
      await acquire();
      try {
        return await execute("pool", text);
      } finally {
        release();
      }
    },
  };
  return {
    pool,
    calls,
    active: () => active,
    cleanupSettled: () => cleanupSettled,
  };
}

async function settleWithoutPoolStarvation<T>(
  promise: Promise<T>,
  timeoutMilliseconds = 100,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("blocked-after-commit: cleanup exhausted the pool")),
          timeoutMilliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

describe("Slice 023D1 quota configuration", () => {
  const parser = () => (bootstrapModule as unknown as {
    parseApiQuotaPolicy?: (environment: Record<string, string | undefined>) => QuotaPolicy;
  }).parseApiQuotaPolicy;

  it("uses the four frozen MLP defaults", () => {
    expect(parser(), "bootstrap must export the pure quota parser").toBeTypeOf("function");
    expect(parser()!({})).toEqual(DEFAULT_POLICY);
  });

  it("accepts canonical bounded overrides and rejects ambiguous or unsafe composition", () => {
    expect(parser(), "bootstrap must export the pure quota parser").toBeTypeOf("function");
    expect(parser()!({
      PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT: "60",
      PROOFLINE_WALLET_CHALLENGE_GLOBAL_MINUTE_LIMIT: "10000",
      PROOFLINE_PROJECT_RUN_DAILY_LIMIT: "10000",
      PROOFLINE_PROJECT_ACTIVE_LIVE_RUN_LIMIT: "100",
    })).toEqual({
      walletChallengeAddressPerMinute: 60,
      walletChallengeGlobalPerMinute: 10_000,
      projectRunsPerUtcDay: 10_000,
      projectActiveLiveRuns: 100,
    });

    for (const environment of [
      { PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT: "0" },
      { PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT: "01" },
      { PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT: " 5" },
      { PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT: "61" },
      { PROOFLINE_WALLET_CHALLENGE_GLOBAL_MINUTE_LIMIT: "10001" },
      { PROOFLINE_PROJECT_RUN_DAILY_LIMIT: "1e2" },
      { PROOFLINE_PROJECT_ACTIVE_LIVE_RUN_LIMIT: "3.0" },
      {
        PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT: "6",
        PROOFLINE_WALLET_CHALLENGE_GLOBAL_MINUTE_LIMIT: "5",
      },
    ]) {
      expect(() => parser()!(environment)).toThrow(/quota|limit|configuration/i);
    }
  });

  it("passes parsed environment limits into production challenge admission", async () => {
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (/quota_clock|clock_timestamp\(\)/i.test(text)) {
        return result([{
          database_now: DB_NOW,
          minute_start: MINUTE_START,
          minute_end: MINUTE_END,
          issued_at: DB_NOW,
          expires_at: new Date(DB_NOW.getTime() + 5 * 60_000),
        }]);
      }
      if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
        return result([{ used_count: 1, limit_value: 2, window_end: MINUTE_END }]);
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const production = bootstrapModule.createProductionApi({
      environment: {
        PROOFLINE_TOKEN_DIGEST_KEY: "slice-023d1-composition-key",
        PROOFLINE_WEB_ORIGIN: "https://proofline.example",
        PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT: "2",
        PROOFLINE_WALLET_CHALLENGE_GLOBAL_MINUTE_LIMIT: "3",
        PROOFLINE_PROJECT_RUN_DAILY_LIMIT: "4",
        PROOFLINE_PROJECT_ACTIVE_LIVE_RUN_LIMIT: "1",
      },
      pool: { query, connect: vi.fn(async () => client) } as never,
    });
    const response = await production.api.fetch(new Request(
      "https://api.proofline.example/v1/auth/wallet/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://proofline.example" },
        body: JSON.stringify({ version: "1", address: ADDRESS }),
      },
    ));
    expect(response.status).toBe(201);
    const quotaValues = query.mock.calls
      .filter(([text]) => /INSERT INTO proofline_private\.quota_windows/i.test(String(text)))
      .flatMap(([, values = []]) => values);
    expect(quotaValues).toEqual(expect.arrayContaining([2, 3]));
  });
});

describe("Slice 023D1 persisted wallet challenge admission", () => {
  it("reserves address and global windows from one database clock before inserting the challenge", async () => {
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (/quota_clock|clock_timestamp\(\)/i.test(text)) {
        return result([{
          database_now: DB_NOW,
          minute_start: MINUTE_START,
          minute_end: MINUTE_END,
          issued_at: DB_NOW,
          expires_at: new Date(DB_NOW.getTime() + 5 * 60_000),
        }]);
      }
      if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
        return result([{ used_count: 1, limit_value: 5, window_end: MINUTE_END }]);
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const auth = service({ query, connect: vi.fn(async () => client) });

    await auth.createWalletChallenge({ version: "1", address: ADDRESS });

    const calls = query.mock.calls as Array<[string, readonly unknown[]?]>;
    const sql = calls.map(([text]) => text);
    const begin = sql.findIndex((text) => /^BEGIN$/i.test(text));
    const clock = sql.findIndex((text) => /quota_clock/i.test(text));
    const reservations = sql
      .map((text, index) => /INSERT INTO proofline_private\.quota_windows/i.test(text) ? index : -1)
      .filter((index) => index >= 0);
    const challenge = sql.findIndex((text) => /INSERT INTO proofline_private\.wallet_challenges/i.test(text));
    const commit = sql.findIndex((text) => /^COMMIT$/i.test(text));
    expect([begin, clock, ...reservations, challenge, commit]).toEqual(
      [...[begin, clock, ...reservations, challenge, commit]].sort((left, right) => left - right),
    );
    expect(reservations).toHaveLength(2);
    for (const index of reservations) {
      expect(sql[index]).toMatch(/ON CONFLICT[\s\S]+used_count\s*<\s*(?:quota_windows\.)?limit_value[\s\S]+RETURNING/i);
      expect(sql[index]).not.toMatch(/limit_value\s*=\s*EXCLUDED\.limit_value/i);
    }
    const digests = calls
      .flatMap(([, values = []]) => [...values])
      .filter((value): value is Uint8Array => value instanceof Uint8Array && value.byteLength === 32)
      .map((value) => Buffer.from(value).toString("hex"));
    const addressDigest = createHash("sha256")
      .update("proofline:quota:wallet-challenge-address:v1\0", "utf8")
      .update(Buffer.from(ADDRESS.slice(2), "hex"))
      .digest("hex");
    const globalDigest = createHash("sha256")
      .update("proofline:quota:wallet-challenge-global:v1", "utf8")
      .digest("hex");
    expect(digests).toEqual(expect.arrayContaining([addressDigest, globalDigest]));
    expect(JSON.stringify(reservations.map((index) => calls[index]))).not.toContain(ADDRESS);
  });

  it("rolls both reservations back and returns one private rate outcome", async () => {
    let reservation = 0;
    const query = vi.fn(async (text: string) => {
      if (/quota_clock|clock_timestamp\(\)/i.test(text)) {
        return result([{
          database_now: DB_NOW,
          minute_start: MINUTE_START,
          minute_end: MINUTE_END,
          issued_at: DB_NOW,
          expires_at: new Date(DB_NOW.getTime() + 5 * 60_000),
        }]);
      }
      if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
        reservation += 1;
        return reservation === 1
          ? result([{ used_count: 5, limit_value: 5, window_end: MINUTE_END }])
          : result();
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const auth = service({ query, connect: vi.fn(async () => client) });

    await expect(auth.createWalletChallenge({ version: "1", address: ADDRESS }))
      .rejects.toMatchObject({
        status: 429,
        code: "WALLET_CHALLENGE_RATE_LIMITED",
        retryAfterSeconds: 4,
      });
    const sql = query.mock.calls.map(([text]) => String(text));
    expect(sql).toContain("ROLLBACK");
    expect(sql.some((text) => /INSERT INTO proofline_private\.wallet_challenges/i.test(text))).toBe(false);
  });

  it("bounds cleanup to old quota windows and challenges without widening its table authority", async () => {
    const query = vi.fn(async (text: string) => {
      if (/quota_clock|clock_timestamp\(\)/i.test(text)) {
        return result([{
          database_now: DB_NOW,
          minute_start: MINUTE_START,
          minute_end: MINUTE_END,
          issued_at: DB_NOW,
          expires_at: new Date(DB_NOW.getTime() + 5 * 60_000),
        }]);
      }
      if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
        return result([{ used_count: 1, limit_value: 5, window_end: MINUTE_END }]);
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const auth = service({ query, connect: vi.fn(async () => client) });
    await auth.createWalletChallenge({ version: "1", address: ADDRESS });

    const cleanup = query.mock.calls
      .map(([text]) => String(text))
      .filter((text) => /DELETE\s+FROM/i.test(text));
    expect(cleanup).toHaveLength(2);
    expect(cleanup.join("\n")).toMatch(/proofline_private\.quota_windows[\s\S]+window_end[\s\S]+interval\s*'24 hours'/i);
    expect(cleanup.join("\n")).toMatch(/proofline_private\.wallet_challenges[\s\S]+expires_at[\s\S]+interval\s*'24 hours'/i);
    expect(cleanup.join("\n")).toMatch(/LIMIT\s+100/gi);
    expect(cleanup.join("\n")).toMatch(/FOR UPDATE SKIP LOCKED/gi);
    expect(cleanup.join("\n")).not.toMatch(/wallet_identities|api_tokens|projects|runs|run_events|run_artifacts|run_commands|relayer/i);
  });

  it("keeps accepted challenge admission available when bounded cleanup fails", async () => {
    const query = vi.fn(async (text: string) => {
      if (/quota_clock|clock_timestamp\(\)/i.test(text)) {
        return result([{
          database_now: DB_NOW,
          minute_start: MINUTE_START,
          minute_end: MINUTE_END,
          issued_at: DB_NOW,
          expires_at: new Date(DB_NOW.getTime() + 5 * 60_000),
        }]);
      }
      if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
        return result([{ used_count: 1, limit_value: 5, window_end: MINUTE_END }]);
      }
      if (/DELETE\s+FROM/i.test(text)) throw new Error(`cleanup internals ${ADDRESS}`);
      return result();
    });
    const client = { query, release: vi.fn() };
    const auth = service({ query, connect: vi.fn(async () => client) });
    await expect(auth.createWalletChallenge({ version: "1", address: ADDRESS }))
      .resolves.toMatchObject({ version: "1", address: ADDRESS });
    expect(query.mock.calls.some(([text]) => /DELETE\s+FROM/i.test(String(text)))).toBe(true);
  });

  it("returns and releases with a max-one pool instead of reacquiring for cleanup", async () => {
    const harness = boundedChallengePool({ max: 1 });
    const auth = service(harness.pool);

    await expect(settleWithoutPoolStarvation(auth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }))).resolves.toMatchObject({ version: "1", address: ADDRESS });

    expect(harness.active()).toBe(0);
    const commit = harness.calls.findIndex(({ text }) => /^COMMIT$/i.test(text));
    const cleanup = harness.calls
      .map(({ text }, index) => /DELETE\s+FROM/i.test(text) ? index : -1)
      .filter((index) => index >= 0);
    const release = harness.calls.findIndex(({ owner }) => owner === "release");
    expect(cleanup).toHaveLength(2);
    expect(cleanup.every((index) => index > commit)).toBe(true);
    expect(
      cleanup.every((index) => harness.calls[index]?.owner === "client") &&
        release > cleanup.at(-1)! ||
        release < cleanup[0]! &&
        cleanup.every((index) => harness.calls[index]?.owner === "pool"),
    ).toBe(true);
  });

  it("awaits fail-open cleanup and returns the admitted challenge with a max-one pool", async () => {
    const harness = boundedChallengePool({ max: 1, cleanupFailure: true });
    const auth = service(harness.pool);

    await expect(settleWithoutPoolStarvation(auth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }))).resolves.toMatchObject({ version: "1", address: ADDRESS });

    expect(harness.cleanupSettled()).toBe(2);
    expect(harness.active()).toBe(0);
  });

  it("admits a saturated max-N batch without cleanup deadlock or duplicate reservations", async () => {
    const maximum = 4;
    const harness = boundedChallengePool({ max: maximum });
    const auth = service(harness.pool, {
      ...DEFAULT_POLICY,
      walletChallengeAddressPerMinute: maximum,
      walletChallengeGlobalPerMinute: maximum,
    });
    const addresses = Array.from({ length: maximum }, (_, index) =>
      `0x${String(index + 1).padStart(40, "0")}`
    );

    const challenges = await settleWithoutPoolStarvation(Promise.all(
      addresses.map((address) => auth.createWalletChallenge({
        version: "1",
        address,
      })),
    ));

    expect(challenges.map(({ address }) => address)).toEqual(addresses);
    expect(harness.active()).toBe(0);
    expect(harness.calls.filter(({ text }) =>
      /INSERT INTO proofline_private\.wallet_challenges/i.test(text)
    )).toHaveLength(maximum);
    expect(harness.calls.filter(({ text }) =>
      /INSERT INTO proofline_private\.quota_windows/i.test(text)
    )).toHaveLength(maximum * 2);
  });
});

describe("Slice 023D1 persisted run admission", () => {
  it("replays the same create intent before advisory lock or quota consumption", async () => {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(validManifest))
      .digest();
    const query = vi.fn(async (text: string) =>
      /SELECT id, request_fingerprint[\s\S]+FROM proofline_private\.runs/i.test(text)
        ? result([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa30", request_fingerprint: fingerprint }])
        : result()
    );
    const client = { query, release: vi.fn() };
    const production = service({ query, connect: vi.fn(async () => client) });

    await expect(production.createRun({
      projectId: PROJECT_ID,
      idempotencyKey: "same-intent",
      manifest: validManifest,
    })).resolves.toMatchObject({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa30" });
    const sql = query.mock.calls.map(([text]) => String(text)).join("\n");
    expect(sql).not.toMatch(/pg_advisory_xact_lock|quota_windows|COUNT\([^)]*\)[\s\S]+submission/i);

    await expect(production.createRun({
      projectId: PROJECT_ID,
      idempotencyKey: "same-intent",
      manifest: {
        ...validManifest,
        consumer: { ...validManifest.consumer, expectedHost: "other.example" },
      },
    })).rejects.toMatchObject({ status: 409 });
    const conflictSql = query.mock.calls.map(([text]) => String(text)).join("\n");
    expect(conflictSql).not.toMatch(/pg_advisory_xact_lock|quota_windows|COUNT\([^)]*\)[\s\S]+submission/i);
  });

  it("serializes a new project intent, rechecks idempotency, then enforces daily and live limits", async () => {
    let idempotencyReads = 0;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (/SELECT id, request_fingerprint[\s\S]+FROM proofline_private\.runs/i.test(text)) {
        idempotencyReads += 1;
        return result();
      }
      if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
        return values.includes("active_live")
          ? result([{ used_count: 0, limit_value: 3 }])
          : result([{ used_count: 1, limit_value: 100 }]);
      }
      if (/COUNT\([^)]*\)[\s\S]+FROM proofline_private\.runs/i.test(text)) {
        return result([{ active_live_runs: 0 }]);
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const production = service({ query, connect: vi.fn(async () => client) });
    await production.createRun({
      projectId: PROJECT_ID,
      idempotencyKey: "new-wallet-run",
      manifest: validManifest,
    });

    const sql = query.mock.calls.map(([text]) => String(text));
    const firstRead = sql.findIndex((text) => /SELECT id, request_fingerprint/i.test(text));
    const lock = sql.findIndex((text) => /pg_advisory_xact_lock/i.test(text));
    const secondRead = sql.findIndex((text, index) => index > lock && /SELECT id, request_fingerprint/i.test(text));
    const policyRows = sql
      .map((text, index) => /INSERT INTO proofline_private\.quota_windows/i.test(text) ? index : -1)
      .filter((index) => index >= 0);
    const [daily, activePolicy] = policyRows;
    const active = sql.findIndex((text) => /COUNT\([^)]*\)[\s\S]+FROM proofline_private\.runs/i.test(text));
    const insert = sql.findIndex((text) => /INSERT INTO proofline_private\.runs/i.test(text));
    expect(idempotencyReads).toBe(2);
    expect(policyRows).toHaveLength(2);
    expect([firstRead, lock, secondRead, daily!, activePolicy!, active, insert]).toEqual(
      [...[firstRead, lock, secondRead, daily!, activePolicy!, active, insert]].sort((left, right) => left - right),
    );
    expect(query.mock.calls[activePolicy!]?.[1]).toEqual(expect.arrayContaining(["active_live", 3]));
    const policyDigests = policyRows
      .flatMap((index) => query.mock.calls[index]?.[1] ?? [])
      .filter((value): value is Uint8Array => value instanceof Uint8Array && value.byteLength === 32)
      .map((value) => Buffer.from(value).toString("hex"));
    expect(policyDigests).toEqual(expect.arrayContaining([
      createHash("sha256")
        .update("proofline:quota:project-run-day:v1\0", "utf8")
        .update(PROJECT_ID, "utf8")
        .digest("hex"),
      createHash("sha256")
        .update("proofline:quota:project-active-live:v1\0", "utf8")
        .update(PROJECT_ID, "utf8")
        .digest("hex"),
    ]));
    expect(sql[active]).toMatch(/submission[\s\S]+(?:wallet|relayer)[\s\S]+terminal/i);
  });

  it("excludes replay from only the active-live count while retaining its daily reservation", async () => {
    const replayManifest = {
      ...validManifest,
      submission: { ...validManifest.submission, mode: "replay" as const },
    };
    const query = vi.fn(async (text: string) => {
      if (/INSERT INTO proofline_private\.quota_windows/i.test(text)) {
        return result([{ used_count: 1, limit_value: 100 }]);
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const production = service({ query, connect: vi.fn(async () => client) });
    await production.createRun({
      projectId: PROJECT_ID,
      idempotencyKey: "new-replay-run",
      manifest: replayManifest,
    });
    const sql = query.mock.calls.map(([text]) => String(text)).join("\n");
    expect(sql).toMatch(/INSERT INTO proofline_private\.quota_windows/i);
    expect(query.mock.calls.filter(([text]) => /INSERT INTO proofline_private\.quota_windows/i.test(String(text))))
      .toHaveLength(1);
    expect(sql).not.toMatch(/active_live/i);
    expect(sql).not.toMatch(/COUNT\([^)]*\)[\s\S]+FROM proofline_private\.runs/i);
  });
});
