// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validateRelayerSubmission } from "../src/relayer";

const base = {
  idempotencyKey: "slice017-relayer-policy",
  chainId: 114,
  target: "0x3333333333333333333333333333333333333333",
  expectedTarget: "0x3333333333333333333333333333333333333333",
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
};

describe("Slice 017 stable relayer policy failures", () => {
  it.each([
    ["global cap", { globalFeeCapWei: 12_000n }, "GLOBAL_FEE_CAP_EXCEEDED"],
    ["quota", { quotaRemaining: 0 }, "RELAYER_QUOTA_EXHAUSTED"],
    ["balance floor", { balanceFloorWei: 70_000n }, "BALANCE_FLOOR_VIOLATION"],
  ] as const)("normalizes %s before signing or broadcast", (_label, override, code) => {
    let failure: unknown;
    try {
      validateRelayerSubmission({ ...base, ...override });
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toMatchObject({
      category: "configuration",
      code,
      retryable: false,
    });
    expect(String(failure)).not.toMatch(/private|token|authorization|stack/i);
  });
});
