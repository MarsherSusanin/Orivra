// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import * as RunClientModule from "./run-client";
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
type ReconcileWalletSubmission = (input: {
  runId: string;
  idempotencyKey: string;
  events: ReadonlyArray<{
    type: string;
    payload: Record<string, unknown>;
  }>;
  recoveryStorage: RecoveryStorage;
}) => { cleared: boolean; transactionHash?: string };
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
  it("keeps a valid broadcast hash after HTTP attachment until persisted journal reconciliation", async () => {
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
    expect([...storage.values.values()]).toContain(TX_HASH);
    expect(storage.port.removeItem).not.toHaveBeenCalled();

    // Public RED contract: HTTP 202 is only command acceptance. The marker may
    // be cleared solely after a persisted REQUEST_SUBMITTED event proves that
    // the exact hash reached the append-only run journal.
    const reconcileWalletSubmission = (
      RunClientModule as unknown as {
        reconcileWalletSubmission?: ReconcileWalletSubmission;
      }
    ).reconcileWalletSubmission;
    expect(reconcileWalletSubmission).toBeTypeOf("function");
    expect(reconcileWalletSubmission!({
      runId: RUN_ID,
      idempotencyKey: "wallet-confirm",
      recoveryStorage: storage.port,
      events: [
        {
          type: "REQUEST_SUBMITTED",
          payload: {
            mode: "wallet",
            transactionHash: `0x${"8".repeat(64)}`,
          },
        },
      ],
    })).toEqual({ cleared: false, transactionHash: TX_HASH });
    expect([...storage.values.values()]).toContain(TX_HASH);
    expect(reconcileWalletSubmission!({
      runId: RUN_ID,
      idempotencyKey: "wallet-confirm",
      recoveryStorage: storage.port,
      events: [
        {
          type: "REQUEST_SUBMITTED",
          payload: { mode: "wallet", transactionHash: TX_HASH },
        },
      ],
    })).toEqual({ cleared: true, transactionHash: TX_HASH });
    expect([...storage.values.values()]).not.toContain(TX_HASH);
  });

  it("proves recovery storage is writable before eth_sendTransaction", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }) => {
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_requestAccounts") return [ACCOUNT];
        if (method === "eth_sendTransaction") return TX_HASH;
        throw new Error(`Unexpected wallet method ${method}`);
      }),
    };
    const recoveryStorage: RecoveryStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("storage denied", "SecurityError");
      }),
      removeItem: vi.fn(),
    };
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue(TRANSACTION),
      attachTransaction: vi.fn(),
    };

    await expect((submitWithEip1193 as RecoverableSubmit)({
      runId: RUN_ID,
      idempotencyKey: "wallet-storage-denied",
      provider,
      client,
      recoveryStorage,
    })).rejects.toThrow(/storage|recovery|persist/i);

    expect(recoveryStorage.setItem).toHaveBeenCalled();
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_sendTransaction" }),
    );
    expect(client.attachTransaction).not.toHaveBeenCalled();
  });

  it("single-flights concurrent confirmation for one run and idempotency key", async () => {
    const storage = recoveryStorage();
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }) => {
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_requestAccounts") return [ACCOUNT];
        if (method === "eth_sendTransaction") return TX_HASH;
        throw new Error(`Unexpected wallet method ${method}`);
      }),
    };
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue(TRANSACTION),
      attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    };
    const submit = submitWithEip1193 as RecoverableSubmit;
    const input = {
      runId: RUN_ID,
      idempotencyKey: "wallet-concurrent",
      provider,
      client,
      recoveryStorage: storage.port,
    };

    await expect(Promise.all([submit(input), submit(input)])).resolves.toEqual([
      { transactionHash: TX_HASH },
      { transactionHash: TX_HASH },
    ]);
    expect(client.prepareSubmission).toHaveBeenCalledOnce();
    expect(provider.request).toHaveBeenCalledTimes(3);
    expect(client.attachTransaction).toHaveBeenCalledOnce();
    expect([...storage.values.values()]).toContain(TX_HASH);
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
    expect(storage.port.setItem).toHaveBeenCalledOnce();
    const [recoveryKey, marker] = storage.port.setItem.mock.calls[0]!;
    expect(marker).toBe("wallet-broadcast-pending");
    expect(storage.port.removeItem).toHaveBeenCalledWith(recoveryKey);
    expect(storage.values.size).toBe(0);
    expect([...storage.values.values()]).not.toContain(marker);
    expect([...storage.values.values()]).not.toContain(TX_HASH);
    expect(client.attachTransaction).not.toHaveBeenCalled();
  });

  it("recognizes EIP-1193 code 4001 as user rejection and lets the same run retry", async () => {
    const storage = recoveryStorage();
    const rejection = Object.assign(new Error("Request denied by provider"), {
      code: 4001,
    });
    const rejectedProvider = walletProvider(rejection);
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue(TRANSACTION),
      attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    };
    const submit = submitWithEip1193 as RecoverableSubmit;
    const common = {
      runId: RUN_ID,
      idempotencyKey: "wallet-code-4001",
      client,
      recoveryStorage: storage.port,
    };

    await expect(
      submit({ ...common, provider: rejectedProvider }),
    ).rejects.toMatchObject({ code: 4001 });
    const [recoveryKey, marker] = storage.port.setItem.mock.calls[0]!;
    expect(marker).toBe("wallet-broadcast-pending");
    expect(storage.port.removeItem).toHaveBeenCalledWith(recoveryKey);
    expect(storage.values.size).toBe(0);
    expect(client.attachTransaction).not.toHaveBeenCalled();

    const retryProvider = walletProvider();
    await expect(
      submit({ ...common, provider: retryProvider }),
    ).resolves.toEqual({ transactionHash: TX_HASH });
    expect(client.prepareSubmission).toHaveBeenCalledTimes(2);
    expect(retryProvider.request).toHaveBeenCalledTimes(3);
    expect(client.attachTransaction).toHaveBeenCalledExactlyOnceWith(
      RUN_ID,
      { transactionHash: TX_HASH },
      "wallet-code-4001",
    );
  });

  it("keeps the pending marker for non-4001 ambiguous provider failures and refuses rebroadcast", async () => {
    const storage = recoveryStorage();
    const ambiguousFailure = Object.assign(new Error("Provider unavailable"), {
      code: -32603,
    });
    const firstProvider = walletProvider(ambiguousFailure);
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue(TRANSACTION),
      attachTransaction: vi.fn(),
    };
    const submit = submitWithEip1193 as RecoverableSubmit;
    const common = {
      runId: RUN_ID,
      idempotencyKey: "wallet-ambiguous",
      client,
      recoveryStorage: storage.port,
    };

    await expect(
      submit({ ...common, provider: firstProvider }),
    ).rejects.toMatchObject({ code: -32603 });
    expect([...storage.values.values()]).toContain(
      "wallet-broadcast-pending",
    );
    expect(storage.port.removeItem).not.toHaveBeenCalled();
    expect(client.attachTransaction).not.toHaveBeenCalled();

    const retryProvider = walletProvider();
    await expect(
      submit({ ...common, provider: retryProvider }),
    ).rejects.toThrow(/ambiguous|refusing to rebroadcast/i);
    expect(retryProvider.request).not.toHaveBeenCalled();
    expect(client.prepareSubmission).toHaveBeenCalledOnce();
    expect(client.attachTransaction).not.toHaveBeenCalled();
  });

  it("keeps the pending marker when eth_sendTransaction resolves with a malformed hash and refuses rebroadcast", async () => {
    const storage = recoveryStorage();
    const malformedProvider = walletProvider("0x1234");
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue(TRANSACTION),
      attachTransaction: vi.fn(),
    };
    const submit = submitWithEip1193 as RecoverableSubmit;
    const common = {
      runId: RUN_ID,
      idempotencyKey: "wallet-malformed-hash",
      client,
      recoveryStorage: storage.port,
    };

    await expect(
      submit({ ...common, provider: malformedProvider }),
    ).rejects.toThrow(/valid transaction hash/i);
    expect([...storage.values.values()]).toContain(
      "wallet-broadcast-pending",
    );
    expect(storage.port.removeItem).not.toHaveBeenCalled();
    expect(client.attachTransaction).not.toHaveBeenCalled();

    const retryProvider = walletProvider();
    await expect(
      submit({ ...common, provider: retryProvider }),
    ).rejects.toThrow(/ambiguous|refusing to rebroadcast/i);
    expect(retryProvider.request).not.toHaveBeenCalled();
    expect(client.prepareSubmission).toHaveBeenCalledOnce();
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
