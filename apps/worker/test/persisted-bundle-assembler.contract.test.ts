// @vitest-environment node

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

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("Slice 003 persisted proof-bundle assembly", () => {
  it("assembles canonical replay bytes only from the journal and persisted evidence", async () => {
    const assemble = (workerModule as Record<string, unknown>)
      .assemblePersistedProofBundle;
    expect(
      assemble,
      "BUILD_PROOF_BUNDLE requires a persisted-evidence assembler",
    ).toEqual(expect.any(Function));

    const expected = makeBundleInput();
    const result = await (assemble as (...args: any[]) => any)({
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
          canonicalBytes: new TextEncoder().encode(
            generateSafeWeb2JsonConsumer(validManifest, {
              contractName: "ProoflineSafeWeb2JsonConsumer",
            }),
          ),
          metadata: { compiler: "solc-0.8.36" },
        },
      ],
    });

    expect(result.artifact).toMatchObject({ kind: "proof-bundle" });
    expect(result.canonicalBytes).toBeInstanceOf(Uint8Array);
    expect(result.artifact.canonicalBytes).toEqual(result.canonicalBytes);

    const serialized = new TextDecoder().decode(result.canonicalBytes);
    const replayed = replayProofBundle(serialized);
    expect(replayed).toEqual(expect.objectContaining(expected));
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
});
