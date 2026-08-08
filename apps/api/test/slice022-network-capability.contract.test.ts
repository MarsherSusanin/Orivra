// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";

const projectToken = "project_" + "a".repeat(64);
const shareToken = "share_" + "b".repeat(64);

const capabilities = {
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
        nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
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
} as const;

function request(
  path: string,
  input: {
    method?: string;
    token?: string | null;
    body?: unknown;
    idempotencyKey?: string;
  } = {},
) {
  const headers = new Headers({ accept: "application/json" });
  if (input.token) headers.set("authorization", `Bearer ${input.token}`);
  if (input.body !== undefined) headers.set("content-type", "application/json");
  if (input.idempotencyKey) headers.set("idempotency-key", input.idempotencyKey);
  return new Request(`https://api.proofline.test${path}`, {
    method: input.method ?? "GET",
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
}

function harness() {
  const service = {
    listNetworks: vi.fn().mockResolvedValue(capabilities),
    createRun: vi.fn().mockResolvedValue({
      status: "accepted",
      runId: "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
      location: "/v1/runs/run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
    }),
  };
  const authenticate = vi.fn(async (token: string) => {
    if (token === projectToken) {
      return { kind: "project" as const, projectId: "project_1" };
    }
    if (token === shareToken) {
      return {
        kind: "share" as const,
        projectId: "project_1",
        runId: "run_shared",
      };
    }
    return null;
  });
  return { service, authenticate, api: createProoflineApi({ service, authenticate }) };
}

describe("Slice 022 API capability boundary", () => {
  it("serves network capabilities before bearer authentication", async () => {
    const { api, service, authenticate } = harness();
    const response = await api.fetch(request("/v1/networks"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(capabilities);
    expect(authenticate).not.toHaveBeenCalled();
    expect(service.listNetworks).toHaveBeenCalledOnce();
    expect(service.listNetworks).toHaveBeenCalledWith({});
  });

  it("rejects recognized but disabled Flare before the run service or network I/O", async () => {
    const { api, service } = harness();
    const response = await api.fetch(
      request("/v1/runs", {
        method: "POST",
        token: projectToken,
        idempotencyKey: "create-flare-run",
        body: { manifest: { ...validManifest, network: "flare" } },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      version: "1",
      error: {
        code: "NETWORK_CAPABILITY_DISABLED",
        message: "Request rejected",
      },
    });
    expect(service.createRun).not.toHaveBeenCalled();
  });

  it("keeps unknown networks invalid before the run service", async () => {
    const { api, service } = harness();
    const response = await api.fetch(
      request("/v1/runs", {
        method: "POST",
        token: projectToken,
        idempotencyKey: "create-unknown-run",
        body: { manifest: { ...validManifest, network: "songbird" } },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "INVALID_REQUEST_BODY" },
    });
    expect(service.createRun).not.toHaveBeenCalled();
  });

  it.each(["coston2", "flare"] as const)(
    "preserves share read-only authorization for %s run creation",
    async (network) => {
      const { api, service } = harness();
      const response = await api.fetch(
        request("/v1/runs", {
          method: "POST",
          token: shareToken,
          idempotencyKey: `share-create-${network}`,
          body: { manifest: { ...validManifest, network } },
        }),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "SHARE_READ_ONLY" },
      });
      expect(service.createRun).not.toHaveBeenCalled();
    },
  );
});
