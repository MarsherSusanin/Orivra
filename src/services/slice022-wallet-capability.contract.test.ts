// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { submitWithEip1193 } from "./run-client";

const flareCapability = {
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
} as const;

describe("Slice 022 wallet capability boundary", () => {
  it("rejects a disabled capability before preparing or requesting a wallet effect", async () => {
    const provider = { request: vi.fn() };
    const client = {
      prepareSubmission: vi.fn().mockResolvedValue({
        chainId: "0xe",
        to: "0x3333333333333333333333333333333333333333",
        data: "0xfeedcafe",
        value: "0x1",
      }),
      attachTransaction: vi.fn(),
    };
    const submit = submitWithEip1193 as unknown as (
      input: Parameters<typeof submitWithEip1193>[0] & {
        networkCapability: typeof flareCapability;
      },
    ) => Promise<{ transactionHash: string }>;

    const error = await submit({
      runId: "run_flare_disabled",
      idempotencyKey: "wallet-flare-disabled",
      provider,
      client,
      networkCapability: flareCapability,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: "NETWORK_CAPABILITY_DISABLED" });
    expect(client.prepareSubmission).not.toHaveBeenCalled();
    expect(client.attachTransaction).not.toHaveBeenCalled();
    expect(provider.request).not.toHaveBeenCalled();
  });
});
