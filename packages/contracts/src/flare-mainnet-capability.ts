import { z } from "zod";

export const FlareMainnetWeb2JsonAssessmentV1Schema = z.object({
  version: z.literal("1"),
  network: z.literal("flare"),
  assessedAt: z.literal("2026-08-16T00:00:00Z"),
  execution: z.object({
    chainId: z.literal(14),
    rpcUrl: z.literal("https://flare-api.flare.network/ext/C/rpc"),
    registryAddress: z.literal("0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"),
  }).strict(),
  readOnlyProbe: z.object({
    blockNumber: z.literal("67510177"),
    fdcHub: z.literal("0xc25c749DC27Efb1864Cb3DADa8845B7687eB2d44"),
    relay: z.literal("0xCcF30790A93F15e24EB909548a2C58a9b0a7FBd4"),
    fdcVerification: z.literal("0x5C14FE9D73Ab763F4d4a76f334bf7029DDD20Ecc"),
  }).strict(),
  web2Json: z.object({
    status: z.literal("upstream-unsupported"),
    supportedNetworks: z.tuple([z.literal("coston"), z.literal("coston2")]),
    reason: z.literal(
      "Official FDC documentation limits Web2Json to Coston and Coston2.",
    ),
  }).strict(),
  sources: z.object({
    network: z.literal("https://dev.flare.network/"),
    registry: z.literal(
      "https://dev.flare.network/network/guides/flare-contracts-registry",
    ),
    web2Json: z.literal("https://dev.flare.network/fdc/overview"),
  }).strict(),
}).strict();

export type FlareMainnetWeb2JsonAssessmentV1 = z.infer<
  typeof FlareMainnetWeb2JsonAssessmentV1Schema
>;

export const FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1 =
  FlareMainnetWeb2JsonAssessmentV1Schema.parse({
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
