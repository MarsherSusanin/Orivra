// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../packages/contracts/test/fixtures";
import {
  createRunClient,
  submitWithEip1193,
} from "./run-client";

const projectToken = "project_" + "a".repeat(64);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("browser run client", () => {
  it("creates, incrementally watches, verifies, generates, bundles, and replays with one project token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "accepted",
        runId: "run_1",
        location: "/v1/runs/run_1",
      }, 202))
      .mockResolvedValueOnce(jsonResponse({ events: [{ sequence: 2 }], nextAfter: 2 }))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }, 202))
      .mockResolvedValueOnce(jsonResponse({ source: "contract Safe {}", sha256: "a".repeat(64) }))
      .mockResolvedValueOnce(jsonResponse({ version: "1", checksum: `sha256:${"b".repeat(64)}` }))
      .mockResolvedValueOnce(jsonResponse({ runId: "run_replay", byteIdentical: true }, 201));
    const storage = new Map<string, string>();
    const client = createRunClient({
      baseUrl: "https://api.proofline.test",
      projectToken,
      fetch,
      storage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    expect(await client.createRun(validManifest, "create-1")).toEqual({
      status: "accepted",
      runId: "run_1",
      location: "/v1/runs/run_1",
    });
    expect(storage.get("proofline:last-run")).toBe("run_1");
    expect(await client.events("run_1", 1)).toMatchObject({ nextAfter: 2 });
    await client.verifyConsumer("run_1", "verify-1");
    await client.generateConsumer("run_1", "generate-1");
    const bundle = await client.bundle("run_1");
    await client.replay(bundle, "replay-1");

    expect(fetch).toHaveBeenCalledTimes(6);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${projectToken}`);
    }
    expect(fetch.mock.calls[1][0]).toContain("/events?after=1");
  });

  it("resumes the last run and sequence after a reload without repeating a command", () => {
    const storage = new Map([
      ["proofline:last-run", "run_1"],
      ["proofline:run_1:after", "5"],
    ]);
    const client = createRunClient({
      baseUrl: "/api",
      projectToken,
      fetch: vi.fn(),
      storage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    expect(client.resume()).toEqual({ runId: "run_1", after: 5 });
  });

  it("redacts the project token from HTTP errors", async () => {
    const client = createRunClient({
      baseUrl: "https://api.proofline.test",
      projectToken,
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({ error: `Bearer ${projectToken} invalid` }, 401),
      ),
      storage: { getItem: () => null, setItem: () => undefined },
    });
    const error = await client.events("run_1", 0).catch((cause: unknown) => cause);
    expect(String(error)).not.toContain(projectToken);
  });
});

describe("EIP-1193 wallet submission", () => {
  it("switches to chain 114, signs in the wallet, and attaches only the broadcast hash", async () => {
    const provider = {
      request: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(["0x5555555555555555555555555555555555555555"])
        .mockResolvedValueOnce(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
    };
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue({
        chainId: "0x72",
        from: "0x5555555555555555555555555555555555555555",
        to: "0x3333333333333333333333333333333333333333",
        data: "0xfeedcafe",
        value: "0x3039",
      }),
      attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    };

    await expect(
      submitWithEip1193({
        runId: "run_1",
        idempotencyKey: "wallet-1",
        provider,
        client,
      }),
    ).resolves.toMatchObject({
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(provider.request.mock.calls).toEqual([
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: "0x72" }] }],
      [{ method: "eth_requestAccounts" }],
      [
        {
          method: "eth_sendTransaction",
          params: [expect.objectContaining({ chainId: "0x72", data: "0xfeedcafe" })],
        },
      ],
    ]);
    expect(client.attachTransaction).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      "wallet-1",
    );
  });
});
