// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exactTrustManifest } from "../../../packages/contracts/test/fixtures";
import { generateSafeWeb2JsonConsumer } from "@proofline/domain";
import { compileGeneratedConsumer } from "../src/solidity-compiler";

describe("Slice 019 generated consumer compile evidence", () => {
  it("compiles the exact generated source and rejects mutation", () => {
    const source = generateSafeWeb2JsonConsumer(exactTrustManifest, { contractName: "ProoflineSafeWeb2JsonConsumer" });
    expect(compileGeneratedConsumer(source)).toEqual({
      compiler: "solc-0.8.36",
      compileStatus: "passed",
      compiledSourceSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      runtimeBytecode: expect.stringMatching(/^0x[0-9a-f]+$/),
      runtimeBytecodeSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(() => compileGeneratedConsumer(`${source}\nthis is not solidity`)).toThrow(/compilation/i);
    expect(() => compileGeneratedConsumer(
      source.replace("./ProoflineUrlInvariant.sol", "./UnsupportedAuthority.sol"),
    )).toThrow(/compilation/i);
  });
});
