// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  AccountTokenCreatedV1Schema,
  AccountTokenRevokedV1Schema,
  AccountV1Schema,
} from "@proofline/contracts";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN_UUID = "33333333-3333-4333-8333-333333333333";
const TOKEN_ID = `token_${TOKEN_UUID.replaceAll("-", "")}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CREATED_AT = "2026-08-09T01:02:03.456Z";
const EXPIRES_AT = "2026-09-08T01:02:03.456Z";
const REVOKED_AT = "2026-08-10T04:05:06.789Z";

type QueryResult = { rowCount: number; rows: Array<Record<string, unknown>> };
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
  revokeCurrentWalletSession(input: {
    projectId: string;
    tokenId: string;
    walletIdentityId: string;
  }): Promise<unknown>;
};

function result(rows: Array<Record<string, unknown>> = []): QueryResult {
  return { rowCount: rows.length, rows };
}

function service(pool: Record<string, unknown>): AccountService {
  return (createProductionProoflineService as unknown as (
    input: Record<string, unknown>,
  ) => AccountService)({
    pool,
    tokenDigestKey: "slice-023b2-digest-key",
    publicWebOrigin: "https://proofline.example",
  });
}

function accountIdentityRow() {
  return {
    id: WALLET_ID,
    address: Buffer.from(ADDRESS.slice(2), "hex"),
    project_id: PROJECT_ID,
  };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TOKEN_UUID,
    kind: "cli",
    label: "Local CLI",
    created_at: new Date(CREATED_AT),
    expires_at: new Date(EXPIRES_AT),
    revoked_at: null,
    ...overrides,
  };
}

function valueForColumn(
  sql: string,
  values: readonly unknown[],
  column: string,
): unknown {
  const columns = /INSERT INTO proofline_private\.api_tokens\s*\(([^)]+)\)/i
    .exec(sql)?.[1]
    ?.split(",")
    .map((value) => value.trim().toLowerCase());
  const index = columns?.indexOf(column.toLowerCase()) ?? -1;
  return index >= 0 ? values[index] : undefined;
}

describe("Slice 023B2 persisted account token service", () => {
  it("lists only CLI and Action summaries without selecting digests in stable order", async () => {
    const query = vi.fn(async (text: string) => {
      if (/FROM proofline_private\.wallet_identities/i.test(text)) {
        return result([accountIdentityRow()]);
      }
      if (/FROM proofline_private\.api_tokens/i.test(text)) {
        return result([
          tokenRow(),
          tokenRow({
            id: "44444444-4444-4444-8444-444444444444",
            kind: "action",
            label: "Release Action",
            created_at: new Date("2026-08-08T01:02:03.456Z"),
            expires_at: new Date("2026-11-06T01:02:03.456Z"),
          }),
        ]);
      }
      return result();
    });
    const account = AccountV1Schema.parse(await service({ query }).getAccount({
      projectId: PROJECT_ID,
    }));
    expect(account.wallet).toEqual({ kind: "eoa", address: ADDRESS });
    expect(account.project).toEqual({ kind: "default", projectId: PROJECT_ID });
    expect(account.tokens.map((token) => token.kind)).toEqual(["cli", "action"]);
    expect(JSON.stringify(account)).not.toMatch(/digest|project_[a-f0-9]{64}/i);

    const tokenSql = query.mock.calls
      .map(([text]) => String(text))
      .find((text) => /FROM proofline_private\.api_tokens/i.test(text)) ?? "";
    expect(tokenSql).not.toMatch(/\btoken_digest\b/i);
    expect(tokenSql).toMatch(/kind\s+IN\s*\(\s*'cli'\s*,\s*'action'\s*\)/i);
    expect(tokenSql).toMatch(/ORDER BY\s+created_at\s+DESC\s*,\s*id\s+DESC/i);
  });

  it("uses database time and persists only digest evidence for a one-time secret", async () => {
    const query = vi.fn(async (text: string) => {
      if (/clock_timestamp\(\)/i.test(text)) {
        return result([{ created_at: new Date(CREATED_AT), expires_at: new Date(EXPIRES_AT) }]);
      }
      if (/FROM proofline_private\.wallet_identities/i.test(text)) {
        return result([accountIdentityRow()]);
      }
      if (/INSERT INTO proofline_private\.api_tokens/i.test(text)) return result([tokenRow()]);
      return result();
    });
    const client = { query, release: vi.fn() };
    const created = AccountTokenCreatedV1Schema.parse(
      await service({ query, connect: vi.fn(async () => client) }).createAccountToken({
        version: "1",
        projectId: PROJECT_ID,
        idempotencyKey: `token_issue_${"1".repeat(64)}`,
        kind: "cli",
        label: "Local CLI",
        expiresInDays: 30,
      }),
    );
    expect(created.token).toMatch(/^project_[a-f0-9]{64}$/);
    expect(created.item).toMatchObject({
      tokenId: TOKEN_ID,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      revokedAt: null,
    });

    const calls = query.mock.calls as Array<[string, readonly unknown[]?]>;
    const begin = calls.findIndex(([text]) => /^BEGIN$/i.test(text));
    const clock = calls.findIndex(([text]) => /clock_timestamp\(\)/i.test(text));
    const insert = calls.findIndex(([text]) => /INSERT INTO proofline_private\.api_tokens/i.test(text));
    const commit = calls.findIndex(([text]) => /^COMMIT$/i.test(text));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(clock);
    expect(clock).toBeLessThan(insert);
    expect(insert).toBeLessThan(commit);
    expect(calls[clock]?.[0]).toMatch(/date_trunc\s*\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i);

    const [insertSql = "", insertValues = []] = calls[insert] ?? [];
    for (const column of [
      "token_digest",
      "issuance_key_digest",
      "issuance_fingerprint",
      "created_at",
      "expires_at",
      "wallet_identity_id",
    ]) {
      expect(insertSql).toMatch(new RegExp(`\\b${column}\\b`, "i"));
    }
    expect(JSON.stringify(insertValues)).not.toContain(created.token);
    const digests = ["token_digest", "issuance_key_digest", "issuance_fingerprint"]
      .map((column) => valueForColumn(insertSql, insertValues, column));
    expect(digests.every((value) => value instanceof Uint8Array && value.byteLength === 32)).toBe(true);
    expect(Buffer.from(digests[0] as Uint8Array)).not.toEqual(Buffer.from(digests[1] as Uint8Array));
    expect(Buffer.from(digests[1] as Uint8Array)).not.toEqual(Buffer.from(digests[2] as Uint8Array));
  });

  it("never returns a second secret for the same issuance key and distinguishes changed intent", async () => {
    let inserted = false;
    let persistedFingerprint: Uint8Array | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (/clock_timestamp\(\)/i.test(text)) {
        return result([{ created_at: new Date(CREATED_AT), expires_at: new Date(EXPIRES_AT) }]);
      }
      if (/FROM proofline_private\.wallet_identities/i.test(text)) return result([accountIdentityRow()]);
      if (/SELECT[\s\S]+issuance_fingerprint[\s\S]+FROM proofline_private\.api_tokens/i.test(text)) {
        return inserted ? result([{ issuance_fingerprint: persistedFingerprint }]) : result();
      }
      if (/INSERT INTO proofline_private\.api_tokens/i.test(text)) {
        const fingerprint = valueForColumn(text, values, "issuance_fingerprint");
        if (!inserted) {
          inserted = true;
          persistedFingerprint = fingerprint as Uint8Array;
          return result([tokenRow()]);
        }
        throw { code: "23505", constraint: "api_tokens_account_issuance_key_unique" };
      }
      return result();
    });
    const client = { query, release: vi.fn() };
    const account = service({ query, connect: vi.fn(async () => client) });
    const intent = {
      version: "1" as const,
      projectId: PROJECT_ID,
      idempotencyKey: `token_issue_${"2".repeat(64)}`,
      kind: "cli" as const,
      label: "Local CLI",
      expiresInDays: 30,
    };
    AccountTokenCreatedV1Schema.parse(await account.createAccountToken(intent));
    await expect(account.createAccountToken(intent)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED",
    });
    await expect(account.createAccountToken({ ...intent, label: "Different CLI" })).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(inserted).toBe(true);
  });

  it("revokes project-owned CLI or Action rows once while preserving the first timestamp", async () => {
    const query = vi.fn(async (text: string) =>
      /UPDATE proofline_private\.api_tokens/i.test(text)
        ? result([tokenRow({ revoked_at: new Date(REVOKED_AT) })])
        : result()
    );
    const account = service({ query });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(AccountTokenRevokedV1Schema.parse(await account.revokeAccountToken({
        projectId: PROJECT_ID,
        tokenId: TOKEN_ID,
      }))).toEqual({ version: "1", tokenId: TOKEN_ID, revoked: true });
    }
    const revokeSql = query.mock.calls
      .map(([text]) => String(text))
      .find((text) => /UPDATE proofline_private\.api_tokens/i.test(text)) ?? "";
    expect(revokeSql).toMatch(/project_id\s*=\s*\$\d+/i);
    expect(revokeSql).toMatch(/kind\s+IN\s*\(\s*'cli'\s*,\s*'action'\s*\)/i);
    expect(revokeSql).toMatch(/revoked_at\s*=\s*COALESCE\s*\(\s*revoked_at\s*,[\s\S]*clock_timestamp\(\)/i);

    const missing = service({ query: vi.fn(async () => result()) });
    await expect(missing.revokeAccountToken({
      projectId: PROJECT_ID,
      tokenId: TOKEN_ID,
    })).rejects.toMatchObject({ status: 404, code: "ACCOUNT_TOKEN_NOT_FOUND" });
  });

  it("revokes only the authenticated browser-token row using a millisecond database clock", async () => {
    const query = vi.fn(async (text: string) =>
      /UPDATE proofline_private\.api_tokens/i.test(text)
        ? result([{ id: TOKEN_UUID, revoked_at: new Date(REVOKED_AT) }])
        : result()
    );
    const account = service({ query });
    expect(await account.revokeCurrentWalletSession({
      projectId: PROJECT_ID,
      tokenId: TOKEN_UUID,
      walletIdentityId: WALLET_ID,
    })).toBeUndefined();
    const sql = query.mock.calls.map(([text]) => String(text)).join("\n");
    expect(sql).toMatch(/UPDATE proofline_private\.api_tokens/i);
    expect(sql).toMatch(/\bid\s*=\s*\$\d+/i);
    expect(sql).toMatch(/project_id\s*=\s*\$\d+/i);
    expect(sql).toMatch(/wallet_identity_id\s*=\s*\$\d+/i);
    expect(sql).toMatch(/kind\s*=\s*'browser'/i);
    expect(sql).toMatch(/revoked_at\s*=\s*date_trunc\s*\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i);
  });
});
