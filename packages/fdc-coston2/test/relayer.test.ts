// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createRelayerExecutor,
  redactRelayerAudit,
  validateRelayerSubmission,
} from "../src/relayer";
import { FDC_HUB } from "./fixtures";

const exactCommand = {
  idempotencyKey: "idem_project_run_submission",
  chainId: 114,
  target: FDC_HUB,
  expectedTarget: FDC_HUB,
  calldata: "0xfeedcafe",
  expectedCalldata: "0xfeedcafe",
  valueWei: 12_345n,
  quotedFeeWei: 12_345n,
  projectFeeCapWei: 20_000n,
  globalFeeCapWei: 30_000n,
  quotaRemaining: 1,
  balanceWei: 100_000n,
  balanceFloorWei: 50_000n,
  gasLimit: 21_000n,
  maxFeePerGasWei: 1n,
} as const;

describe("relayer authorization envelope", () => {
  it("accepts only the exact chain, registry-resolved target, calldata, and quoted fee", () => {
    expect(validateRelayerSubmission(exactCommand)).toEqual(exactCommand);
  });

  it.each([
    [{ chainId: 19 }, /chain|114/i],
    [{ target: "0x9999999999999999999999999999999999999999" }, /target|FdcHub/i],
    [{ calldata: "0xdeadbeef" }, /calldata|request/i],
    [{ valueWei: 12_346n }, /fee|value/i],
    [{ projectFeeCapWei: 12_344n }, /project.*cap|fee/i],
    [{ globalFeeCapWei: 12_344n }, /global.*cap|fee/i],
    [{ quotaRemaining: 0 }, /quota/i],
    [{ balanceWei: 83_344n }, /balance.*floor|insufficient/i],
  ])("rejects a policy mismatch %o", (override, expected) => {
    expect(() =>
      validateRelayerSubmission({ ...exactCommand, ...override }),
    ).toThrow(expected);
  });
});

describe("restart-safe relayer execution", () => {
  it("persists nonce, exact signed bytes, and tx hash before the first broadcast", async () => {
    const order: string[] = [];
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      reserveNonce: vi.fn().mockResolvedValue(7n),
      persistSignedTransaction: vi.fn(async () => {
        order.push("persist");
      }),
      claimBroadcastAttempt: vi.fn(async () => {
        order.push("claim-attempt");
        return true;
      }),
      markBroadcast: vi.fn(async () => {
        order.push("mark");
      }),
    };
    const signer = {
      sign: vi.fn().mockResolvedValue({
        rawTransaction: "0x02f8signed",
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    };
    const broadcaster = vi.fn(async (rawTransaction) => {
      order.push(`broadcast:${rawTransaction}`);
      return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    });
    const executor = createRelayerExecutor({ repository, signer, broadcaster });

    await expect(executor.execute(exactCommand)).resolves.toMatchObject({
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: 7n,
      reused: false,
    });
    expect(signer.sign).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 114, nonce: 7n }),
    );
    expect(order).toEqual([
      "persist",
      "claim-attempt",
      "broadcast:0x02f8signed",
      "mark",
    ]);
  });

  it("fails closed without rebroadcast when a durable attempt is not recorded", async () => {
    const persisted = {
      nonce: 7n,
      rawTransaction: "0x02f8signed",
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      broadcastAttemptedAt: "2025-05-15T12:04:14.000Z",
    };
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(persisted),
      reserveNonce: vi.fn(),
      persistSignedTransaction: vi.fn(),
      claimBroadcastAttempt: vi.fn(),
      markBroadcast: vi.fn(),
    };
    const signer = { sign: vi.fn() };
    const broadcaster = vi.fn().mockResolvedValue(persisted.transactionHash);
    const executor = createRelayerExecutor({
      repository,
      signer,
      broadcaster,
      resolveRecordedTransaction: vi.fn().mockResolvedValue(false),
    });

    await expect(executor.execute(exactCommand)).rejects.toThrow(
      /ambiguous|manual recovery/i,
    );
    expect(broadcaster).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
    expect(repository.reserveNonce).not.toHaveBeenCalled();
    expect(repository.claimBroadcastAttempt).not.toHaveBeenCalled();
    expect(repository.markBroadcast).not.toHaveBeenCalled();
  });

  it("marks a durably attempted transaction only after the node records it", async () => {
    const persisted = {
      nonce: 7n,
      rawTransaction: "0x02f8signed",
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      broadcastAttemptedAt: "2025-05-15T12:04:14.000Z",
    };
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(persisted),
      reserveNonce: vi.fn(),
      persistSignedTransaction: vi.fn(),
      claimBroadcastAttempt: vi.fn(),
      markBroadcast: vi.fn(),
    };
    const broadcaster = vi.fn();
    const executor = createRelayerExecutor({
      repository,
      signer: { sign: vi.fn() },
      broadcaster,
      resolveRecordedTransaction: vi.fn().mockResolvedValue(true),
    });

    await expect(executor.execute(exactCommand)).resolves.toMatchObject({
      ...persisted,
      reused: true,
    });
    expect(broadcaster).not.toHaveBeenCalled();
    expect(repository.claimBroadcastAttempt).not.toHaveBeenCalled();
    expect(repository.markBroadcast).toHaveBeenCalledWith(
      exactCommand.idempotencyKey,
      persisted.transactionHash,
      { recovered: true },
    );
  });

  it("fails closed when a node reports a different transaction hash", async () => {
    const persisted = {
      nonce: 7n,
      rawTransaction: "0x02f8signed",
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const executor = createRelayerExecutor({
      repository: {
        findByIdempotencyKey: async () => persisted,
        reserveNonce: vi.fn(),
        persistSignedTransaction: vi.fn(),
        claimBroadcastAttempt: vi.fn().mockResolvedValue(true),
        markBroadcast: vi.fn(),
      },
      signer: { sign: vi.fn() },
      broadcaster: async () =>
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    await expect(executor.execute(exactCommand)).rejects.toThrow(/hash|mismatch/i);
  });
});

describe("relayer secret hygiene", () => {
  it("redacts private material recursively without deleting useful evidence", () => {
    const audit = redactRelayerAudit({
      event: "RELAYER_BROADCAST",
      projectId: "project_1",
      privateKey: "0xdeadbeef",
      nested: {
        authorization: "Bearer project-secret",
        rawTransaction: "0x02f8signed",
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toMatch(/deadbeef|project-secret|02f8signed/);
    expect(serialized).toContain("RELAYER_BROADCAST");
    expect(serialized).toContain("aaaaaaaa");
  });
});
