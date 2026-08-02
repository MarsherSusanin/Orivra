import {
  EvidenceReceiptV1Schema,
  type EvidenceReceiptV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";
import { replayProofBundle } from "./proof-bundle";

export function createEvidenceReceipt(
  serializedBundle: string,
): EvidenceReceiptV1 {
  const bundle = replayProofBundle(serializedBundle);
  const proof = bundle.events.find((event) => event.type === "PROOF_AVAILABLE");
  const consumer = bundle.events.find((event) => event.type === "CONSUMER_VERIFIED");
  const submission = bundle.events.find((event) => event.type === "REQUEST_SUBMITTED");
  if (proof?.type !== "PROOF_AVAILABLE" || consumer?.type !== "CONSUMER_VERIFIED") {
    throw new Error("Canonical bundle is missing terminal receipt evidence");
  }

  const submissionMode = bundle.manifest.submission.mode;
  if (submissionMode !== "replay" && submission?.type !== "REQUEST_SUBMITTED") {
    throw new Error("Live canonical bundle is missing transaction evidence");
  }
  if (
    submissionMode !== "replay" &&
    submission?.type === "REQUEST_SUBMITTED" &&
    submission.payload.mode !== submissionMode
  ) {
    throw new Error("Transaction evidence does not match submission authority");
  }

  return EvidenceReceiptV1Schema.parse({
    version: "1",
    runId: bundle.runId,
    network: "coston2",
    submissionMode,
    ...(submissionMode === "replay"
      ? {}
      : { transactionHash: submission!.payload.transactionHash }),
    votingRound: bundle.proof.votingRound,
    proofChecksum: `sha256:${proof.payload.proofHash.slice(2).toLowerCase()}`,
    bundleChecksum: bundle.checksum,
    consumerResult: {
      passed: consumer.payload.passed,
      diagnosticCodes: [...new Set(consumer.payload.diagnostics.map((item) => item.code))],
    },
    safeConsumerChecksum: `sha256:${bundle.artifacts.safeConsumerSha256}`,
    replayResult: { byteIdentical: true, checksum: bundle.checksum },
  });
}

export function canonicalSerializeEvidenceReceipt(
  receipt: EvidenceReceiptV1,
): string {
  return canonicalJson(EvidenceReceiptV1Schema.parse(receipt));
}
