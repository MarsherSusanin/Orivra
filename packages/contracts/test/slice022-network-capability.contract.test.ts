// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import { validManifest } from "./fixtures";

const coston2Capability = {
  version: "1",
  network: "coston2",
  displayName: "Coston2",
  web2JsonStatus: "enabled",
  wallet: {
    chainId: 114,
    chainIdHex: "0x72",
    nativeCurrency: {
      name: "Coston2 Flare",
      symbol: "C2FLR",
      decimals: 18,
    },
    explorerBaseUrl: "https://coston2-explorer.flare.network",
  },
} as const;

const flareCapability = {
  version: "1",
  network: "flare",
  displayName: "Flare",
  web2JsonStatus: "upstream-unsupported",
  reason: "Web2Json is not available on Flare Mainnet.",
  wallet: {
    chainId: 14,
    chainIdHex: "0xe",
    nativeCurrency: {
      name: "Flare",
      symbol: "FLR",
      decimals: 18,
    },
    explorerBaseUrl: "https://flare-explorer.flare.network",
  },
} as const;

type PublicSchema = {
  safeParse(value: unknown): { success: boolean; data?: unknown };
};

function publicSchema(name: string): PublicSchema | undefined {
  return (Contracts as Record<string, unknown>)[name] as PublicSchema | undefined;
}

describe("Slice 022 public network contracts", () => {
  it("exports the exact closed FDC network vocabulary", () => {
    const schema = publicSchema("FdcNetworkV1Schema");
    expect(schema, "Slice 022 must export FdcNetworkV1Schema").toBeDefined();
    expect(schema?.safeParse("coston2")).toMatchObject({ success: true });
    expect(schema?.safeParse("flare")).toMatchObject({ success: true });

    for (const candidate of ["coston", "songbird", "mainnet", "Flare", ""] as const) {
      expect(schema?.safeParse(candidate)).toMatchObject({ success: false });
    }
  });

  it("binds each capability to exact wallet and upstream-support metadata", () => {
    const schema = publicSchema("NetworkCapabilityV1Schema");
    expect(schema, "Slice 022 must export NetworkCapabilityV1Schema").toBeDefined();
    expect(schema?.safeParse(coston2Capability)).toMatchObject({ success: true });
    expect(schema?.safeParse(flareCapability)).toMatchObject({ success: true });

    for (const invalid of [
      { ...coston2Capability, wallet: { ...coston2Capability.wallet, chainId: 14 } },
      { ...flareCapability, wallet: { ...flareCapability.wallet, chainIdHex: "0x0e" } },
      { ...flareCapability, web2JsonStatus: "enabled" },
      {
        ...coston2Capability,
        wallet: {
          ...coston2Capability.wallet,
          nativeCurrency: { ...coston2Capability.wallet.nativeCurrency, decimals: 6 },
        },
      },
      {
        ...coston2Capability,
        wallet: {
          ...coston2Capability.wallet,
          explorerBaseUrl: "http://coston2-explorer.flare.network",
        },
      },
      {
        ...coston2Capability,
        wallet: { ...coston2Capability.wallet, rpcUrls: ["https://rpc.example"] },
      },
    ]) {
      expect(schema?.safeParse(invalid)).toMatchObject({ success: false });
    }
  });

  it("exports one strict, ordered capability-list response", () => {
    const schema = publicSchema("NetworkCapabilitiesV1Schema");
    expect(schema, "Slice 022 must export NetworkCapabilitiesV1Schema").toBeDefined();

    const response = {
      version: "1",
      networks: [coston2Capability, flareCapability],
    };
    expect(schema?.safeParse(response)).toMatchObject({ success: true });
    expect(
      schema?.safeParse({ ...response, networks: [flareCapability, coston2Capability] }),
    ).toMatchObject({ success: false });
    expect(schema?.safeParse({ ...response, source: "environment" })).toMatchObject({
      success: false,
    });
  });

  it("recognizes Flare in a manifest without admitting unknown networks", () => {
    expect(
      Contracts.Web2JsonManifestV1Schema.safeParse({
        ...validManifest,
        network: "flare",
      }),
    ).toMatchObject({ success: true });
    expect(
      Contracts.Web2JsonManifestV1Schema.safeParse({
        ...validManifest,
        network: "songbird",
      }),
    ).toMatchObject({ success: false });
  });
});
