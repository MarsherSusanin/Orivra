// @vitest-environment node

import { describe, expect, it } from "vitest";
import { makeBundleInput } from "../../contracts/test/fixtures";
import * as Domain from "../src/index";

type ReceiptFactory = (serializedBundle: string) => Record<string, unknown>;
type ReceiptSerializer = (receipt: unknown) => string;

function requiredFunction<T extends (...args: any[]) => any>(name: string): T {
  const candidate = (Domain as Record<string, unknown>)[name];
  expect(candidate, `${name} must be exported by @proofline/domain`).toEqual(
    expect.any(Function),
  );
  if (typeof candidate !== "function") throw new Error(`${name} is missing`);
  return candidate as T;
}

function canonicalBundle(
  mutate?: (input: ReturnType<typeof makeBundleInput>) => void,
): string {
  const input = structuredClone(makeBundleInput());
  mutate?.(input);
  return Domain.canonicalSerializeProofBundle(Domain.createProofBundle(input));
}

describe("Slice 020A deterministic evidence receipt", () => {
  it("derives one canonical receipt from the canonical ProofBundleV1 bytes", () => {
    const createReceipt = requiredFunction<ReceiptFactory>("createEvidenceReceipt");
    const serializeReceipt = requiredFunction<ReceiptSerializer>(
      "canonicalSerializeEvidenceReceipt",
    );
    const serializedBundle = canonicalBundle();
    const bundle = Domain.replayProofBundle(serializedBundle);
    const proof = bundle.events.find((event) => event.type === "PROOF_AVAILABLE");
    const submission = bundle.events.find((event) => event.type === "REQUEST_SUBMITTED");
    if (proof?.type !== "PROOF_AVAILABLE" || submission?.type !== "REQUEST_SUBMITTED") {
      throw new Error("The canonical fixture is missing receipt evidence");
    }

    const first = createReceipt(serializedBundle) as any;
    const second = createReceipt(serializedBundle) as any;
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: "1",
      runId: bundle.runId,
      network: "coston2",
      submissionMode: bundle.manifest.submission.mode,
      transactionHash: submission.payload.transactionHash,
      votingRound: bundle.proof.votingRound,
      proofChecksum: `sha256:${proof.payload.proofHash.slice(2).toLowerCase()}`,
      bundleChecksum: bundle.checksum,
      consumerResult: { passed: bundle.verification.consumerVerified },
      safeConsumerChecksum: `sha256:${bundle.artifacts.safeConsumerSha256}`,
      replayResult: { byteIdentical: true, checksum: bundle.checksum },
    });
    expect(new Set([
      first.proofChecksum,
      first.bundleChecksum,
      first.safeConsumerChecksum,
    ]).size).toBe(3);

    const canonicalReceipt = serializeReceipt(first);
    expect(canonicalReceipt).toBe(serializeReceipt(second));
    expect(JSON.parse(canonicalReceipt)).toEqual(first);
  });

  it("omits a source transaction from a replay handoff while retaining proof evidence", () => {
    const createReceipt = requiredFunction<ReceiptFactory>("createEvidenceReceipt");
    const serialized = canonicalBundle((input) => {
      const manifest = {
        ...input.manifest,
        submission: { ...input.manifest.submission, mode: "replay" as const },
      };
      input.manifest = manifest;
      const created = input.events.find((event) => event.type === "RUN_CREATED");
      if (created?.type !== "RUN_CREATED") throw new Error("RUN_CREATED is missing");
      created.payload.manifest = manifest;
    });

    expect(createReceipt(serialized)).toMatchObject({
      submissionMode: "replay",
      replayResult: { byteIdentical: true },
    });
    expect(createReceipt(serialized)).not.toHaveProperty("transactionHash");
  });

  it("rejects noncanonical bytes, checksum mutation and a checksum-valid foreign event", () => {
    const createReceipt = requiredFunction<ReceiptFactory>("createEvidenceReceipt");
    const canonical = canonicalBundle();
    expect(() => createReceipt(`${canonical}\n`)).toThrow(/canonical|byte/i);

    const decoded = JSON.parse(canonical) as Record<string, unknown>;
    expect(() =>
      createReceipt(JSON.stringify({
        ...decoded,
        checksum: `sha256:${"f".repeat(64)}`,
      })),
    ).toThrow(/checksum/i);

    const foreign = canonicalBundle((input) => {
      input.events[3] = { ...input.events[3], runId: "run_foreign" };
    });
    expect(() => createReceipt(foreign)).toThrow(/run|identity|event/i);
  });
});
