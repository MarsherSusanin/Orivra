// @vitest-environment node

import { createServer, request as httpRequest, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProoflineApi } from "../src/app";
import { createNodeRequestHandler } from "../src/bootstrap";

const WEB_ORIGIN = "https://proofline.example";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const BROWSER_TOKEN_ID = "33333333-3333-4333-8333-333333333333";
const BROWSER_TOKEN = `project_${"a".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.close();
    await once(server, "close");
  }));
});

async function listen(api: { fetch(request: Request): Promise<Response> }) {
  const server = createServer(createNodeRequestHandler({ api, port: 8080 }));
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  return address.port;
}

async function call(input: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
}) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: input.port,
      method: input.method,
      path: input.path,
      headers: input.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

function apiHarness() {
  const service = {
    revokeCurrentWalletSession: vi.fn(async () => undefined),
    createWalletChallenge: vi.fn(async () => ({
      version: "1",
      challengeId: `challenge_${"b".repeat(64)}`,
      address: ADDRESS,
      purpose: "browser-session",
      network: "coston2",
      chainId: 114,
      message: "unused",
      issuedAt: "2026-08-09T00:00:00.000Z",
      expiresAt: "2026-08-09T00:05:00.000Z",
    })),
  };
  const api = createProoflineApi({
    service,
    publicWebOrigin: WEB_ORIGIN,
    authenticate: vi.fn(async (raw: string) => raw === BROWSER_TOKEN
      ? {
          kind: "project" as const,
          projectId: PROJECT_ID,
          credentialKind: "browser" as const,
          tokenId: BROWSER_TOKEN_ID,
          walletIdentityId: WALLET_ID,
        }
      : null),
  });
  return { api, service };
}

function expectPrivateCors(headers: Record<string, string | string[] | undefined>) {
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
  expect(String(headers.vary).toLowerCase()).toContain("origin");
  expect(headers["access-control-allow-credentials"]).toBeUndefined();
}

describe("Slice 023B2 production Node empty-body boundary", () => {
  it.each([
    ["no content framing", {}],
    ["Content-Length: 0", { "content-length": "0" }],
    ["zero-length chunked", { "transfer-encoding": "chunked" }],
  ])("forwards an empty current-session DELETE with Fetch body null: %s", async (_name, framing) => {
    const { api, service } = apiHarness();
    const port = await listen(api);
    const response = await call({
      port,
      method: "DELETE",
      path: "/v1/auth/wallet/sessions/current",
      headers: {
        origin: WEB_ORIGIN,
        authorization: `Bearer ${BROWSER_TOKEN}`,
        ...framing,
      },
    });
    expect(response.status).toBe(204);
    expect(response.body).toBe("");
    expectPrivateCors(response.headers);
    expect(service.revokeCurrentWalletSession).toHaveBeenCalledOnce();
  });

  it("keeps any nonzero DELETE payload invalid and never reaches revocation", async () => {
    const { api, service } = apiHarness();
    const port = await listen(api);
    const response = await call({
      port,
      method: "DELETE",
      path: "/v1/auth/wallet/sessions/current",
      headers: {
        origin: WEB_ORIGIN,
        authorization: `Bearer ${BROWSER_TOKEN}`,
        "content-length": "1",
      },
      body: "x",
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      version: "1",
      error: { code: "INVALID_REQUEST_BODY", message: "Request rejected" },
    });
    expectPrivateCors(response.headers);
    expect(service.revokeCurrentWalletSession).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", undefined],
    ["invalid JSON", "{"],
  ])("preserves public wallet-auth POST %s behavior", async (_name, body) => {
    const { api, service } = apiHarness();
    const port = await listen(api);
    const response = await call({
      port,
      method: "POST",
      path: "/v1/auth/wallet/challenges",
      headers: {
        origin: WEB_ORIGIN,
        "content-type": "application/json",
        ...(body === undefined ? { "content-length": "0" } : {}),
      },
      body,
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "INVALID_JSON" } });
    expect(service.createWalletChallenge).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"])("keeps %s requests bodyless at the Fetch boundary", async (method) => {
    const seen = vi.fn(async (request: Request) => {
      expect(request.body).toBeNull();
      return new Response(null, { status: 204 });
    });
    const port = await listen({ fetch: seen });
    const response = await call({ port, method, path: "/v1/networks" });
    expect(response.status).toBe(204);
    expect(seen).toHaveBeenCalledOnce();
  });
});
