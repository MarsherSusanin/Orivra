// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type {
  AccountTokenCreateRequestV1,
  AccountTokenCreatedV1,
  AccountTokenRevokedV1,
  AccountV1,
  NetworkCapabilitiesV1,
  WalletChallengeRequestV1,
  WalletChallengeV1,
  WalletSessionRequestV1,
  WalletSessionV1,
} from "@proofline/contracts";

const MODULE_PATH = "./wallet-access-client";
const API_BASE_URL = "https://api.proofline.example";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CHALLENGE_ID = `challenge_${"c".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = `token_${"d".repeat(32)}`;
const CREATED_TOKEN = `project_${"e".repeat(64)}`;
const ISSUED_AT = "2026-08-09T00:00:00.000Z";
const CHALLENGE_EXPIRES_AT = "2026-08-09T00:05:00.000Z";
const SESSION_EXPIRES_AT = "2026-08-09T12:00:00.000Z";
const TOKEN_EXPIRES_AT = "2026-09-08T00:00:00.000Z";

type WalletAccessClient = {
  listNetworks(): Promise<NetworkCapabilitiesV1>;
  createWalletChallenge(request: WalletChallengeRequestV1): Promise<WalletChallengeV1>;
  createWalletSession(request: WalletSessionRequestV1): Promise<WalletSessionV1>;
  getAccount(input: { projectToken: string }): Promise<AccountV1>;
  createAccountToken(input: {
    projectToken: string;
    idempotencyKey: string;
    request: AccountTokenCreateRequestV1;
  }): Promise<AccountTokenCreatedV1>;
  revokeAccountToken(input: {
    projectToken: string;
    tokenId: string;
  }): Promise<AccountTokenRevokedV1>;
  revokeCurrentSession(input: { projectToken: string }): Promise<void>;
};

type WalletAccessClientModule = {
  createWalletAccessClient(input: {
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
  }): WalletAccessClient;
};

async function loadModule(): Promise<WalletAccessClientModule> {
  return import(MODULE_PATH) as Promise<WalletAccessClientModule>;
}

function json(body: unknown, status = 200, statusText = "") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

const networks: NetworkCapabilitiesV1 = {
  version: "1",
  networks: [
    {
      version: "1",
      network: "coston2",
      displayName: "Coston2",
      web2JsonStatus: "enabled",
      wallet: {
        chainId: 114,
        chainIdHex: "0x72",
        nativeCurrency: {
          name: "Coston2 Flare",
          symbol: "C2FLR",
          decimals: 18,
        },
        explorerBaseUrl: "https://coston2-explorer.flare.network",
      },
    },
    {
      version: "1",
      network: "flare",
      displayName: "Flare",
      web2JsonStatus: "upstream-unsupported",
      reason: "Web2Json is not available on Flare Mainnet.",
      wallet: {
        chainId: 14,
        chainIdHex: "0xe",
        nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
        explorerBaseUrl: "https://flare-explorer.flare.network",
      },
    },
  ],
};

const challenge: WalletChallengeV1 = {
  version: "1",
  challengeId: CHALLENGE_ID,
  address: ADDRESS,
  purpose: "browser-session",
  network: "coston2",
  chainId: 114,
  message: "proofline server-authored message",
  issuedAt: ISSUED_AT,
  expiresAt: CHALLENGE_EXPIRES_AT,
};

const session: WalletSessionV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: PROJECT_ID },
  projectToken: PROJECT_TOKEN,
  issuedAt: ISSUED_AT,
  expiresAt: SESSION_EXPIRES_AT,
};

const summary = {
  version: "1",
  tokenId: TOKEN_ID,
  kind: "cli",
  label: "Local CLI",
  createdAt: ISSUED_AT,
  expiresAt: TOKEN_EXPIRES_AT,
  revokedAt: null,
} as const;

const account: AccountV1 = {
  version: "1",
  wallet: session.wallet,
  project: session.project,
  tokens: [summary],
};

function expectBrowserTransport(init: RequestInit, method: string) {
  expect(init.method).toBe(method);
  expect(init.credentials).toBe("omit");
  expect(init.mode).toBe("cors");
  expect(init.cache).toBe("no-store");
  expect(init.referrerPolicy).toBe("no-referrer");
}

describe("Slice 023C1 wallet access client", () => {
  it("uses the exact seven V1 routes and only authorizes protected account calls", async () => {
    const { createWalletAccessClient } = await loadModule();
    const responses = [
      json(networks),
      json(challenge, 201),
      json(session, 201),
      json(account),
      json({ version: "1", token: CREATED_TOKEN, item: summary }, 201),
      json({ version: "1", tokenId: TOKEN_ID, revoked: true }),
      new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
      }),
    ];
    const fetch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => responses.shift()!);
    const client = createWalletAccessClient({ baseUrl: `${API_BASE_URL}/v1///`, fetch });

    await client.listNetworks();
    await client.createWalletChallenge({ version: "1", address: ADDRESS });
    await client.createWalletSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });
    await client.getAccount({ projectToken: PROJECT_TOKEN });
    await client.createAccountToken({
      projectToken: PROJECT_TOKEN,
      idempotencyKey: `token_issue_${"1".repeat(64)}`,
      request: { version: "1", kind: "cli", label: "Local CLI", expiresInDays: 30 },
    });
    await client.revokeAccountToken({ projectToken: PROJECT_TOKEN, tokenId: TOKEN_ID });
    await expect(client.revokeCurrentSession({ projectToken: PROJECT_TOKEN })).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(7);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${API_BASE_URL}/v1/networks`,
      `${API_BASE_URL}/v1/auth/wallet/challenges`,
      `${API_BASE_URL}/v1/auth/wallet/sessions`,
      `${API_BASE_URL}/v1/account`,
      `${API_BASE_URL}/v1/account/tokens`,
      `${API_BASE_URL}/v1/account/tokens/${TOKEN_ID}`,
      `${API_BASE_URL}/v1/auth/wallet/sessions/current`,
    ]);

    const expectedMethods = ["GET", "POST", "POST", "GET", "POST", "DELETE", "DELETE"];
    fetch.mock.calls.forEach(([, init = {}], index) => {
      expectBrowserTransport(init, expectedMethods[index]!);
      const headers = new Headers(init.headers);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("authorization")).toBe(
        index < 3 ? null : `Bearer ${PROJECT_TOKEN}`,
      );
      expect(String(fetch.mock.calls[index]?.[0])).not.toContain(PROJECT_TOKEN);
      expect(String(init.body ?? "")).not.toContain(PROJECT_TOKEN);
    });
    expect(new Headers(fetch.mock.calls[4]![1]?.headers).get("idempotency-key")).toBe(
      `token_issue_${"1".repeat(64)}`,
    );
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("idempotency-key")).toBeNull();
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get("idempotency-key")).toBeNull();
    expect(new Headers(fetch.mock.calls[2]![1]?.headers).get("idempotency-key")).toBeNull();
    expect(new Headers(fetch.mock.calls[6]![1]?.headers).get("idempotency-key")).toBeNull();
  });

  it("parses every success through its strict public schema and rejects poisoned output", async () => {
    const { createWalletAccessClient } = await loadModule();
    const poisonedCases: Array<{
      invoke(client: WalletAccessClient): Promise<unknown>;
      value: unknown;
    }> = [
      {
        invoke: (client) => client.listNetworks(),
        value: { ...networks, privateRpcUrl: `https://${PROJECT_TOKEN}@rpc.example` },
      },
      {
        invoke: (client) => client.createWalletChallenge({ version: "1", address: ADDRESS }),
        value: { ...challenge, serverStack: `Bearer ${PROJECT_TOKEN}` },
      },
      {
        invoke: (client) => client.createWalletSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE }),
        value: { ...session, projectToken: SHARE_TOKEN },
      },
      {
        invoke: (client) => client.getAccount({ projectToken: PROJECT_TOKEN }),
        value: { ...account, tokenDigest: PROJECT_TOKEN },
      },
      {
        invoke: (client) => client.createAccountToken({
          projectToken: PROJECT_TOKEN,
          idempotencyKey: `token_issue_${"2".repeat(64)}`,
          request: { version: "1", kind: "action", label: "Release", expiresInDays: 7 },
        }),
        value: { version: "1", token: CREATED_TOKEN, item: { ...summary, raw: PROJECT_TOKEN } },
      },
      {
        invoke: (client) => client.revokeAccountToken({ projectToken: PROJECT_TOKEN, tokenId: TOKEN_ID }),
        value: { version: "1", tokenId: TOKEN_ID, revoked: true, digest: PROJECT_TOKEN },
      },
    ];

    for (const { invoke, value } of poisonedCases) {
      const fetch = vi.fn(async () => json(value));
      const failure = await invoke(createWalletAccessClient({ baseUrl: API_BASE_URL, fetch }))
        .catch((cause: unknown) => cause);
      expect(failure).toMatchObject({
        name: "WalletAccessError",
        kind: "contract",
        status: 502,
        code: "AUTH_RESPONSE_INVALID",
        retryable: false,
      });
      expect(String(failure)).toBe("WalletAccessError: Proofline returned an invalid response.");
      expect(String(failure)).not.toMatch(/project_|share_|Bearer|stack|digest/i);
    }
  });

  it("requires exact project, token-id and issuance-key inputs before network I/O", async () => {
    const { createWalletAccessClient } = await loadModule();
    const fetch = vi.fn();
    const client = createWalletAccessClient({ baseUrl: API_BASE_URL, fetch });

    await expect(client.getAccount({ projectToken: SHARE_TOKEN })).rejects.toMatchObject({
      code: "AUTH_INPUT_INVALID",
    });
    await expect(client.revokeAccountToken({
      projectToken: PROJECT_TOKEN,
      tokenId: "token_wrong",
    })).rejects.toMatchObject({ code: "AUTH_INPUT_INVALID" });
    await expect(client.createAccountToken({
      projectToken: PROJECT_TOKEN,
      idempotencyKey: "token_issue_short",
      request: { version: "1", kind: "cli", label: "CLI", expiresInDays: 30 },
    })).rejects.toMatchObject({ code: "AUTH_INPUT_INVALID" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes HTTP and transport failures without echoing response bodies, tokens, or stacks", async () => {
    const { createWalletAccessClient } = await loadModule();
    const privateText = `Bearer ${PROJECT_TOKEN} stack at private.ts:42`;
    const httpClient = createWalletAccessClient({
      baseUrl: API_BASE_URL,
      fetch: vi.fn(async () => json({
        version: "1",
        error: { code: "REQUEST_FAILED", message: privateText, stack: privateText },
      }, 500, "Internal Server Error")),
    });
    const httpFailure = await httpClient.getAccount({ projectToken: PROJECT_TOKEN })
      .catch((cause: unknown) => cause);
    expect(httpFailure).toMatchObject({
      name: "WalletAccessError",
      kind: "http",
      status: 500,
      code: "REQUEST_FAILED",
      retryable: true,
    });
    expect(String(httpFailure)).toBe("WalletAccessError: Proofline request failed.");

    const transportClient = createWalletAccessClient({
      baseUrl: API_BASE_URL,
      fetch: vi.fn(async () => { throw new Error(privateText); }),
    });
    const transportFailure = await transportClient.listNetworks()
      .catch((cause: unknown) => cause);
    expect(transportFailure).toMatchObject({
      name: "WalletAccessError",
      kind: "transport",
      status: 0,
      code: "TRANSPORT_UNAVAILABLE",
      retryable: true,
    });
    expect(String(transportFailure)).toBe("WalletAccessError: Proofline is unavailable. Retry safely.");
    expect(JSON.stringify([httpFailure, transportFailure])).not.toContain(PROJECT_TOKEN);
    expect(String(httpFailure) + String(transportFailure)).not.toMatch(/Bearer|private\.ts|stack/i);
  });

  it("accepts only an exact empty 204 for current-session revocation", async () => {
    const { createWalletAccessClient } = await loadModule();
    const exact = createWalletAccessClient({
      baseUrl: API_BASE_URL,
      fetch: vi.fn(async () => new Response(null, { status: 204 })),
    });
    await expect(exact.revokeCurrentSession({ projectToken: PROJECT_TOKEN })).resolves.toBeUndefined();

    const wrongStatus = createWalletAccessClient({
      baseUrl: API_BASE_URL,
      fetch: vi.fn(async () => json({ version: "1" }, 200)),
    });
    await expect(wrongStatus.revokeCurrentSession({ projectToken: PROJECT_TOKEN }))
      .rejects.toMatchObject({ kind: "contract", code: "AUTH_RESPONSE_INVALID" });

    const nonempty204 = {
      ok: true,
      status: 204,
      statusText: "",
      headers: new Headers(),
      arrayBuffer: async () => new TextEncoder().encode(PROJECT_TOKEN).buffer,
      text: async () => PROJECT_TOKEN,
      json: async () => ({ token: PROJECT_TOKEN }),
    } as unknown as Response;
    const poisoned = createWalletAccessClient({
      baseUrl: API_BASE_URL,
      fetch: vi.fn(async () => nonempty204),
    });
    const failure = await poisoned.revokeCurrentSession({ projectToken: PROJECT_TOKEN })
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ kind: "contract", code: "AUTH_RESPONSE_INVALID" });
    expect(String(failure)).not.toContain(PROJECT_TOKEN);
  });
});
