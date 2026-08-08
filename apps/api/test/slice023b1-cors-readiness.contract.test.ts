// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { NETWORK_CAPABILITIES_V1 } from "@proofline/contracts";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";

const WEB_ORIGIN = "https://proofline.example";
const PROJECT_TOKEN = `project_${"c".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CHALLENGE_ID = `challenge_${"a".repeat(64)}`;
const RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const ALLOWED_METHODS = ["GET", "POST", "DELETE"];
const ALLOWED_HEADERS = [
  "accept",
  "content-type",
  "authorization",
  "idempotency-key",
];

function harness() {
  const service = {
    listNetworks: vi.fn(async () => NETWORK_CAPABILITIES_V1),
    createWalletChallenge: vi.fn(async () => ({
      version: "1",
      challengeId: CHALLENGE_ID,
      address: ADDRESS,
      purpose: "browser-session",
      network: "coston2",
      chainId: 114,
      message: "server-authored-message",
      issuedAt: "2026-08-09T00:00:00.000Z",
      expiresAt: "2026-08-09T00:05:00.000Z",
    })),
    listRuns: vi.fn(async () => ({ version: "1", runs: [], nextCursor: null })),
    createRun: vi.fn(async () => ({
      status: "accepted",
      runId: RUN_ID,
      location: `/v1/runs/${RUN_ID}`,
    })),
  };
  const authenticate = vi.fn(async (token: string) =>
    token === PROJECT_TOKEN
      ? { kind: "project" as const, projectId: "11111111-1111-4111-8111-111111111111" }
      : null
  );
  return {
    service,
    authenticate,
    api: createProoflineApi({ service, authenticate, publicWebOrigin: WEB_ORIGIN }),
  };
}

function set(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function expectAllowedOrigin(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  expect(set(response.headers.get("vary"))).toContain("origin");
  expect(set(response.headers.get("access-control-expose-headers"))).toContain("location");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
}

function preflight(input: {
  path?: string;
  origin?: string;
  method?: string;
  headers?: string;
}) {
  const headers = new Headers();
  if (input.origin !== undefined) headers.set("origin", input.origin);
  if (input.method !== undefined) {
    headers.set("access-control-request-method", input.method);
  }
  if (input.headers !== undefined) {
    headers.set("access-control-request-headers", input.headers);
  }
  return new Request(`https://api.proofline.example${input.path ?? "/v1/runs"}`, {
    method: "OPTIONS",
    headers,
  });
}

describe("Slice 023B1 exact-origin CORS composition", () => {
  it.each([
    ["GET", "accept, authorization"],
    ["POST", "Accept, Content-Type, Authorization, Idempotency-Key"],
    ["DELETE", "authorization"],
  ])("answers allowed-origin %s preflight before bearer middleware", async (method, headers) => {
    const { api, authenticate, service } = harness();
    const response = await api.fetch(preflight({
      origin: WEB_ORIGIN,
      method,
      headers,
    }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectAllowedOrigin(response);
    expect(set(response.headers.get("access-control-allow-methods"))).toEqual(
      new Set(ALLOWED_METHODS.map((value) => value.toLowerCase())),
    );
    expect(set(response.headers.get("access-control-allow-headers"))).toEqual(
      new Set(ALLOWED_HEADERS),
    );
    expect(authenticate).not.toHaveBeenCalled();
    expect(Object.values(service).every((port) => port.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    ["missing origin", undefined, "POST", "content-type"],
    ["wrong origin", "https://proofline.example.evil.test", "POST", "content-type"],
    ["unapproved method", WEB_ORIGIN, "PATCH", "content-type"],
    ["unapproved header", WEB_ORIGIN, "POST", "content-type, x-private-key"],
  ])("fails closed for %s preflight without CORS authority", async (_name, origin, method, headers) => {
    const { api, authenticate, service } = harness();
    const response = await api.fetch(preflight({ origin, method, headers }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      version: "1",
      error: {
        code: "CORS_PREFLIGHT_FORBIDDEN",
        message: "Request rejected",
      },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
    expect(Object.values(service).every((port) => port.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    ["networks", () => new Request("https://api.proofline.example/v1/networks", {
      headers: { origin: WEB_ORIGIN, accept: "application/json" },
    }), 200],
    ["wallet auth", () => new Request("https://api.proofline.example/v1/auth/wallet/challenges", {
      method: "POST",
      headers: { origin: WEB_ORIGIN, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ version: "1", address: ADDRESS }),
    }), 201],
    ["protected success", () => new Request("https://api.proofline.example/v1/runs", {
      headers: { origin: WEB_ORIGIN, accept: "application/json", authorization: `Bearer ${PROJECT_TOKEN}` },
    }), 200],
    ["protected rejection", () => new Request("https://api.proofline.example/v1/runs", {
      headers: { origin: WEB_ORIGIN, accept: "application/json" },
    }), 401],
    ["location response", () => new Request("https://api.proofline.example/v1/runs", {
      method: "POST",
      headers: {
        origin: WEB_ORIGIN,
        accept: "application/json",
        authorization: `Bearer ${PROJECT_TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "cors-create-run",
      },
      body: JSON.stringify({ manifest: validManifest }),
    }), 202],
  ] as const)("adds exact-origin CORS to %s actual response", async (_name, request, status) => {
    const { api } = harness();
    const response = await api.fetch(request());
    expect(response.status).toBe(status);
    expectAllowedOrigin(response);
  });

  it("preserves server-to-server no-Origin behavior without granting browser authority", async () => {
    const { api } = harness();
    const networks = await api.fetch(new Request("https://api.proofline.example/v1/networks"));
    expect(networks.status).toBe(200);
    expect(networks.headers.get("access-control-allow-origin")).toBeNull();

    const protectedResponse = await api.fetch(new Request("https://api.proofline.example/v1/runs", {
      headers: { authorization: `Bearer ${PROJECT_TOKEN}` },
    }));
    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.headers.get("access-control-allow-origin")).toBeNull();

    const authResponse = await api.fetch(new Request(
      "https://api.proofline.example/v1/auth/wallet/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "1", address: ADDRESS }),
      },
    ));
    expect(authResponse.status).toBe(403);
    expect(await authResponse.json()).toMatchObject({
      error: { code: "AUTH_ORIGIN_FORBIDDEN" },
    });
    expect(authResponse.headers.get("access-control-allow-origin")).toBeNull();
  });
});
