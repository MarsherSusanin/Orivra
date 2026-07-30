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
    [{ balanceWei: 62_344n }, /balance.*floor|insufficient/i],
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
    expect(order).toEqual(["persist", "broadcast:0x02f8signed", "mark"]);
  });

  it("rebroadcasts the exact persisted raw transaction after a crash and never signs again", async () => {
    const persisted = {
      nonce: 7n,
      rawTransaction: "0x02f8signed",
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(persisted),
      reserveNonce: vi.fn(),
      persistSignedTransaction: vi.fn(),
      markBroadcast: vi.fn(),
    };
    const signer = { sign: vi.fn() };
    const broadcaster = vi.fn().mockResolvedValue(persisted.transactionHash);
    const executor = createRelayerExecutor({ repository, signer, broadcaster });

    await expect(executor.execute(exactCommand)).resolves.toMatchObject({
      ...persisted,
      reused: true,
    });
    expect(broadcaster).toHaveBeenCalledWith(persisted.rawTransaction);
    expect(signer.sign).not.toHaveBeenCalled();
    expect(repository.reserveNonce).not.toHaveBeenCalled();
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
