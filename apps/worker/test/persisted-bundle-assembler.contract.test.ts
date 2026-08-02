// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  makeBundleInput,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  generateSafeWeb2JsonConsumer,
  replayProofBundle,
} from "@proofline/domain";
import * as workerModule from "../src/worker";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function generatedSafeConsumerBytes(): Uint8Array {
  return encoder.encode(
    generateSafeWeb2JsonConsumer(validManifest, {
      contractName: "ProoflineSafeWeb2JsonConsumer",
    }),
  );
}

function persistedAssemblerInput(safeConsumer: {
  canonicalBytes: Uint8Array;
  sha256: string;
}) {
  const expected = makeBundleInput();
  return {
    expected,
    input: {
      runId: expected.runId,
      manifest: validManifest,
      events: makeRunEvents(),
      artifacts: [
        {
          kind: "preflight-evidence",
          canonicalBytes: canonicalBytes({
            version: "1",
            requestBytes: expected.requestBytes,
            network: expected.network,
          }),
          metadata: {
            authorization: "Bearer must-not-enter-bundle",
          },
        },
        {
          kind: "proof-evidence",
          canonicalBytes: canonicalBytes({
            version: "1",
            proof: expected.proof,
            proofVerified: true,
          }),
          metadata: {
            rawSignedTransaction: "0x02f8must-not-enter-bundle",
          },
        },
        {
          kind: "safe-consumer",
          canonicalBytes: safeConsumer.canonicalBytes,
          sha256: safeConsumer.sha256,
          metadata: { compiler: "solc-0.8.36" },
        },
      ],
    },
  };
}

describe("Slice 003 persisted proof-bundle assembly", () => {
  it("assembles canonical replay bytes only from the journal and persisted evidence", async () => {
    const assemble = (workerModule as Record<string, unknown>)
      .assemblePersistedProofBundle;
    expect(
      assemble,
      "BUILD_PROOF_BUNDLE requires a persisted-evidence assembler",
    ).toEqual(expect.any(Function));

    const safeConsumerBytes = generatedSafeConsumerBytes();
    const safeConsumerSha256 = sha256Hex(safeConsumerBytes);
    const { expected, input } = persistedAssemblerInput({
      canonicalBytes: safeConsumerBytes,
      sha256: `sha256:${safeConsumerSha256}`,
    });
    const result = await (assemble as (...args: any[]) => any)(input);

    expect(result.artifact).toMatchObject({ kind: "proof-bundle" });
    expect(result.canonicalBytes).toBeInstanceOf(Uint8Array);
    expect(result.artifact.canonicalBytes).toEqual(result.canonicalBytes);

    const serialized = decoder.decode(result.canonicalBytes);
    const replayed = replayProofBundle(serialized);
    expect(replayed).toEqual(expect.objectContaining(expected));
    expect(replayed.artifacts.safeConsumerSha256).toBe(safeConsumerSha256);
    expect(replayed.network).toEqual({
      chainId: 114,
      blockNumber: expected.network.blockNumber,
      registryAddress: expected.network.registryAddress,
      resolvedContracts: {
        FdcHub: expected.network.resolvedContracts.FdcHub,
        FdcRequestFeeConfigurations:
          expected.network.resolvedContracts.FdcRequestFeeConfigurations,
        FdcVerification:
          expected.network.resolvedContracts.FdcVerification,
        Relay: expected.network.resolvedContracts.Relay,
      },
    });
    expect(canonicalSerializeProofBundle(replayed)).toBe(serialized);
    expect(serialized).not.toMatch(
      /must-not-enter-bundle|authorization|rawSignedTransaction|privateKey/i,
    );
  });

  it.each([
    "tampered bytes with the original stored digest",
    "tampered bytes with their matching stored digest",
    "valid bytes with the wrong stored digest",
  ])("rejects %s before producing a proof bundle", async (caseName) => {
    const assemble = (workerModule as Record<string, unknown>)
      .assemblePersistedProofBundle as (...args: any[]) => any;
    const validBytes = generatedSafeConsumerBytes();
    const validDigest = sha256Hex(validBytes);
    const tamperCanary = "tampered-consumer-private-content";
    const tamperedBytes = encoder.encode(
      `${decoder.decode(validBytes)}\n// ${tamperCanary}\n`,
    );
    const canonicalBytes = caseName.startsWith("valid")
      ? validBytes
      : tamperedBytes;
    const storedDigest = caseName.includes("their matching")
      ? sha256Hex(tamperedBytes)
      : caseName.startsWith("valid")
        ? "0".repeat(64)
        : validDigest;
    const { input } = persistedAssemblerInput({
      canonicalBytes,
      sha256: `sha256:${storedDigest}`,
    });

    const captured = await Promise.resolve()
      .then(() => assemble(input))
      .then(
        (output) => ({ output, error: undefined }),
        (error: unknown) => ({ output: undefined, error }),
      );

    expect(captured.output).toBeUndefined();
    expect(captured.error).toMatchObject({
      message: "Persisted safe-consumer artifact is invalid",
      category: "schema-invalid",
      code: "SAFE_CONSUMER_ARTIFACT_INVALID",
      retryable: false,
    });
    expect(captured.error).not.toHaveProperty("cause");
    expect(
      JSON.stringify({
        output: captured.output,
        message: (captured.error as any)?.message,
        category: (captured.error as any)?.category,
        code: (captured.error as any)?.code,
        retryable: (captured.error as any)?.retryable,
        cause: (captured.error as any)?.cause,
      }),
    ).not.toContain(tamperCanary);
  });
});
