import type { Web2JsonManifestV1 } from "@proofline/contracts";
import { canonicalizeManifestUrl } from "@proofline/domain";
import { createFdcError } from "./errors";
import { assertSafeWeb2JsonUrl } from "./safe-http";

const SECRET_QUERY_KEY = /^(?:api[_-]?key|token|authorization|auth|secret|private[_-]?key)$/i;

export function assertManifestHasNoSecrets(manifest: Web2JsonManifestV1): void {
  const url = assertSafeWeb2JsonUrl(manifest.request.url);
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY_KEY.test(key)) {
      throw new Error("Public Web2Json URLs cannot contain secret credentials");
    }
  }
  for (const key of Object.keys(manifest.request.query)) {
    if (SECRET_QUERY_KEY.test(key)) {
      throw new Error("Public Web2Json query cannot contain secret credentials");
    }
  }
}

export interface PreflightPorts {
  safeFetcher: { getJson(url: string): Promise<unknown> };
  transformJq(value: unknown, jq: string): Promise<unknown>;
  abiEncode(value: unknown, signature: string): string;
  verifier: {
    prepareRequest(manifest: Web2JsonManifestV1): Promise<{ requestBytes: string }>;
  };
  feeOracle: {
    quote(input: { fdcHub: string; requestBytes: string }): Promise<bigint>;
  };
}

export async function runWeb2JsonPreflight(
  input: PreflightPorts & {
    manifest: Web2JsonManifestV1;
    samples: number;
    fdcHub: string;
  },
) {
  assertManifestHasNoSecrets(input.manifest);
  const canonicalUrl = canonicalizeManifestUrl(input.manifest);
  const encodedSamples: string[] = [];
  const transformedSamples: string[] = [];
  for (let index = 0; index < input.samples; index += 1) {
    const source = await input.safeFetcher.getJson(canonicalUrl);
    const transformed = await input.transformJq(source, input.manifest.request.jq);
    transformedSamples.push(JSON.stringify(transformed));
    try {
      encodedSamples.push(
        input.abiEncode(transformed, input.manifest.request.abiSignature),
      );
    } catch (error) {
      throw createFdcError(
        "schema-invalid",
        "PREFLIGHT_ABI_INCOMPATIBLE",
        error instanceof Error ? error.message : "ABI encoding failed",
        false,
        { sampleIndex: index },
      );
    }
  }
  const encodedSample = encodedSamples[0] ?? "";
  const transformedSample = transformedSamples[0] ?? "";
  if (
    encodedSamples.some((sample) => sample !== encodedSample) ||
    transformedSamples.some((sample) => sample !== transformedSample)
  ) {
    throw createFdcError(
      "schema-invalid",
      "PREFLIGHT_NONDETERMINISTIC",
      "Five preflight samples did not produce identical ABI bytes",
      false,
      { sampleCount: input.samples },
    );
  }
  const { requestBytes } = await input.verifier.prepareRequest(input.manifest);
  const quotedFeeWei = await input.feeOracle.quote({
    fdcHub: input.fdcHub,
    requestBytes,
  });
  return {
    canonicalUrl,
    sampleCount: input.samples,
    deterministic: true,
    encodedSample,
    requestBytes,
    quotedFeeWei,
  };
}
