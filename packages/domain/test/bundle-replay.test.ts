// @vitest-environment node

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
  replayProofBundle,
  verifyProofBundleChecksum,
} from "../src/index";
import { makeBundleInput } from "../../contracts/test/fixtures";

describe("canonical proof bundles", () => {
  it("produces byte-identical canonical JSON and checksum despite object insertion order", () => {
    const input = makeBundleInput();
    const reordered = {
      ...input,
      network: {
        resolvedContracts: input.network.resolvedContracts,
        registryAddress: input.network.registryAddress,
        chainId: input.network.chainId,
      },
    };

    const first = createProofBundle(input);
    const second = createProofBundle(reordered);

    expect(first.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.checksum).toBe(first.checksum);
    expect(canonicalSerializeProofBundle(second)).toBe(canonicalSerializeProofBundle(first));
    expect(verifyProofBundleChecksum(first)).toBe(true);
  });

  it("round-trips canonical bytes through deterministic replay", () => {
    const bundle = createProofBundle(makeBundleInput());
    const bytes = canonicalSerializeProofBundle(bundle);
    const replayed = replayProofBundle(bytes);

    expect(replayed).toEqual(bundle);
    expect(canonicalSerializeProofBundle(replayed)).toBe(bytes);
  });

  it("detects event mutation during replay", () => {
    const bundle = createProofBundle(makeBundleInput());
    const mutated = structuredClone(bundle);
    (mutated.events[2].payload as { transactionHash: string }).transactionHash =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    expect(verifyProofBundleChecksum(mutated)).toBe(false);
    expect(() => replayProofBundle(JSON.stringify(mutated))).toThrow(/checksum mismatch/i);
  });

  it("detects every generated proof-response mutation", () => {
    fc.assert(
      fc.property(
        fc.string({
          minLength: 2,
          maxLength: 64,
          unit: fc.constantFrom(..."0123456789abcdef"),
        }),
        (hex) => {
          const bundle = createProofBundle(makeBundleInput());
          const mutated = structuredClone(bundle);
          mutated.proof.response = `0x${hex}`;
          fc.pre(mutated.proof.response !== bundle.proof.response);

          expect(verifyProofBundleChecksum(mutated)).toBe(false);
          expect(() => replayProofBundle(JSON.stringify(mutated))).toThrow(/checksum mismatch/i);
        },
      ),
    );
  });

  it("never serializes runtime secrets added outside the public schema", () => {
    const unsafe = {
      ...makeBundleInput(),
      authorization: "Bearer project-secret",
      privateKey: "0xdeadbeef",
      env: { RELAYER_PRIVATE_KEY: "0xdeadbeef" },
    };
    expect(() => createProofBundle(unsafe)).toThrow(/unrecognized|secret|schema/i);
  });
});
