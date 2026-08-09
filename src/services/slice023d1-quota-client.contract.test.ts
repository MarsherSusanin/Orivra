// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../packages/contracts/test/fixtures";
import {
  WalletAccessError,
  createWalletAccessClient,
} from "./wallet-access-client";
import {
  ProoflineClientError,
  createRunClient,
} from "./run-client";

const API_BASE_URL = "https://api.proofline.example";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ATTACKER = `private-${PROJECT_TOKEN}`;

function quotaResponse(input: {
  status: 409 | 429;
  code: string;
  retryAfter?: string;
}) {
  return new Response(JSON.stringify({
    version: "1",
    error: {
      code: input.code,
      message: ATTACKER,
      stack: ATTACKER,
      secret: PROJECT_TOKEN,
    },
    secret: PROJECT_TOKEN,
  }), {
    status: input.status,
    statusText: ATTACKER,
    headers: {
      "content-type": "application/json",
      ...(input.retryAfter === undefined ? {} : { "retry-after": input.retryAfter }),
    },
  });
}

async function walletFailure(response: Response): Promise<WalletAccessError> {
  const client = createWalletAccessClient({
    baseUrl: API_BASE_URL,
    fetch: vi.fn(async () => response),
  });
  try {
    await client.createWalletChallenge({ version: "1", address: ADDRESS });
  } catch (cause) {
    return cause as WalletAccessError;
  }
  throw new Error("Expected wallet challenge quota failure");
}

async function runFailure(response: Response): Promise<ProoflineClientError> {
  const client = createRunClient({
    baseUrl: API_BASE_URL,
    projectToken: PROJECT_TOKEN,
    fetch: vi.fn(async () => response),
    storage: { getItem: () => null, setItem: () => undefined },
  });
  try {
    await client.createRun(validManifest, "quota-client-create");
  } catch (cause) {
    return cause as ProoflineClientError;
  }
  throw new Error("Expected create-run quota failure");
}

function exposedFailure(failure: Error): string {
  return [
    failure.message,
    failure.stack ?? "",
    JSON.stringify(failure),
    String(failure),
  ].join("\n");
}

describe("Slice 023D1 wallet quota client", () => {
  it("allowlists only wallet 429 and exposes a canonical minute-bounded delay", async () => {
    const failure = await walletFailure(quotaResponse({
      status: 429,
      code: "WALLET_CHALLENGE_RATE_LIMITED",
      retryAfter: "4",
    }));
    expect(failure).toMatchObject({
      name: "WalletAccessError",
      kind: "http",
      status: 429,
      code: "WALLET_CHALLENGE_RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 4,
    });
    expect(String(failure)).toBe("WalletAccessError: Proofline request failed.");
    expect(exposedFailure(failure)).not.toContain(ATTACKER);
    expect(exposedFailure(failure)).not.toContain(PROJECT_TOKEN);
  });

  it.each([
    ["zero", "0"],
    ["leading zero", "04"],
    ["overflow", "61"],
    ["fraction", "1.5"],
    ["HTTP date", "Sun, 09 Aug 2026 12:35:00 GMT"],
    ["overlong", "9".repeat(129)],
  ])("drops hostile wallet Retry-After without echo: %s", async (_label, retryAfter) => {
    const failure = await walletFailure(quotaResponse({
      status: 429,
      code: "WALLET_CHALLENGE_RATE_LIMITED",
      retryAfter,
    }));
    expect(failure).toMatchObject({ code: "WALLET_CHALLENGE_RATE_LIMITED" });
    expect((failure as unknown as { retryAfterSeconds?: unknown }).retryAfterSeconds)
      .toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(retryAfter);
    expect(exposedFailure(failure)).not.toContain("private-");
    expect(exposedFailure(failure)).not.toContain(PROJECT_TOKEN);
  });

  it("rejects the quota code at a status it does not authorize", async () => {
    const failure = await walletFailure(quotaResponse({
      status: 409,
      code: "WALLET_CHALLENGE_RATE_LIMITED",
      retryAfter: "4",
    }));
    expect(failure).toMatchObject({
      status: 409,
      code: "HTTP_409",
    });
    expect((failure as unknown as { retryAfterSeconds?: unknown }).retryAfterSeconds)
      .toBeUndefined();
    expect(exposedFailure(failure)).not.toContain(ATTACKER);
  });
});

describe("Slice 023D1 run quota client", () => {
  it.each([
    "IDEMPOTENCY_CONFLICT",
    "NETWORK_CAPABILITY_DISABLED",
  ])("preserves the accepted sanitized 409 create-run outcome %s", async (code) => {
    const failure = await runFailure(quotaResponse({ status: 409, code }));
    expect(failure).toMatchObject({
      name: "ProoflineClientError",
      status: 409,
      code,
    });
    expect(String(failure)).toBe(
      "ProoflineClientError: Proofline run creation failed.",
    );
    expect((failure as unknown as { retryAfterSeconds?: unknown }).retryAfterSeconds)
      .toBeUndefined();
    expect(exposedFailure(failure)).not.toContain(ATTACKER);
    expect(exposedFailure(failure)).not.toContain(PROJECT_TOKEN);
  });

  it("normalizes daily quota with fixed copy and a canonical day-bounded delay", async () => {
    const failure = await runFailure(quotaResponse({
      status: 429,
      code: "PROJECT_RUN_QUOTA_EXHAUSTED",
      retryAfter: "41584",
    }));
    expect(failure).toMatchObject({
      name: "ProoflineClientError",
      status: 429,
      code: "PROJECT_RUN_QUOTA_EXHAUSTED",
      retryAfterSeconds: 41_584,
    });
    expect(String(failure)).toBe(
      "ProoflineClientError: Proofline run creation is rate limited. Retry safely.",
    );
    expect(exposedFailure(failure)).not.toContain(ATTACKER);
    expect(exposedFailure(failure)).not.toContain(PROJECT_TOKEN);
  });

  it("normalizes the active-live cap without fake retry evidence", async () => {
    const failure = await runFailure(quotaResponse({
      status: 409,
      code: "ACTIVE_LIVE_RUN_LIMIT_REACHED",
      retryAfter: "10",
    }));
    expect(failure).toMatchObject({
      name: "ProoflineClientError",
      status: 409,
      code: "ACTIVE_LIVE_RUN_LIMIT_REACHED",
    });
    expect((failure as unknown as { retryAfterSeconds?: unknown }).retryAfterSeconds)
      .toBeUndefined();
    expect(String(failure)).toBe(
      "ProoflineClientError: Proofline has reached the active live-run limit.",
    );
    expect(exposedFailure(failure)).not.toContain(ATTACKER);
  });

  it.each([
    ["zero", "0"],
    ["leading zero", "086400"],
    ["overflow", "86401"],
    ["fraction", "2.5"],
    ["HTTP date", "Mon, 10 Aug 2026 00:00:00 GMT"],
    ["overlong", "8".repeat(129)],
  ])("drops hostile daily Retry-After without echo: %s", async (_label, retryAfter) => {
    const failure = await runFailure(quotaResponse({
      status: 429,
      code: "PROJECT_RUN_QUOTA_EXHAUSTED",
      retryAfter,
    }));
    expect(failure).toMatchObject({ code: "PROJECT_RUN_QUOTA_EXHAUSTED" });
    expect((failure as unknown as { retryAfterSeconds?: unknown }).retryAfterSeconds)
      .toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(retryAfter);
    expect(exposedFailure(failure)).not.toContain(PROJECT_TOKEN);
  });

  it.each([
    [409, "PROJECT_RUN_QUOTA_EXHAUSTED", "HTTP_409"],
    [429, "ACTIVE_LIVE_RUN_LIMIT_REACHED", "HTTP_429"],
    [429, "WALLET_CHALLENGE_RATE_LIMITED", "HTTP_429"],
    [429, "IDEMPOTENCY_CONFLICT", "HTTP_429"],
    [429, "NETWORK_CAPABILITY_DISABLED", "HTTP_429"],
    [409, "UPSTREAM_PRIVATE_FAILURE", "HTTP_409"],
    [409, "not_a_canonical_code", "HTTP_409"],
  ] as const)(
    "fails closed for unknown or status/surface-incompatible create evidence %s/%s",
    async (status, code, expectedCode) => {
      const failure = await runFailure(quotaResponse({ status, code }));
      expect(failure).toMatchObject({ status, code: expectedCode });
      expect(exposedFailure(failure)).not.toContain("private-");
      expect(exposedFailure(failure)).not.toContain(ATTACKER);
      expect(exposedFailure(failure)).not.toContain(PROJECT_TOKEN);
    },
  );
});
