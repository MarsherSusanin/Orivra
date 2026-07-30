// @vitest-environment node

import { describe, expect, it } from "vitest";
import { makeBundleInput } from "../../contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
  replayProofBundle,
} from "../src/index";

function rechecksummedBundle(
  mutate: (content: ReturnType<typeof makeBundleInput>) => void,
): string {
  const content = structuredClone(makeBundleInput());
  mutate(content);
  return canonicalSerializeProofBundle(createProofBundle(content));
}

describe("ProofBundleV1 semantic replay integrity", () => {
  it.each([
    [
      "ordered lifecycle",
      (content: ReturnType<typeof makeBundleInput>) => {
        [content.events[1], content.events[2]] = [content.events[2], content.events[1]];
      },
      /sequence|lifecycle|transition/i,
    ],
    [
      "top-level run identity",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.events[4] = { ...content.events[4], runId: "run_different" };
      },
      /run.?id|identity/i,
    ],
    [
      "manifest identity",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.manifest = {
          ...content.manifest,
          consumer: { ...content.manifest.consumer, expectedHost: "mirror.example.net" },
        };
      },
      /manifest/i,
    ],
    [
      "prepared request bytes",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.requestBytes = "0x0102";
      },
      /request.*bytes|preflight/i,
    ],
    [
      "voting round",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.proof.votingRound += 1;
      },
      /voting.*round|round/i,
    ],
    [
      "verification contract snapshot",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.network.resolvedContracts.FdcVerification =
          "0x9999999999999999999999999999999999999999";
      },
      /verification.*contract|network.*snapshot/i,
    ],
    [
      "proof verification result",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.verification.proofVerified = false;
      },
      /proof.*verif/i,
    ],
    [
      "consumer verification result",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.verification.consumerVerified = false;
      },
      /consumer.*verif/i,
    ],
  ])("rejects a checksum-valid bundle with inconsistent %s", (_label, mutate, message) => {
    const serialized = rechecksummedBundle(mutate);

    expect(() => replayProofBundle(serialized)).toThrow(message);
  });
});
