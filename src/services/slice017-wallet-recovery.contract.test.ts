// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createRunClient,
  submitWithEip1193,
  type Eip1193Provider,
} from "./run-client";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const TX_HASH = `0x${"9".repeat(64)}`;
const ACCOUNT = "0x5555555555555555555555555555555555555555";
const TRANSACTION = {
  chainId: "0x72" as const,
  to: "0x3333333333333333333333333333333333333333" as const,
  data: "0xfeedcafe" as const,
  value: "0x3039" as const,
};

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type RecoverableSubmit = (input: {
  runId: string;
  idempotencyKey: string;
  provider: Eip1193Provider;
  client: {
    prepareSubmission(runId: string, idempotencyKey: string): Promise<typeof TRANSACTION>;
    attachTransaction(
      runId: string,
      transaction: { transactionHash: string },
      idempotencyKey: string,
    ): Promise<unknown>;
  };
  recoveryStorage: RecoveryStorage;
}) => Promise<{ transactionHash: string }>;

function recoveryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    port: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    },
  };
}

function walletProvider(hash: string | Error = TX_HASH): Eip1193Provider {
  const request = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce([ACCOUNT]);
  if (hash instanceof Error) request.mockRejectedValueOnce(hash);
  else request.mockResolvedValueOnce(hash);
  return { request };
}

describe("Slice 017 wallet broadcast recovery coordinator", () => {
  it("stores a valid broadcast hash before attachment and reload attaches it without rebroadcast", async () => {
    const storage = recoveryStorage();
    const firstProvider = walletProvider();
    const firstClient = {
      prepareSubmission: vi.fn().mockResolvedValue(TRANSACTION),
      attachTransaction: vi.fn(async () => {
        expect([...storage.values.values()]).toContain(TX_HASH);
        throw new Error("attachment transport unavailable");
      }),
    };
    const submit = submitWithEip1193 as RecoverableSubmit;

    await expect(submit({
      runId: RUN_ID,
      idempotencyKey: "wallet-confirm",
      provider: firstProvider,
      client: firstClient,
      recoveryStorage: storage.port,
    })).rejects.toThrow(/attachment transport unavailable/i);
    expect([...storage.values.values()]).toContain(TX_HASH);
    expect(firstProvider.request).toHaveBeenCalledTimes(3);

    const reloadProvider = { request: vi.fn() };
    const reloadClient = {
      prepareSubmission: vi.fn(),
      attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    };
    await expect(submit({
      runId: RUN_ID,
      idempotencyKey: "wallet-confirm",
      provider: reloadProvider,
      client: reloadClient as any,
      recoveryStorage: storage.port,
    })).resolves.toEqual({ transactionHash: TX_HASH });

    expect(reloadProvider.request).not.toHaveBeenCalled();
    expect(reloadClient.prepareSubmission).not.toHaveBeenCalled();
    expect(reloadClient.attachTransaction).toHaveBeenCalledOnce();
    expect(reloadClient.attachTransaction).toHaveBeenCalledWith(
      RUN_ID,
      { transactionHash: TX_HASH },
      "wallet-confirm",
    );
    expect([...storage.values.values()]).not.toContain(TX_HASH);
  });

  it("leaves user rejection retryable and records no recovery value", async () => {
    const storage = recoveryStorage();
    const provider = walletProvider(new Error("user rejected transaction"));
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue(TRANSACTION),
      attachTransaction: vi.fn(),
    };
    await expect((submitWithEip1193 as RecoverableSubmit)({
      runId: RUN_ID,
      idempotencyKey: "wallet-rejected",
      provider,
      client,
      recoveryStorage: storage.port,
    })).rejects.toThrow(/user rejected/i);
    expect(storage.values.size).toBe(0);
    expect(storage.port.setItem).not.toHaveBeenCalled();
    expect(client.attachTransaction).not.toHaveBeenCalled();
  });
});

describe("Slice 017 browser submission response validation", () => {
  function clientReturning(body: unknown) {
    return createRunClient({
      baseUrl: "https://api.proofline.test",
      projectToken: PROJECT_TOKEN,
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      ),
      storage: { getItem: () => null, setItem: () => undefined },
    });
  }

  it("parses the strict wallet response and returns only its validated transaction", async () => {
    await expect(clientReturning({
      version: "1",
      runId: RUN_ID,
      mode: "wallet",
      effectOwner: "wallet",
      transaction: TRANSACTION,
    }).prepareSubmission(RUN_ID, "wallet-valid")).resolves.toEqual(TRANSACTION);
  });

  it.each([
    ["legacy direct transaction", TRANSACTION],
    ["legacy nested transaction", { mode: "wallet", transaction: TRANSACTION }],
    ["wrong run identity", { version: "1", runId: "run_other", mode: "wallet", effectOwner: "wallet", transaction: TRANSACTION }],
    ["wrong effect owner", { version: "1", runId: RUN_ID, mode: "wallet", effectOwner: "worker", transaction: TRANSACTION }],
  ])("fails closed for %s", async (_label, body) => {
    await expect(
      clientReturning(body).prepareSubmission(RUN_ID, "wallet-invalid"),
    ).rejects.toMatchObject({
      status: 502,
      code: "SUBMISSION_RESPONSE_INVALID",
    });
  });
});
