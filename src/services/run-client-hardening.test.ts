// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../packages/contracts/test/fixtures";
import {
  createRunClient,
  submitWithEip1193,
  type WalletTransaction,
} from "./run-client";

const projectToken = `project_${"a".repeat(64)}`;
const transaction: WalletTransaction = {
  chainId: "0x72",
  to: "0x3333333333333333333333333333333333333333",
  data: "0xfeedcafe",
  value: "0x3039",
};
const transactionHash = `0x${"b".repeat(64)}`;
const privateHex = `0x${"d".repeat(64)}`;

function jsonResponse(body: unknown, status = 200, statusText = "") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(fetch: typeof globalThis.fetch, storage?: Pick<Storage, "getItem" | "setItem">) {
  return createRunClient({
    baseUrl: "https://api.proofline.test/v1///",
    projectToken,
    fetch,
    storage: storage ?? { getItem: () => null, setItem: () => undefined },
  });
}

describe("run client storage and response hardening", () => {
  it("continues a run when privacy-mode storage writes throw", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      status: "accepted",
      runId: "run_1",
      location: "/v1/runs/run_1",
    }, 202));
    const client = clientWith(fetch, {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage denied");
      },
    });

    await expect(client.createRun(validManifest, "create-1")).resolves.toEqual({
      status: "accepted",
      runId: "run_1",
      location: "/v1/runs/run_1",
    });
    expect(fetch.mock.calls[0][0]).toBe("https://api.proofline.test/v1/runs");
  });

  it("continues event polling when storage writes throw or cursor regresses", async () => {
    const setItem = vi.fn(() => {
      throw new Error("quota exceeded");
    });
    const client = clientWith(
      vi.fn().mockResolvedValue(jsonResponse({ events: [], nextAfter: 1 })),
      { getItem: () => null, setItem },
    );
    await expect(client.events("run id/encoded", 2)).resolves.toMatchObject({
      nextAfter: 1,
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("returns null or resets an invalid cursor when storage reads fail", () => {
    const denied = clientWith(vi.fn(), {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => undefined,
    });
    expect(denied.resume()).toBeNull();

    const values = new Map([
      ["proofline:last-run", "run_1"],
      ["proofline:run_1:after", "-9"],
    ]);
    const invalid = clientWith(vi.fn(), {
      getItem: (key) => values.get(key) ?? null,
      setItem: () => undefined,
    });
    expect(invalid.resume()).toEqual({ runId: "run_1", after: 0 });
  });

  it.each([
    [{ error: "top-level failure" }, "top-level failure"],
    [{ error: { message: "nested failure" } }, "nested failure"],
    [{ message: "message failure" }, "message failure"],
  ])("surfaces sanitized JSON error detail from %j", async (body, expected) => {
    const client = clientWith(
      vi.fn().mockResolvedValue(jsonResponse(body, 409, "Conflict")),
    );
    await expect(client.getRun("run_1")).rejects.toThrow(expected);
  });

  it("uses HTTP status text for non-JSON errors and redacts bearer material", async () => {
    const response = new Response(`Bearer ${projectToken}`, {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "content-type": "text/plain" },
    });
    const client = clientWith(vi.fn().mockResolvedValue(response));
    const failure = await client.getRun("run_1").catch((cause) => cause);
    expect(String(failure)).toContain("Bad Gateway");
    expect(String(failure)).not.toContain(projectToken);
  });

  it.each([
    [new Error(`Bearer ${projectToken} transport failed`), "transport failed"],
    [`project_${"c".repeat(64)} disconnected`, "disconnected"],
  ])("normalizes and redacts transport failure %j", async (failure, expected) => {
    const client = clientWith(vi.fn().mockRejectedValue(failure));
    const error = await client.getRun("run_1").catch((cause) => cause);
    expect(String(error)).toContain(expected);
    expect(String(error)).not.toMatch(/project_[a-f0-9]{64}/i);
  });

  it("redacts 32-byte hex material from an HTTP error body instead of preserving it as a transaction hash", async () => {
    const client = clientWith(
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { message: `Upstream included ${privateHex}` } },
          502,
          "Bad Gateway",
        ),
      ),
    );

    const failure = await client.getRun("run_1").catch((cause) => cause);
    expect(String(failure)).toContain("[REDACTED]");
    expect(String(failure)).not.toContain(privateHex);
  });

  it("redacts 32-byte hex material from transport errors instead of preserving it as a transaction hash", async () => {
    const client = clientWith(
      vi.fn().mockRejectedValue(new Error(`Transport leaked ${privateHex}`)),
    );

    const failure = await client.getRun("run_1").catch((cause) => cause);
    expect(String(failure)).toContain("[REDACTED]");
    expect(String(failure)).not.toContain(privateHex);
  });

  it("accepts only the strict versioned wallet transaction response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          version: "1",
          runId: "run_1",
          mode: "wallet",
          effectOwner: "wallet",
          transaction,
        }, 202),
      )
      .mockResolvedValueOnce(
        jsonResponse({ mode: "wallet", transaction }, 202),
      );
    const client = clientWith(fetch);

    await expect(client.prepareSubmission("run_1", "submit-1")).resolves.toEqual(
      transaction,
    );
    await expect(client.prepareSubmission("run_1", "submit-2")).rejects.toMatchObject({
      status: 502,
      code: "SUBMISSION_RESPONSE_INVALID",
    });
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("idempotency-key")).toBe(
      "submit-2",
    );
  });

  it("attaches only the transaction hash and URL-encodes the run id", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ accepted: true }, 202));
    const client = clientWith(fetch);
    await client.attachTransaction(
      "run/with spaces",
      { transactionHash },
      "attach-1",
    );
    expect(fetch.mock.calls[0][0]).toContain("/runs/run%2Fwith%20spaces/transactions");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      transactionHash,
    });
  });

  it("rejects malformed replay bytes before network I/O", async () => {
    const fetch = vi.fn();
    const client = clientWith(fetch);
    expect(() => client.replay("{", "replay-1")).toThrow(/valid JSON/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("EIP-1193 wallet failure hardening", () => {
  function client(prepared: WalletTransaction = transaction) {
    return {
      prepareSubmission: vi.fn().mockResolvedValue(prepared),
      attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    };
  }

  it("rejects a transaction prepared for the wrong chain before touching the wallet", async () => {
    const provider = { request: vi.fn() };
    const clientPort = client({ ...transaction, chainId: "0x1" as "0x72" });
    await expect(
      submitWithEip1193({
        runId: "run_1",
        idempotencyKey: "wallet-1",
        provider,
        client: clientPort,
      }),
    ).rejects.toThrow(/other than Coston2/i);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it.each([null, [], [42]])("rejects missing wallet account response %j", async (accounts) => {
    const provider = {
      request: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(accounts),
    };
    const clientPort = client();
    await expect(
      submitWithEip1193({
        runId: "run_1",
        idempotencyKey: "wallet-1",
        provider,
        client: clientPort,
      }),
    ).rejects.toThrow(/account/i);
    expect(clientPort.attachTransaction).not.toHaveBeenCalled();
  });

  it.each([null, 42, "0x1234"])(
    "rejects invalid wallet transaction hash %j",
    async (hash) => {
      const provider = {
        request: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(["0x5555555555555555555555555555555555555555"])
          .mockResolvedValueOnce(hash),
      };
      const clientPort = client();
      await expect(
        submitWithEip1193({
          runId: "run_1",
          idempotencyKey: "wallet-1",
          provider,
          client: clientPort,
        }),
      ).rejects.toThrow(/transaction hash/i);
      expect(clientPort.attachTransaction).not.toHaveBeenCalled();
    },
  );

  it("does not attach anything when wallet transport rejects the send", async () => {
    const provider = {
      request: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(["0x5555555555555555555555555555555555555555"])
        .mockRejectedValueOnce(new Error("user rejected transaction")),
    };
    const clientPort = client();
    await expect(
      submitWithEip1193({
        runId: "run_1",
        idempotencyKey: "wallet-1",
        provider,
        client: clientPort,
      }),
    ).rejects.toThrow(/user rejected/i);
    expect(clientPort.attachTransaction).not.toHaveBeenCalled();
  });
});
