// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createProoflineApi } from "../src/app";

const WEB_ORIGIN = "https://proofline.example";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CHALLENGE_ID = `challenge_${"a".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;
const PROJECT_TOKEN = `project_${"c".repeat(64)}`;

type ApiFactory = (input: {
  service: Record<string, ReturnType<typeof vi.fn>>;
  authenticate(token: string): Promise<unknown>;
  publicWebOrigin: string;
}) => { fetch(request: Request): Promise<Response> };

function harness() {
  const service = {
    createWalletChallenge: vi.fn().mockResolvedValue({
      version: "1",
      challengeId: CHALLENGE_ID,
      address: ADDRESS,
      purpose: "browser-session",
      network: "coston2",
      chainId: 114,
      message: "server-authored-message",
      issuedAt: "2026-08-09T00:00:00.000Z",
      expiresAt: "2026-08-09T00:05:00.000Z",
    }),
    createWalletSession: vi.fn().mockResolvedValue({
      version: "1",
      wallet: { kind: "eoa", address: ADDRESS },
      project: { kind: "default", projectId: "11111111-1111-4111-8111-111111111111" },
      projectToken: PROJECT_TOKEN,
      issuedAt: "2026-08-09T00:00:00.000Z",
      expiresAt: "2026-08-09T12:00:00.000Z",
    }),
  };
  const authenticate = vi.fn().mockResolvedValue(null);
  const factory = createProoflineApi as unknown as ApiFactory;
  return {
    service,
    authenticate,
    api: factory({ service, authenticate, publicWebOrigin: WEB_ORIGIN }),
  };
}

function request(
  path: string,
  body: unknown,
  input: { origin?: string; idempotencyKey?: string; rawBody?: string } = {},
) {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    origin: input.origin ?? WEB_ORIGIN,
  });
  if (input.idempotencyKey) headers.set("idempotency-key", input.idempotencyKey);
  return new Request(`https://api.proofline.test${path}`, {
    method: "POST",
    headers,
    body: input.rawBody ?? JSON.stringify(body),
  });
}

function expectPrivateResponseHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("Slice 023A public wallet auth route boundary", () => {
  it("creates a challenge before bearer auth and without generic idempotency", async () => {
    const { api, service, authenticate } = harness();
    const response = await api.fetch(request("/v1/auth/wallet/challenges", { version: "1", address: ADDRESS }));
    expect(response.status).toBe(201);
    expectPrivateResponseHeaders(response);
    expect(service.createWalletChallenge).toHaveBeenCalledWith({ version: "1", address: ADDRESS });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("creates a browser session from challengeId and signature only", async () => {
    const { api, service, authenticate } = harness();
    const response = await api.fetch(request("/v1/auth/wallet/sessions", {
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    }));
    expect(response.status).toBe(201);
    expectPrivateResponseHeaders(response);
    expect(service.createWalletSession).toHaveBeenCalledWith({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([
    ["challenge message", "/v1/auth/wallet/challenges", { version: "1", address: ADDRESS, message: "caller" }],
    ["challenge domain", "/v1/auth/wallet/challenges", { version: "1", address: ADDRESS, domain: "caller.example" }],
    ["challenge URI", "/v1/auth/wallet/challenges", { version: "1", address: ADDRESS, uri: "https://caller.example" }],
    ["challenge chain", "/v1/auth/wallet/challenges", { version: "1", address: ADDRESS, chainId: 1 }],
    ["session message", "/v1/auth/wallet/sessions", { version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE, message: "caller" }],
  ])("rejects caller-supplied %s", async (_name, path, body) => {
    const { api, service } = harness();
    const response = await api.fetch(request(path, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST_BODY" } });
    expect(service.createWalletChallenge).not.toHaveBeenCalled();
    expect(service.createWalletSession).not.toHaveBeenCalled();
  });

  it.each([undefined, "https://proofline.example.evil.test", "https://proofline.example/"])(
    "requires the exact configured Origin %s",
    async (origin) => {
      const { api, service } = harness();
      const authRequest = request("/v1/auth/wallet/challenges", { version: "1", address: ADDRESS }, { origin: origin ?? "" });
      if (origin === undefined) authRequest.headers.delete("origin");
      const response = await api.fetch(authRequest);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "AUTH_ORIGIN_FORBIDDEN" } });
      expect(service.createWalletChallenge).not.toHaveBeenCalled();
    },
  );

  it("rejects an unauthenticated auth body above 8 KiB before the service", async () => {
    const { api, service } = harness();
    const response = await api.fetch(request(
      "/v1/auth/wallet/challenges",
      {},
      { rawBody: JSON.stringify({ version: "1", address: ADDRESS, padding: "x".repeat(8_193) }) },
    ));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "REQUEST_BODY_TOO_LARGE" } });
    expect(service.createWalletChallenge).not.toHaveBeenCalled();
  });

  it("keeps every non-auth public route behind existing bearer protection", async () => {
    const { api, authenticate } = harness();
    for (const path of ["/v1/account", "/v1/auth/wallet/unknown", "/v1/runs"]) {
      const response = await api.fetch(new Request(`https://api.proofline.test${path}`));
      expect(response.status).toBe(401);
    }
    expect(authenticate).not.toHaveBeenCalled();
  });
});
