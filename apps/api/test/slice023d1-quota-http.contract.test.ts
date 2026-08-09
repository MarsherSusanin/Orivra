// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { NETWORK_CAPABILITIES_V1 } from "@proofline/contracts";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";

const WEB_ORIGIN = "https://proofline.example";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";

function failure(input: {
  status: 409 | 429;
  code:
    | "WALLET_CHALLENGE_RATE_LIMITED"
    | "PROJECT_RUN_QUOTA_EXHAUSTED"
    | "ACTIVE_LIVE_RUN_LIMIT_REACHED";
  retryAfterSeconds?: unknown;
}) {
  return Object.assign(new Error(`upstream private ${PROJECT_TOKEN}`), input, {
    stack: `private stack ${PROJECT_TOKEN}`,
    address: ADDRESS,
    limit: 999,
  });
}

function harness(overrides: Record<string, unknown>) {
  const service = {
    listNetworks: vi.fn(async () => NETWORK_CAPABILITIES_V1),
    createWalletChallenge: vi.fn(),
    createRun: vi.fn(),
    ...overrides,
  };
  return {
    service,
    api: createProoflineApi({
      service: service as never,
      publicWebOrigin: WEB_ORIGIN,
      authenticate: vi.fn(async () => ({
        kind: "project" as const,
        projectId: "11111111-1111-4111-8111-111111111130",
        credentialKind: "browser" as const,
        tokenId: "22222222-2222-4222-8222-222222222230",
        walletIdentityId: "33333333-3333-4333-8333-333333333330",
      })),
    }),
  };
}

function walletRequest(origin = WEB_ORIGIN) {
  return new Request("https://api.proofline.example/v1/auth/wallet/challenges", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ version: "1", address: ADDRESS }),
  });
}

function runRequest(origin = WEB_ORIGIN) {
  return new Request("https://api.proofline.example/v1/runs", {
    method: "POST",
    headers: {
      authorization: `Bearer ${PROJECT_TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": "quota-http-create",
      origin,
    },
    body: JSON.stringify({ manifest: validManifest }),
  });
}

describe("Slice 023D1 quota HTTP and CORS boundary", () => {
  it("returns one private wallet 429 with bounded retry evidence and no scope leak", async () => {
    const { api } = harness({
      createWalletChallenge: vi.fn(async () => {
        throw failure({
          status: 429,
          code: "WALLET_CHALLENGE_RATE_LIMITED",
          retryAfterSeconds: 4,
        });
      }),
    });
    const response = await api.fetch(walletRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(response.headers.get("access-control-expose-headers")?.split(/,\s*/i))
      .toEqual(expect.arrayContaining(["Location", "Retry-After"]));
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    const body = await response.json();
    expect(body).toEqual({
      version: "1",
      error: { code: "WALLET_CHALLENGE_RATE_LIMITED", message: "Request rejected" },
    });
    expect(JSON.stringify(body)).not.toMatch(/address|limit|digest|window|private|project_/i);
  });

  it("returns daily run 429 with a day-bounded Retry-After", async () => {
    const { api } = harness({
      createRun: vi.fn(async () => {
        throw failure({
          status: 429,
          code: "PROJECT_RUN_QUOTA_EXHAUSTED",
          retryAfterSeconds: 41_584,
        });
      }),
    });
    const response = await api.fetch(runRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("41584");
    expect(response.headers.get("access-control-expose-headers")?.split(/,\s*/i))
      .toEqual(expect.arrayContaining(["Location", "Retry-After"]));
    expect(await response.json()).toEqual({
      version: "1",
      error: { code: "PROJECT_RUN_QUOTA_EXHAUSTED", message: "Request rejected" },
    });
  });

  it("returns the active-live conflict without inventing retry timing", async () => {
    const { api } = harness({
      createRun: vi.fn(async () => {
        throw failure({
          status: 409,
          code: "ACTIVE_LIVE_RUN_LIMIT_REACHED",
          retryAfterSeconds: 10,
        });
      }),
    });
    const response = await api.fetch(runRequest());
    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBe("Location");
    expect(await response.json()).toEqual({
      version: "1",
      error: { code: "ACTIVE_LIVE_RUN_LIMIT_REACHED", message: "Request rejected" },
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fraction", 1.5],
    ["minute overflow", 61],
    ["string", "4"],
    ["header poison", `4\r\nX-Private: ${PROJECT_TOKEN}`],
  ])("drops invalid wallet Retry-After evidence: %s", async (_label, retryAfterSeconds) => {
    const { api } = harness({
      createWalletChallenge: vi.fn(async () => {
        throw failure({
          status: 429,
          code: "WALLET_CHALLENGE_RATE_LIMITED",
          retryAfterSeconds,
        });
      }),
    });
    const response = await api.fetch(walletRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBe("Location");
    expect(JSON.stringify([...response.headers])).not.toContain(PROJECT_TOKEN);
  });

  it("does not grant retry or CORS visibility to the wrong origin", async () => {
    const { api } = harness({
      createWalletChallenge: vi.fn(async () => {
        throw failure({
          status: 429,
          code: "WALLET_CHALLENGE_RATE_LIMITED",
          retryAfterSeconds: 4,
        });
      }),
    });
    const response = await api.fetch(walletRequest("https://evil.example"));
    expect(response.status).toBe(403);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBeNull();
  });
});
