// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_CAPABILITIES_V1 } from "@proofline/contracts";
import {
  WalletAccessError,
  createWalletAccessClient,
} from "./wallet-access-client";

const API_BASE_URL = "https://api.proofline.example";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const TOKEN_ID = `token_${"b".repeat(32)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CHALLENGE_ID = `challenge_${"c".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;
const ATTACKER_MESSAGE = `attacker-message-${PROJECT_TOKEN}`;
const ATTACKER_STACK = `attacker-stack-${PROJECT_TOKEN}`;

function json(body: unknown, status: number, statusText = "") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

function privateError(status: number, code: string, extra: Record<string, unknown> = {}) {
  return json({
    version: "1",
    error: { code, message: `Bearer ${PROJECT_TOKEN} must stay private`, ...extra },
  }, status);
}

async function accountFailure(response: Response): Promise<WalletAccessError> {
  const client = createWalletAccessClient({
    baseUrl: API_BASE_URL,
    fetch: vi.fn(async () => response),
  });
  try {
    await client.getAccount({ projectToken: PROJECT_TOKEN });
    throw new Error("Expected the wallet access request to fail");
  } catch (cause) {
    return cause as WalletAccessError;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Slice 023C1 corrective wallet access boundary", () => {
  it.each([
    "not a URL",
    "ftp://api.proofline.example",
    "https://user:password@api.proofline.example",
    "https://api.proofline.example?token=private",
    "https://api.proofline.example#fragment",
  ])("rejects an unsafe API base before binding or calling fetch: %s", (baseUrl) => {
    const fetch = vi.fn();
    expect(() => createWalletAccessClient({ baseUrl, fetch })).toThrow(
      expect.objectContaining({
        name: "WalletAccessError",
        kind: "input",
        status: 0,
        code: "AUTH_INPUT_INVALID",
        retryable: false,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the default fetch safely and rejects strict request poison before effects", async () => {
    const fetch = vi.fn(async () => json(NETWORK_CAPABILITIES_V1, 200));
    vi.stubGlobal("fetch", fetch);
    const defaultClient = createWalletAccessClient({ baseUrl: `${API_BASE_URL}/v1` });
    await expect(defaultClient.listNetworks()).resolves.toEqual(NETWORK_CAPABILITIES_V1);
    expect(fetch).toHaveBeenCalledOnce();

    const effect = vi.fn();
    const client = createWalletAccessClient({ baseUrl: API_BASE_URL, fetch: effect });
    await expect(client.createWalletChallenge({
      version: "1",
      address: ADDRESS,
      domain: "caller.example",
    } as never)).rejects.toMatchObject({ code: "AUTH_INPUT_INVALID" });
    await expect(client.createWalletSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: "0xwrong",
    })).rejects.toMatchObject({ code: "AUTH_INPUT_INVALID" });
    await expect(client.createAccountToken({
      projectToken: PROJECT_TOKEN,
      idempotencyKey: `token_issue_${"1".repeat(64)}`,
      request: { version: "1", kind: "cli", label: " CLI ", expiresInDays: 30 },
    })).rejects.toMatchObject({ code: "AUTH_INPUT_INVALID" });
    expect(effect).not.toHaveBeenCalled();
  });

  it.each([
    [400, "INVALID_JSON", false],
    [400, "INVALID_REQUEST_BODY", false],
    [400, "IDEMPOTENCY_KEY_REQUIRED", false],
    [400, "INVALID_IDEMPOTENCY_KEY", false],
    [401, "UNAUTHORIZED", false],
    [401, "WALLET_SIGNATURE_INVALID", false],
    [403, "AUTH_ORIGIN_FORBIDDEN", false],
    [403, "ACCOUNT_SESSION_REQUIRED", false],
    [404, "ACCOUNT_NOT_FOUND", false],
    [404, "ACCOUNT_TOKEN_NOT_FOUND", false],
    [409, "CHALLENGE_UNAVAILABLE", false],
    [409, "ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED", false],
    [409, "IDEMPOTENCY_CONFLICT", false],
    [413, "REQUEST_BODY_TOO_LARGE", false],
    [500, "REQUEST_FAILED", true],
  ] as const)(
    "exposes only enumerated status-compatible code %s/%s",
    async (status, code, retryable) => {
      const failure = await accountFailure(privateError(status, code));
      expect(failure).toMatchObject({
        name: "WalletAccessError",
        kind: "http",
        status,
        code,
        retryable,
      });
      expect(String(failure)).toBe("WalletAccessError: Proofline request failed.");
      expect(JSON.stringify(failure)).not.toContain(PROJECT_TOKEN);
    },
  );

  it.each([
    ["unknown", 500, { version: "1", error: { code: "UNKNOWN_SERVER_CODE", message: "private" } }],
    ["overlong", 500, { version: "1", error: { code: "A".repeat(129), message: "private" } }],
    ["secret-shaped", 500, { version: "1", error: { code: `PROJECT_${"A".repeat(64)}`, message: "private" } }],
    ["lowercase", 500, { version: "1", error: { code: "request_failed", message: "private" } }],
    ["status-mismatch", 500, { version: "1", error: { code: "UNAUTHORIZED", message: "private" } }],
    ["array-error", 500, { version: "1", error: ["REQUEST_FAILED"] }],
    ["array-body", 500, ["REQUEST_FAILED"]],
    ["null-body", 500, null],
  ] as const)(
    "falls back to HTTP status for %s poison",
    async (_name, status, body) => {
      const attackerBytes = JSON.stringify(body);
      const failure = await accountFailure(json(body, status));
      expect(failure).toEqual(expect.objectContaining({
        name: "WalletAccessError",
        kind: "http",
        status,
        code: `HTTP_${status}`,
        retryable: true,
      }));
      expect(String(failure)).toBe("WalletAccessError: Proofline request failed.");
      const publicFailure = JSON.stringify(failure);
      expect(publicFailure).not.toContain(PROJECT_TOKEN);
      expect(publicFailure).not.toContain(`PROJECT_${"A".repeat(64)}`);
      if (attackerBytes.includes("UNKNOWN_SERVER_CODE")) {
        expect(publicFailure).not.toContain("UNKNOWN_SERVER_CODE");
      }
    },
  );

  it.each([
    ["nested extras", {
      version: "1",
      error: {
        code: "REQUEST_FAILED",
        message: ATTACKER_MESSAGE,
        stack: ATTACKER_STACK,
        secret: PROJECT_TOKEN,
      },
    }],
    ["root extras", {
      version: "1",
      error: { code: "REQUEST_FAILED", message: ATTACKER_MESSAGE },
      stack: ATTACKER_STACK,
      secret: PROJECT_TOKEN,
    }],
    ["missing version", {
      error: {
        code: "REQUEST_FAILED",
        message: ATTACKER_MESSAGE,
        stack: ATTACKER_STACK,
      },
    }],
  ] as const)(
    "preserves a safe allowlisted code while discarding %s",
    async (_name, body) => {
      const failure = await accountFailure(json(body, 500));
      expect(failure).toMatchObject({
        name: "WalletAccessError",
        kind: "http",
        status: 500,
        code: "REQUEST_FAILED",
        retryable: true,
      });
      expect(String(failure)).toBe("WalletAccessError: Proofline request failed.");
      const exposed = [
        failure.message,
        failure.code,
        failure.stack ?? "",
        JSON.stringify(failure),
      ].join("\n");
      expect(exposed).not.toContain(ATTACKER_MESSAGE);
      expect(exposed).not.toContain(ATTACKER_STACK);
      expect(exposed).not.toContain(PROJECT_TOKEN);
      expect((failure as unknown as Record<string, unknown>).secret).toBeUndefined();
    },
  );

  it("uses status-derived retry evidence for malformed and unenumerated HTTP failures", async () => {
    for (const [status, retryable] of [[400, false], [408, true], [429, true], [503, true]] as const) {
      const response = new Response("not-json", { status, statusText: "private stack" });
      const failure = await accountFailure(response);
      expect(failure).toMatchObject({ code: `HTTP_${status}`, retryable });
      expect(String(failure)).not.toMatch(/not-json|private stack/i);
    }
  });

  it("fails closed when a successful body or exact-204 reader throws", async () => {
    const malformedSuccess = {
      ok: true,
      status: 200,
      statusText: "",
      headers: new Headers(),
      json: vi.fn(async () => { throw new Error(`parse ${PROJECT_TOKEN}`); }),
    } as unknown as Response;
    const list = createWalletAccessClient({
      baseUrl: API_BASE_URL,
      fetch: vi.fn(async () => malformedSuccess),
    });
    await expect(list.listNetworks()).rejects.toMatchObject({
      kind: "contract",
      code: "AUTH_RESPONSE_INVALID",
    });

    const unreadable204 = {
      ok: true,
      status: 204,
      statusText: "",
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => { throw new Error(`read ${PROJECT_TOKEN}`); }),
    } as unknown as Response;
    const revoke = createWalletAccessClient({
      baseUrl: API_BASE_URL,
      fetch: vi.fn(async () => unreadable204),
    });
    const failure = await revoke.revokeCurrentSession({ projectToken: PROJECT_TOKEN })
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ kind: "contract", code: "AUTH_RESPONSE_INVALID" });
    expect(String(failure)).not.toContain(PROJECT_TOKEN);
  });

  it("keeps transport exceptions fixed and validates token-id before DELETE", async () => {
    const fetch = vi.fn(async () => { throw new Error(`stack Bearer ${PROJECT_TOKEN}`); });
    const client = createWalletAccessClient({ baseUrl: API_BASE_URL, fetch });
    await expect(client.listNetworks()).rejects.toEqual(expect.objectContaining({
      kind: "transport",
      status: 0,
      code: "TRANSPORT_UNAVAILABLE",
      retryable: true,
    }));
    await expect(client.revokeAccountToken({
      projectToken: PROJECT_TOKEN,
      tokenId: `${TOKEN_ID}extra`,
    })).rejects.toMatchObject({ code: "AUTH_INPUT_INVALID" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
