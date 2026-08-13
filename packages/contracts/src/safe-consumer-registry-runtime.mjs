import { z } from "zod";
import { sha256Bytes } from "./sha256-runtime.mjs";

const OpenMeteoManifestSha256 = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const EthUsdManifestSha256 = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((value) => !/^0x0{40}$/.test(value));

const EntrySchema = (templateId, manifestSha256) => z.object({
  templateId: z.literal(templateId), revision: z.literal(1), manifestSha256: z.literal(manifestSha256), consumerAddress: AddressSchema,
}).strict();

export const SafeConsumerRegistryV1Schema = z.object({
  version: z.literal("1"), kind: z.literal("safe-consumer-registry"), chainId: z.literal(114),
  entries: z.tuple([
    EntrySchema("open-meteo-current-weather", OpenMeteoManifestSha256),
    EntrySchema("eth-usd", EthUsdManifestSha256),
  ]),
}).strict().refine(({ entries }) => entries[0].consumerAddress.toLowerCase() !== entries[1].consumerAddress.toLowerCase(), {
  path: ["entries", 1, "consumerAddress"],
});

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export const canonicalSerializeSafeConsumerRegistry = (value) => canonicalJson(SafeConsumerRegistryV1Schema.parse(value));
export const checksumSafeConsumerRegistry = (value) => sha256Bytes(new TextEncoder().encode(canonicalSerializeSafeConsumerRegistry(value)));
