// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WalletChallengeV1Schema,
  WalletSessionV1Schema,
} from "@proofline/contracts";
import { createProductionProoflineService } from "../src/production-service";

const NOW = "2026-08-09T00:00:00.000Z";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const CHALLENGE_ID = `challenge_${"a".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;
const PROJECT_ID = "11111111-1111-4111-8111-111111111123";
const WALLET_ID = "22222222-2222-4222-8222-222222222123";
const NONCE = "a1".repeat(32);
const EXPIRES_AT = "2026-08-09T00:05:00.000Z";
const DB_CHALLENGE_NOW = "2026-08-09T01:02:03.456Z";
const DB_CHALLENGE_EXPIRES_AT = "2026-08-09T01:07:03.456Z";
const DB_SESSION_NOW = "2026-08-09T04:05:06.789Z";
const DB_SESSION_EXPIRES_AT = "2026-08-09T16:05:06.789Z";
const MESSAGE = [
  "proofline.example wants you to sign in with your Ethereum account:",
  ADDRESS,
  "",
  "Sign in to Proofline and create your default project.",
  "",
  "URI: https://proofline.example",
  "Version: 1",
  "Chain ID: 114",
  `Nonce: ${NONCE}`,
  `Issued At: ${NOW}`,
  `Expiration Time: ${EXPIRES_AT}`,
].join("\n");

type QueryResult = { rowCount: number; rows: Array<Record<string, unknown>> };
type AuthService = {
  createWalletChallenge(input: { version: "1"; address: string }): Promise<unknown>;
  createWalletSession(input: {
    version: "1";
    challengeId: string;
    signature: string;
  }): Promise<unknown>;
};

function result(rows: Array<Record<string, unknown>> = []): QueryResult {
  return { rowCount: rows.length, rows };
}

function challengeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHALLENGE_ID,
    address: Buffer.from(ADDRESS.slice(2), "hex"),
    nonce: Buffer.from(NONCE, "hex"),
    message: MESSAGE,
    issued_at: new Date(NOW),
    expires_at: new Date(EXPIRES_AT),
    ...overrides,
  };
}

function service(input: {
  pool: Record<string, unknown>;
  recoverAddress?: (input: { message: string; signature: string }) => Promise<string>;
}) {
  const factory = createProductionProoflineService as unknown as (
    input: Record<string, unknown>,
  ) => AuthService;
  return factory({
    pool: input.pool,
    tokenDigestKey: "slice-023b1-digest-key",
    publicWebOrigin: "https://proofline.example",
    walletAuthPorts: {
      recoverAddress: input.recoverAddress ?? vi.fn(async () => ADDRESS),
    },
  });
}

describe("Slice 023B1 persisted wallet auth service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates distinct canonical 256-bit challenges and persists the exact evidence", async () => {
    const query = vi.fn(async (text: string) =>
      /clock_timestamp\(\)/i.test(text)
        ? result([{
            issued_at: new Date(DB_CHALLENGE_NOW),
            expires_at: new Date(DB_CHALLENGE_EXPIRES_AT),
          }])
        : result()
    );
    const client = { query, release: vi.fn() };
    const auth = service({
      pool: { query, connect: vi.fn(async () => client) },
    });

    const first = WalletChallengeV1Schema.parse(await auth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }));
    const second = WalletChallengeV1Schema.parse(await auth.createWalletChallenge({
      version: "1",
      address: ADDRESS,
    }));
    const nonce = (value: typeof first) => /\nNonce: ([a-f0-9]{64})\n/.exec(value.message)?.[1];

    expect(first.issuedAt).toBe(DB_CHALLENGE_NOW);
    expect(first.expiresAt).toBe(DB_CHALLENGE_EXPIRES_AT);
    expect(first.message).toContain(`Issued At: ${DB_CHALLENGE_NOW}`);
    expect(first.message).toContain(`Expiration Time: ${DB_CHALLENGE_EXPIRES_AT}`);
    expect(first.challengeId).not.toBe(second.challengeId);
    expect(nonce(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(nonce(first)).not.toBe(nonce(second));

    const insertIndices = query.mock.calls
      .map(([text], index) => /INSERT INTO proofline_private\.wallet_challenges/i.test(String(text)) ? index : -1)
      .filter((index) => index >= 0);
    const clockReadIndices = query.mock.calls
      .map(([text], index) => /clock_timestamp\(\)/i.test(String(text)) ? index : -1)
      .filter((index) => index >= 0);
    const inserts = insertIndices.map((index) => query.mock.calls[index]!);
    const clockReads = clockReadIndices.map((index) => query.mock.calls[index]!);
    expect(clockReads).toHaveLength(2);
    expect(inserts).toHaveLength(2);
    for (const [text] of clockReads) {
      expect(text).toMatch(/date_trunc\s*\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i);
    }
    expect(clockReadIndices[0]).toBeLessThan(insertIndices[0] ?? Infinity);
    expect(clockReadIndices[1]).toBeLessThan(insertIndices[1] ?? Infinity);
    for (const [index, persisted] of inserts.entries()) {
      const [sql, values = []] = persisted as [string, readonly unknown[]];
      const challenge = index === 0 ? first : second;
      const challengeNonce = nonce(challenge)!;
      expect(sql).toMatch(/\bid\b[\s\S]*\baddress\b[\s\S]*\bnonce\b[\s\S]*\bmessage\b[\s\S]*\bissued_at\b[\s\S]*\bexpires_at\b/i);
      expect(values).toEqual(expect.arrayContaining([
        challenge.challengeId,
        challenge.message,
      ]));
      for (const timestamp of [challenge.issuedAt, challenge.expiresAt]) {
        expect(values.some((value) =>
          value === timestamp || (value instanceof Date && value.toISOString() === timestamp)
        )).toBe(true);
      }
      expect(values.some((value) =>
        value === challengeNonce ||
        (value instanceof Uint8Array && Buffer.from(value).toString("hex") === challengeNonce)
      )).toBe(true);
    }
  });

  it("durably consumes before recovery and unifies every later attempt as unavailable", async () => {
    let available = true;
    const timeline: string[] = [];
    const query = vi.fn(async (text: string) => {
      timeline.push(text.trim().toUpperCase() === "COMMIT" ? "commit" : "query");
      if (/UPDATE proofline_private\.wallet_challenges/i.test(text)) {
        if (!available) return result();
        available = false;
        return result([challengeRow()]);
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const recoverAddress = vi.fn(async () => {
      timeline.push("recover");
      return OTHER_ADDRESS;
    });
    const auth = service({
      pool: { query, connect: vi.fn(async () => client) },
      recoverAddress,
    });

    await expect(auth.createWalletSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    })).rejects.toMatchObject({ status: 401, code: "WALLET_SIGNATURE_INVALID" });
    expect(timeline.indexOf("commit")).toBeLessThan(timeline.indexOf("recover"));
    expect(recoverAddress).toHaveBeenCalledWith({ message: MESSAGE, signature: SIGNATURE });

    await expect(auth.createWalletSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    })).rejects.toMatchObject({ status: 409, code: "CHALLENGE_UNAVAILABLE" });
    expect(recoverAddress).toHaveBeenCalledOnce();
    const consumeSql = query.mock.calls
      .map(([text]) => String(text))
      .find((text) => /UPDATE proofline_private\.wallet_challenges/i.test(text));
    expect(consumeSql).toMatch(/consumed_at\s+IS\s+NULL/i);
    expect(consumeSql).toMatch(/expires_at\s*>\s*now\(\)/i);
    const consumedAtAssignment = /SET\s+consumed_at\s*=([\s\S]*?)\s+WHERE/i.exec(consumeSql ?? "")?.[1] ?? "";
    expect(consumedAtAssignment).toMatch(
      /date_trunc\s*\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i,
    );
    expect(consumedAtAssignment).toMatch(/\bissued_at\b/i);
  });

  it("returns every persisted reconstruction input from atomic consumption", async () => {
    const query = vi.fn(async (text: string) =>
      /UPDATE proofline_private\.wallet_challenges/i.test(text)
        ? result([challengeRow()])
        : result()
    );
    const client = { query, release: vi.fn() };
    const auth = service({
      pool: { query, connect: vi.fn(async () => client) },
      recoverAddress: vi.fn(async () => OTHER_ADDRESS),
    });
    await expect(auth.createWalletSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    })).rejects.toMatchObject({ code: "WALLET_SIGNATURE_INVALID" });
    const consumeSql = query.mock.calls
      .map(([text]) => String(text))
      .find((text) => /UPDATE proofline_private\.wallet_challenges/i.test(text));
    const returning = consumeSql?.split(/RETURNING/i)[1] ?? "";
    for (const column of ["address", "nonce", "message", "issued_at", "expires_at"]) {
      expect(returning).toMatch(new RegExp(`\\b${column}\\b`, "i"));
    }
    for (const column of ["issued_at", "expires_at"]) {
      expect(consumeSql).toMatch(
        new RegExp(`${column}\\s*=\\s*date_trunc\\s*\\(\\s*'milliseconds'\\s*,\\s*${column}\\s*\\)`, "i"),
      );
    }
  });

  it.each([
    ["message", { message: `${MESSAGE}\n` }],
    ["domain", { message: MESSAGE.replaceAll("proofline.example", "evil.example") }],
    ["nonce", { nonce: Buffer.from("b2".repeat(32), "hex") }],
    [
      "timestamp",
      {
        issued_at: new Date("2026-08-09T00:00:01.000Z"),
        expires_at: new Date("2026-08-09T00:05:01.000Z"),
      },
    ],
  ])(
    "spends a corrupted persisted %s without recovery or provisioning",
    async (_kind, corruption) => {
      let available = true;
      const query = vi.fn(async (text: string) => {
        if (/UPDATE proofline_private\.wallet_challenges/i.test(text)) {
          if (!available) return result();
          available = false;
          return result([challengeRow(corruption)]);
        }
        return result();
      });
      const client = { query, release: vi.fn() };
      const connect = vi.fn(async () => client);
      const recoverAddress = vi.fn(async () => OTHER_ADDRESS);
      const auth = service({
        pool: { query, connect },
        recoverAddress,
      });
      const attempt = () => auth.createWalletSession({
        version: "1",
        challengeId: CHALLENGE_ID,
        signature: SIGNATURE,
      }).then(
        () => ({ status: "fulfilled" }),
        (error: unknown) => ({
          status: (error as { status?: unknown })?.status,
          code: (error as { code?: unknown })?.code,
          message: (error as { message?: unknown })?.message,
        }),
      );

      const first = await attempt();
      const retry = await attempt();
      const sql = query.mock.calls.map(([text]) => String(text)).join("\n");
      expect({
        first,
        retry,
        consumptionCommits: query.mock.calls.filter(([text]) =>
          String(text).trim().toUpperCase() === "COMMIT"
        ).length,
        recoveryCalls: recoverAddress.mock.calls.length,
        provisioned: /wallet_identities|INSERT INTO proofline_private\.projects|INSERT INTO proofline_private\.api_tokens/i.test(sql),
      }).toEqual({
        first: {
          status: 409,
          code: "CHALLENGE_UNAVAILABLE",
          message: "Wallet challenge is unavailable",
        },
        retry: {
          status: 409,
          code: "CHALLENGE_UNAVAILABLE",
          message: "Wallet challenge is unavailable",
        },
        consumptionCommits: 1,
        recoveryCalls: 0,
        provisioned: false,
      });
    },
  );

  it("provisions one locked default project and stores only the browser token digest", async () => {
    const consumeQuery = vi.fn(async (text: string) =>
      /UPDATE proofline_private\.wallet_challenges/i.test(text)
        ? result([challengeRow()])
        : result()
    );
    const provisionQuery = vi.fn(async (text: string) => {
      if (/clock_timestamp\(\)/i.test(text)) {
        return result([{
          issued_at: new Date(DB_SESSION_NOW),
          expires_at: new Date(DB_SESSION_EXPIRES_AT),
        }]);
      }
      if (/SELECT[\s\S]+FROM proofline_private\.wallet_identities/i.test(text)) return result();
      if (/INSERT INTO proofline_private\.projects/i.test(text)) return result([{ id: PROJECT_ID }]);
      if (/INSERT INTO proofline_private\.wallet_identities/i.test(text)) {
        return result([{ id: WALLET_ID, project_id: PROJECT_ID }]);
      }
      return result();
    });
    const consumeClient = { query: consumeQuery, release: vi.fn() };
    const provisionClient = { query: provisionQuery, release: vi.fn() };
    const connect = vi.fn()
      .mockResolvedValueOnce(consumeClient)
      .mockResolvedValueOnce(provisionClient);
    const recoverAddress = vi.fn(async () => ADDRESS);
    const auth = service({
      pool: { query: provisionQuery, connect },
      recoverAddress,
    });

    const session = WalletSessionV1Schema.parse(await auth.createWalletSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    }));
    expect(session).toMatchObject({
      wallet: { kind: "eoa", address: ADDRESS },
      project: { kind: "default", projectId: PROJECT_ID },
      issuedAt: DB_SESSION_NOW,
      expiresAt: DB_SESSION_EXPIRES_AT,
    });
    expect(session.projectToken).toMatch(/^project_[a-f0-9]{64}$/);
    expect(connect).toHaveBeenCalledTimes(2);

    const provisionCalls = provisionQuery.mock.calls as Array<[string, readonly unknown[]?]>;
    const lockIndex = provisionCalls.findIndex(([text]) => /pg_advisory_xact_lock/i.test(text));
    const identityIndex = provisionCalls.findIndex(([text]) => /FROM proofline_private\.wallet_identities/i.test(text));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(identityIndex);
    expect(JSON.stringify(provisionCalls[lockIndex])).toContain("114");
    expect(JSON.stringify(provisionCalls[lockIndex]).toLowerCase()).toContain(ADDRESS);

    const beginIndex = provisionCalls.findIndex(([text]) => /^BEGIN$/i.test(text));
    const clockIndex = provisionCalls.findIndex(([text]) => /clock_timestamp\(\)/i.test(text));
    expect(clockIndex).toBeGreaterThan(beginIndex);
    expect(provisionCalls[clockIndex]?.[0]).toMatch(
      /date_trunc\s*\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i,
    );

    const tokenInsert = provisionCalls.find(([text]) =>
      /INSERT INTO proofline_private\.api_tokens/i.test(text)
    );
    expect(clockIndex).toBeLessThan(provisionCalls.indexOf(tokenInsert!));
    expect(tokenInsert?.[0]).toMatch(/\bkind\b[\s\S]*\bcreated_at\b[\s\S]*\bexpires_at\b[\s\S]*\bwallet_identity_id\b/i);
    expect(JSON.stringify(provisionCalls)).not.toContain(session.projectToken);
    for (const timestamp of [DB_SESSION_NOW, DB_SESSION_EXPIRES_AT]) {
      expect(tokenInsert?.[1]?.some((value) =>
        value === timestamp || (value instanceof Date && value.toISOString() === timestamp)
      )).toBe(true);
    }
    expect(tokenInsert?.[1]?.some((value) =>
      value instanceof Uint8Array && value.byteLength === 32
    )).toBe(true);
    expect(provisionQuery.mock.calls.map(([text]) => String(text))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^BEGIN$/i), expect.stringMatching(/^COMMIT$/i)]),
    );
  });
});
