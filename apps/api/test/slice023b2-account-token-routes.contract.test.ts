// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createProoflineApi } from "../src/app";
import { createProductionApi } from "../src/bootstrap";

const WEB_ORIGIN = "https://proofline.example";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const BROWSER_TOKEN_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const CLI_TOKEN = `project_${"1".repeat(64)}`;
const ACTION_TOKEN = `project_${"2".repeat(64)}`;
const LEGACY_TOKEN = `project_${"3".repeat(64)}`;
const TOKEN_ID = `token_${"c".repeat(32)}`;
const RAW_TOKEN = `project_${"d".repeat(64)}`;
const CREATED_AT = "2026-08-09T00:00:00.000Z";
const EXPIRES_AT = "2026-09-08T00:00:00.000Z";

const summary = {
  version: "1",
  tokenId: TOKEN_ID,
  kind: "cli",
  label: "Local CLI",
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
  revokedAt: null,
} as const;

function harness(overrides: Record<string, unknown> = {}) {
  const service = {
    getAccount: vi.fn(async () => ({
      version: "1",
      wallet: { kind: "eoa", address: "0x1111111111111111111111111111111111111111" },
      project: { kind: "default", projectId: PROJECT_ID },
      tokens: [summary],
    })),
    createAccountToken: vi.fn(async () => ({
      version: "1",
      token: RAW_TOKEN,
      item: summary,
    })),
    revokeAccountToken: vi.fn(async () => ({
      version: "1",
      tokenId: TOKEN_ID,
      revoked: true,
    })),
    revokeCurrentWalletSession: vi.fn(async () => undefined),
    listRuns: vi.fn(async () => ({ version: "1", items: [] })),
    ...overrides,
  };
  const authenticate = vi.fn(async (raw: string) => {
    if (raw === PROJECT_TOKEN) {
      return {
        kind: "project" as const,
        projectId: PROJECT_ID,
        credentialKind: "browser" as const,
        tokenId: BROWSER_TOKEN_ID,
        walletIdentityId: WALLET_ID,
      };
    }
    if (raw === CLI_TOKEN) {
      return { kind: "project" as const, projectId: PROJECT_ID, credentialKind: "cli" as const };
    }
    if (raw === ACTION_TOKEN) {
      return { kind: "project" as const, projectId: PROJECT_ID, credentialKind: "action" as const };
    }
    if (raw === LEGACY_TOKEN) {
      return { kind: "project" as const, projectId: PROJECT_ID, credentialKind: "legacy" as const };
    }
    if (raw === SHARE_TOKEN) {
      return {
        kind: "share" as const,
        projectId: PROJECT_ID,
        runId: "22222222-2222-4222-8222-222222222222",
      };
    }
    return null;
  });
  return {
    service,
    authenticate,
    api: createProoflineApi({ service, authenticate, publicWebOrigin: WEB_ORIGIN }),
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://api.proofline.example${path}`, {
    ...init,
    headers: {
      origin: WEB_ORIGIN,
      authorization: `Bearer ${PROJECT_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  expect(response.headers.get("vary")?.toLowerCase()).toContain("origin");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
}

describe("Slice 023B2 account token API boundary", () => {
  it("serves the exact project-scoped account route with private browser headers", async () => {
    const { api, service } = harness();
    const response = await api.fetch(request("/v1/account"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: "1", tokens: [summary] });
    expectPrivate(response);
    expect(service.getAccount).toHaveBeenCalledWith({ projectId: PROJECT_ID });

    for (const path of ["/v1/account/", "/v1/account?extra=1"]) {
      const rejected = await api.fetch(request(path));
      expect(rejected.status).toBe(404);
    }
    expect(service.getAccount).toHaveBeenCalledOnce();
  });

  it("issues a CLI or Action token once behind project auth and Idempotency-Key", async () => {
    const { api, service } = harness();
    for (const [kind, label, expiresInDays, idempotencyKey] of [
      ["cli", "Local CLI", 1, `token_issue_${"4".repeat(64)}`],
      ["action", "Release Action", 90, `token_issue_${"5".repeat(64)}`],
    ] as const) {
      const response = await api.fetch(request("/v1/account/tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ version: "1", kind, label, expiresInDays }),
      }));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ version: "1", token: RAW_TOKEN });
      expectPrivate(response);
      expect(service.createAccountToken).toHaveBeenCalledWith({
        version: "1",
        projectId: PROJECT_ID,
        idempotencyKey,
        kind,
        label,
        expiresInDays,
      });
    }
  });

  it("strictly rejects invalid issuance bodies and a missing idempotency key", async () => {
    const { api, service } = harness();
    const cases = [
      [{ version: "1", kind: "browser", label: "Browser", expiresInDays: 30 }, "bad-kind"],
      [{ version: "1", kind: "cli", label: " CLI ", expiresInDays: 30 }, "bad-label"],
      [{ version: "1", kind: "cli", label: "CLI", expiresInDays: 0 }, "bad-days"],
      [{ version: "1", kind: "cli", label: "CLI", expiresInDays: 30, raw: "extra" }, "extra"],
    ] as const;
    for (const [body, key] of cases) {
      const response = await api.fetch(request("/v1/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `token_issue_${key.padEnd(64, "0")}` },
        body: JSON.stringify(body),
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST_BODY" } });
      expectPrivate(response);
    }
    const missingKey = await api.fetch(request("/v1/account/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1", kind: "cli", label: "CLI", expiresInDays: 30 }),
    }));
    expect(missingKey.status).toBe(400);
    expect(await missingKey.json()).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } });
    expectPrivate(missingKey);
    for (const invalidKey of ["short", `token_issue_${"A".repeat(64)}`, `${"6".repeat(64)}`]) {
      const response = await api.fetch(request("/v1/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": invalidKey },
        body: JSON.stringify({ version: "1", kind: "cli", label: "CLI", expiresInDays: 30 }),
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_IDEMPOTENCY_KEY" } });
      expectPrivate(response);
    }
    expect(service.createAccountToken).not.toHaveBeenCalled();
  });

  it("revokes only the exact project-owned CLI or Action token and is naturally idempotent", async () => {
    const { api, service } = harness();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await api.fetch(request(`/v1/account/tokens/${TOKEN_ID}`, {
        method: "DELETE",
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ version: "1", tokenId: TOKEN_ID, revoked: true });
      expectPrivate(response);
    }
    expect(service.revokeAccountToken).toHaveBeenCalledTimes(2);
    expect(service.revokeAccountToken).toHaveBeenLastCalledWith({
      projectId: PROJECT_ID,
      tokenId: TOKEN_ID,
    });
  });

  it("revokes the exact current browser session without a body, idempotency key, or response bytes", async () => {
    const { api, service } = harness();
    const response = await api.fetch(request("/v1/auth/wallet/sessions/current", {
      method: "DELETE",
    }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectPrivate(response);
    expect(service.revokeCurrentWalletSession).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      tokenId: BROWSER_TOKEN_ID,
      walletIdentityId: WALLET_ID,
    });

    const withBody = await api.fetch(request("/v1/auth/wallet/sessions/current", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1" }),
    }));
    expect(withBody.status).toBe(400);
    expect(await withBody.json()).toMatchObject({ error: { code: "INVALID_REQUEST_BODY" } });
    expectPrivate(withBody);
    expect(service.revokeCurrentWalletSession).toHaveBeenCalledOnce();
  });

  it("derives current-session authority from private authenticated token evidence", async () => {
    const query = vi.fn(async (text: string) => {
      if (/UNION ALL[\s\S]+share_tokens/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{
            kind: "project",
            project_id: PROJECT_ID,
            run_id: null,
            credential_kind: "browser",
            token_id: BROWSER_TOKEN_ID,
            wallet_identity_id: WALLET_ID,
          }],
        };
      }
      if (/UPDATE proofline_private\.api_tokens/i.test(text)) {
        return { rowCount: 1, rows: [{ id: BROWSER_TOKEN_ID }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const pool = { query };
    const api = createProductionApi({
      environment: {
        PROOFLINE_TOKEN_DIGEST_KEY: "slice-023b2-digest-key",
        PROOFLINE_WEB_ORIGIN: WEB_ORIGIN,
      },
      pool: pool as never,
    }).api;
    const response = await api.fetch(request("/v1/auth/wallet/sessions/current", {
      method: "DELETE",
    }));
    expect(response.status).toBe(204);
    const authSql = query.mock.calls.map(([text]) => String(text)).find((text) =>
      /UNION ALL[\s\S]+share_tokens/i.test(text)
    ) ?? "";
    expect(authSql).toMatch(/\bkind\s+AS\s+credential_kind\b/i);
    expect(authSql).toMatch(/\bid\s+AS\s+token_id\b/i);
    expect(authSql).toMatch(/\bwallet_identity_id\b/i);
    expect(JSON.stringify(query.mock.calls)).not.toContain(PROJECT_TOKEN);
  });

  it("keeps unauthenticated and share callers out of every account route", async () => {
    const { api, service } = harness();
    const routes: Array<[string, RequestInit]> = [
      ["/v1/account", {}],
      ["/v1/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `token_issue_${"6".repeat(64)}` },
        body: JSON.stringify({ version: "1", kind: "cli", label: "CLI", expiresInDays: 30 }),
      }],
      [`/v1/account/tokens/${TOKEN_ID}`, { method: "DELETE" }],
      ["/v1/auth/wallet/sessions/current", { method: "DELETE" }],
    ];
    for (const [path, init] of routes) {
      const unauthenticated = await api.fetch(request(path, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: "" },
      }));
      expect(unauthenticated.status).toBe(401);
      expectPrivate(unauthenticated);

      const shared = await api.fetch(request(path, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${SHARE_TOKEN}` },
      }));
      expect(shared.status).toBe(403);
      expect(await shared.json()).toMatchObject({ error: { code: "SHARE_READ_ONLY" } });
      expectPrivate(shared);
    }
    expect(service.getAccount).not.toHaveBeenCalled();
    expect(service.createAccountToken).not.toHaveBeenCalled();
    expect(service.revokeAccountToken).not.toHaveBeenCalled();
  });

  it("requires a browser wallet session and never trusts CLI, Action, or legacy project credentials", async () => {
    const { api, service } = harness();
    const routes: Array<[string, RequestInit]> = [
      ["/v1/account", {}],
      ["/v1/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `token_issue_${"7".repeat(64)}` },
        body: JSON.stringify({ version: "1", kind: "cli", label: "CLI", expiresInDays: 30 }),
      }],
      [`/v1/account/tokens/${TOKEN_ID}`, { method: "DELETE" }],
      ["/v1/auth/wallet/sessions/current", { method: "DELETE" }],
    ];
    for (const credential of [CLI_TOKEN, ACTION_TOKEN, LEGACY_TOKEN]) {
      for (const [path, init] of routes) {
        const response = await api.fetch(request(path, {
          ...init,
          headers: { ...(init.headers ?? {}), authorization: `Bearer ${credential}` },
        }));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          version: "1",
          error: { code: "ACCOUNT_SESSION_REQUIRED", message: "Request rejected" },
        });
        expectPrivate(response);
      }
      const ordinaryProjectApi = await api.fetch(request("/v1/runs", {
        headers: { authorization: `Bearer ${credential}` },
      }));
      expect(ordinaryProjectApi.status).toBe(200);
    }
    expect(service.getAccount).not.toHaveBeenCalled();
    expect(service.createAccountToken).not.toHaveBeenCalled();
    expect(service.revokeAccountToken).not.toHaveBeenCalled();
    expect(service.revokeCurrentWalletSession).not.toHaveBeenCalled();
  });

  it("returns private 404 for absent account and cross-project, browser, or legacy token targets", async () => {
    const missing = Object.assign(new Error("sensitive target detail"), {
      status: 404,
      code: "ACCOUNT_TOKEN_NOT_FOUND",
    });
    const { api } = harness({
      getAccount: vi.fn(async () => {
        throw Object.assign(new Error("sensitive wallet detail"), {
          status: 404,
          code: "ACCOUNT_NOT_FOUND",
        });
      }),
      revokeAccountToken: vi.fn(async () => { throw missing; }),
    });
    const account = await api.fetch(request("/v1/account"));
    expect(account.status).toBe(404);
    expect(await account.json()).toEqual({
      version: "1",
      error: { code: "ACCOUNT_NOT_FOUND", message: "Request rejected" },
    });
    expectPrivate(account);
    for (const tokenId of [TOKEN_ID, `token_${"e".repeat(32)}`, `token_${"f".repeat(32)}`]) {
      const response = await api.fetch(request(`/v1/account/tokens/${tokenId}`, { method: "DELETE" }));
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({
        version: "1",
        error: { code: "ACCOUNT_TOKEN_NOT_FOUND", message: "Request rejected" },
      });
      expectPrivate(response);
      expect(body).not.toContain("sensitive");
    }
  });

  it("fails closed when account service output violates a strict public schema", async () => {
    const malformed = {
      version: "1",
      wallet: { kind: "eoa", address: "0x1111111111111111111111111111111111111111" },
      project: { kind: "default", projectId: PROJECT_ID },
      tokens: [],
      tokenDigest: "private-digest-must-not-echo",
    };
    const cases: Array<[Record<string, unknown>, Request]> = [
      [{ getAccount: vi.fn(async () => malformed) }, request("/v1/account")],
      [{ createAccountToken: vi.fn(async () => ({ ...malformed, token: RAW_TOKEN })) }, request("/v1/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `token_issue_${"8".repeat(64)}` },
        body: JSON.stringify({ version: "1", kind: "cli", label: "CLI", expiresInDays: 30 }),
      })],
      [{ revokeAccountToken: vi.fn(async () => ({ version: "1", tokenId: TOKEN_ID, revoked: true, raw: RAW_TOKEN })) }, request(`/v1/account/tokens/${TOKEN_ID}`, { method: "DELETE" })],
    ];
    for (const [override, apiRequest] of cases) {
      const { api } = harness(override);
      const response = await api.fetch(apiRequest);
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({
        version: "1",
        error: { code: "REQUEST_FAILED", message: "Request could not be completed" },
      });
      expect(body).not.toContain("private-digest");
      expect(body).not.toContain(RAW_TOKEN);
      expectPrivate(response);
    }
  });

  it("fails closed rather than serializing any current-session revocation output", async () => {
    const { api } = harness({
      revokeCurrentWalletSession: vi.fn(async () => ({ token: RAW_TOKEN })),
    });
    const response = await api.fetch(request("/v1/auth/wallet/sessions/current", {
      method: "DELETE",
    }));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      version: "1",
      error: { code: "REQUEST_FAILED", message: "Request could not be completed" },
    });
    expect(body).not.toContain(RAW_TOKEN);
    expectPrivate(response);
  });

  it("preserves stable private idempotency outcomes without returning a secret twice", async () => {
    for (const [code, key] of [
      ["ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED", `token_issue_${"9".repeat(64)}`],
      ["IDEMPOTENCY_CONFLICT", `token_issue_${"a".repeat(64)}`],
    ] as const) {
      const { api } = harness({
        createAccountToken: vi.fn(async () => {
          throw Object.assign(new Error(`raw ${RAW_TOKEN}`), { status: 409, code });
        }),
      });
      const response = await api.fetch(request("/v1/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ version: "1", kind: "cli", label: "CLI", expiresInDays: 30 }),
      }));
      expect(response.status).toBe(409);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({
        version: "1",
        error: { code, message: "Request rejected" },
      });
      expect(body).not.toContain(RAW_TOKEN);
      expectPrivate(response);
    }
  });
});
