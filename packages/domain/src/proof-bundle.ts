import {
  ProofBundleContentV1Schema,
  ProofBundleV1Schema,
  type ProofBundleContentV1,
  type ProofBundleV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";
import { sha256Hex } from "./sha256";

function checksumContent(content: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(content))}`;
}

export function createProofBundle(input: ProofBundleContentV1): ProofBundleV1 {
  const content = ProofBundleContentV1Schema.parse(input);
  return ProofBundleV1Schema.parse({
    ...content,
    checksum: checksumContent(content),
  });
}

export function canonicalSerializeProofBundle(bundleValue: ProofBundleV1): string {
  return canonicalJson(ProofBundleV1Schema.parse(bundleValue));
}

export function verifyProofBundleChecksum(bundleValue: unknown): boolean {
  if (bundleValue === null || typeof bundleValue !== "object" || Array.isArray(bundleValue)) {
    return false;
  }

  const { checksum, ...content } = bundleValue as Record<string, unknown>;
  if (typeof checksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(checksum)) {
    return false;
  }

  try {
    return checksumContent(content) === checksum;
  } catch {
    return false;
  }
}

export function replayProofBundle(serialized: string): ProofBundleV1 {
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Proof bundle is not valid JSON", { cause: error });
  }

  if (!verifyProofBundleChecksum(decoded)) {
    throw new Error("Proof bundle checksum mismatch");
  }
  return ProofBundleV1Schema.parse(decoded);
}
