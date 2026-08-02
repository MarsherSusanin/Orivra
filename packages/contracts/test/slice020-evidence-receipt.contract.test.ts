// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import { RUN_ID } from "./fixtures";

const transactionHash = `0x${"a".repeat(64)}`;
const proofChecksum = `sha256:${"b".repeat(64)}`;
const bundleChecksum = `sha256:${"c".repeat(64)}`;
const safeConsumerChecksum = `sha256:${"d".repeat(64)}`;

const walletReceipt = {
  version: "1",
  runId: RUN_ID,
  network: "coston2",
  submissionMode: "wallet",
  transactionHash,
  votingRound: 42871,
  proofChecksum,
  bundleChecksum,
  consumerResult: {
    passed: false,
    diagnosticCodes: ["MISSING_CONSUMER_HOST_INVARIANT"],
  },
  safeConsumerChecksum,
  replayResult: {
    byteIdentical: true,
    checksum: bundleChecksum,
  },
} as const;

function evidenceReceiptSchema() {
  const schema = (Contracts as Record<string, unknown>).EvidenceReceiptV1Schema as
    | {
        parse(value: unknown): unknown;
        safeParse(value: unknown): { success: boolean };
      }
    | undefined;
  expect(schema, "EvidenceReceiptV1Schema must be a public V1 schema").toBeDefined();
  if (!schema) throw new Error("EvidenceReceiptV1Schema is missing");
  return schema;
}

describe("Slice 020A public EvidenceReceiptV1 contract", () => {
  it("publishes distinct proof, bundle and generated-consumer checksums", () => {
    const parsed = evidenceReceiptSchema().parse(walletReceipt);
    expect(parsed).toEqual(walletReceipt);
    expect(new Set([
      walletReceipt.proofChecksum,
      walletReceipt.bundleChecksum,
      walletReceipt.safeConsumerChecksum,
    ]).size).toBe(3);
  });

  it("requires a transaction hash for live authority but permits replay without one", () => {
    const schema = evidenceReceiptSchema();
    const { transactionHash: _transactionHash, ...withoutTransaction } = walletReceipt;
    expect(schema.safeParse(withoutTransaction).success).toBe(false);
    expect(
      schema.safeParse({
        ...withoutTransaction,
        submissionMode: "relayer",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...withoutTransaction,
        submissionMode: "replay",
      }).success,
    ).toBe(true);
  });

  it("fails closed on non-byte-identical replay, checksum drift and unknown fields", () => {
    const schema = evidenceReceiptSchema();
    expect(
      schema.safeParse({
        ...walletReceipt,
        replayResult: { ...walletReceipt.replayResult, byteIdentical: false },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...walletReceipt,
        replayResult: {
          ...walletReceipt.replayResult,
          checksum: `sha256:${"e".repeat(64)}`,
        },
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...walletReceipt, rawProof: "0x1234" }).success).toBe(false);
  });

  it("rejects consumer verdicts that contradict their diagnostic evidence", () => {
    expect(evidenceReceiptSchema().safeParse({
      ...walletReceipt,
      consumerResult: { passed: true, diagnosticCodes: ["HOST_MISMATCH"] },
    }).success).toBe(false);
  });
});
