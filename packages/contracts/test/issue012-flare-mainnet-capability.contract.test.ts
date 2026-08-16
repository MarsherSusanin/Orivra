// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1,
  FlareMainnetWeb2JsonAssessmentV1Schema,
  NETWORK_CAPABILITIES_V1,
} from "../src/index";

describe("Issue #12 Flare Mainnet Web2Json capability audit", () => {
  it("binds official Mainnet identity separately from upstream Web2Json support", () => {
    expect(FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1).toEqual({
      version: "1",
      network: "flare",
      assessedAt: "2026-08-16T00:00:00Z",
      execution: {
        chainId: 14,
        rpcUrl: "https://flare-api.flare.network/ext/C/rpc",
        registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
      },
      readOnlyProbe: {
        blockNumber: "67510177",
        fdcHub: "0xc25c749DC27Efb1864Cb3DADa8845B7687eB2d44",
        relay: "0xCcF30790A93F15e24EB909548a2C58a9b0a7FBd4",
        fdcVerification: "0x5C14FE9D73Ab763F4d4a76f334bf7029DDD20Ecc",
      },
      web2Json: {
        status: "upstream-unsupported",
        supportedNetworks: ["coston", "coston2"],
        reason: "Official FDC documentation limits Web2Json to Coston and Coston2.",
      },
      sources: {
        network: "https://dev.flare.network/",
        registry: "https://dev.flare.network/network/guides/flare-contracts-registry",
        web2Json: "https://dev.flare.network/fdc/overview",
      },
    });
    expect(FlareMainnetWeb2JsonAssessmentV1Schema.parse(
      FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1,
    )).toEqual(FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1);
  });

  it("rejects copied Coston2 authority and unsupported enablement claims", () => {
    for (const invalid of [
      {
        ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1,
        execution: {
          ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1.execution,
          chainId: 114,
        },
      },
      {
        ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1,
        execution: {
          ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1.execution,
          rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
        },
      },
      {
        ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1,
        web2Json: {
          ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1.web2Json,
          status: "enabled",
        },
      },
      {
        ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1,
        readOnlyProbe: {
          ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1.readOnlyProbe,
          fdcHub: FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1.readOnlyProbe.relay,
        },
      },
      {
        ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1,
        sources: {
          ...FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1.sources,
          web2Json: "https://example.invalid/fdc",
        },
      },
    ]) {
      expect(FlareMainnetWeb2JsonAssessmentV1Schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("keeps the public runtime capability fail-closed and Coston2 unchanged", () => {
    expect(NETWORK_CAPABILITIES_V1.networks).toEqual([
      expect.objectContaining({ network: "coston2", web2JsonStatus: "enabled" }),
      expect.objectContaining({
        network: "flare",
        web2JsonStatus: "upstream-unsupported",
        reason: "Web2Json is not available on Flare Mainnet.",
      }),
    ]);
  });
});
