// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createLiveCoston2PipelinePorts } from "../src/live-runtime";
import { testLiveCoston2RuntimeConfig } from "./live-runtime-config.fixture";

const transactionHash = `0x${"1".repeat(64)}`;
const blockHash = `0x${"2".repeat(64)}`;

function recoveryPorts(overrides: Record<string, unknown> = {}) {
  const publicClient = {
    readContract: vi.fn(),
    getTransaction: vi.fn().mockResolvedValue({ hash: transactionHash }),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: "success",
      blockHash,
    }),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1_747_308_251n }),
    ...overrides,
  };
  const ports = createLiveCoston2PipelinePorts({
    runtimeConfig: testLiveCoston2RuntimeConfig({
      receiptPollTimeoutMs: 5_000,
    }),
    verifier: { prepareRequest: vi.fn() },
    dependencies: {
      createPublicClient: vi.fn(() => publicClient),
      createWalletClient: vi.fn(() => ({ signTransaction: vi.fn() })),
      createDaClient: vi.fn(() => ({ getProof: vi.fn() })),
      lookup: vi.fn(),
      dispatch: vi.fn(),
      transformJq: vi.fn(),
    },
  });
  return { ports, publicClient };
}

describe("Slice 005 relayer recovery ports", () => {
  it("derives a deterministic transaction identity only from canonical bytes", () => {
    const { ports } = recoveryPorts();

    expect(ports.deriveTransactionHash("0x02f8")).toMatch(/^0x[a-f0-9]{64}$/);
    expect(() => ports.deriveTransactionHash("not-hex")).toThrow(
      /canonical hexadecimal bytes/i,
    );
  });

  it("distinguishes a recorded transaction from an RPC not-found response", async () => {
    const found = recoveryPorts();
    await expect(
      found.ports.resolveRecordedTransaction(transactionHash),
    ).resolves.toBe(true);

    const missing = Object.assign(new Error("transaction not found"), {
      name: "TransactionNotFoundError",
    });
    const absent = recoveryPorts({
      getTransaction: vi.fn().mockRejectedValue(missing),
    });
    await expect(
      absent.ports.resolveRecordedTransaction(transactionHash),
    ).resolves.toBe(false);
  });

  it.each([
    Object.assign(new Error("receipt unavailable"), {
      name: "TransactionReceiptNotFoundError",
    }),
    Object.assign(new Error("receipt timeout"), {
      name: "WaitForTransactionReceiptTimeoutError",
    }),
    new Error("transaction receipt was not found by the RPC"),
    new Error("not found"),
  ])("treats every supported RPC missing-transaction form as absent", async (cause) => {
    const fixture = recoveryPorts({
      getTransaction: vi.fn().mockRejectedValue(cause),
    });

    await expect(
      fixture.ports.resolveRecordedTransaction(transactionHash),
    ).resolves.toBe(false);
  });

  it("treats a non-object RPC rejection as indeterminate rather than absent", async () => {
    const fixture = recoveryPorts({
      getTransaction: vi.fn().mockRejectedValue("not found"),
    });

    await expect(
      fixture.ports.resolveRecordedTransaction(transactionHash),
    ).rejects.toMatchObject({
      category: "transport",
      code: "RELAYER_TRANSACTION_LOOKUP_FAILED",
      retryable: true,
    });
  });

  it("normalizes an indeterminate recovery lookup without leaking RPC detail", async () => {
    const fixture = recoveryPorts({
      getTransaction: vi
        .fn()
        .mockRejectedValue(new Error("Bearer rpc-secret disconnected")),
    });

    await expect(
      fixture.ports.resolveRecordedTransaction(transactionHash),
    ).rejects.toMatchObject({
      category: "transport",
      code: "RELAYER_TRANSACTION_LOOKUP_FAILED",
      retryable: true,
    });
  });
});

describe("Slice 005 bounded receipt recovery", () => {
  it("uses bounded receipt polling when the RPC client supports it", async () => {
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({
      status: "success",
      blockHash,
    });
    const fixture = recoveryPorts({ waitForTransactionReceipt });

    await expect(
      fixture.ports.getTransactionReceipt({ transactionHash }),
    ).resolves.toMatchObject({ transactionHash, blockHash });
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: transactionHash,
      pollingInterval: 2_000,
      timeout: 5_000,
    });
    expect(fixture.publicClient.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("keeps timeout/not-found receipt state retryable", async () => {
    const timeout = Object.assign(new Error("receipt not found"), {
      name: "WaitForTransactionReceiptTimeoutError",
    });
    const fixture = recoveryPorts({
      waitForTransactionReceipt: vi.fn().mockRejectedValue(timeout),
    });

    await expect(
      fixture.ports.getTransactionReceipt({ transactionHash }),
    ).rejects.toMatchObject({
      category: "not-finalized",
      code: "REQUEST_RECEIPT_PENDING",
      retryable: true,
    });
  });

  it("separates a generic receipt transport failure from pending state", async () => {
    const fixture = recoveryPorts({
      waitForTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error("RPC connection reset")),
    });

    await expect(
      fixture.ports.getTransactionReceipt({ transactionHash }),
    ).rejects.toMatchObject({
      category: "transport",
      code: "REQUEST_RECEIPT_LOOKUP_FAILED",
      retryable: true,
    });
  });
});
