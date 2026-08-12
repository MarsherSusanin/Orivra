import { chmod, writeFile } from "node:fs/promises";
import { canonicalJson } from "@proofline/domain";

export const OPEN_METEO_MANIFEST_SHA256 =
  "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8";
export const ETH_USD_MANIFEST_SHA256 =
  "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";

export const testSafeConsumerRegistry = Object.freeze({
  version: "1" as const,
  kind: "safe-consumer-registry" as const,
  chainId: 114 as const,
  entries: Object.freeze([
    Object.freeze({
      templateId: "open-meteo-current-weather" as const,
      revision: 1 as const,
      manifestSha256: OPEN_METEO_MANIFEST_SHA256,
      consumerAddress: "0x1111111111111111111111111111111111111111" as const,
    }),
    Object.freeze({
      templateId: "eth-usd" as const,
      revision: 1 as const,
      manifestSha256: ETH_USD_MANIFEST_SHA256,
      consumerAddress: "0x2222222222222222222222222222222222222222" as const,
    }),
  ]),
});

export const testSafeConsumerRegistryCanonicalJson = canonicalJson(
  testSafeConsumerRegistry,
);

export async function writeTestSafeConsumerRegistry(path: string): Promise<void> {
  await writeFile(path, testSafeConsumerRegistryCanonicalJson, { mode: 0o400 });
  await chmod(path, 0o400);
}
