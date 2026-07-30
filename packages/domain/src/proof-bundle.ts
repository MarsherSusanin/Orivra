import {
  ProofBundleContentV1Schema,
  ProofBundleV1Schema,
  type ProofBundleContentV1,
  type ProofBundleV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";
import { projectRun } from "./run-lifecycle";
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
  const bundle = ProofBundleV1Schema.parse(decoded);
  assertSemanticIntegrity(bundle);
  return bundle;
}

function assertSemanticIntegrity(bundle: ProofBundleV1): void {
  projectRun(bundle.events);

  if (bundle.events.some((event) => event.runId !== bundle.runId)) {
    throw new Error("Proof bundle run identity does not match its event journal");
  }

  const created = bundle.events.find((event) => event.type === "RUN_CREATED");
  if (
    created?.type !== "RUN_CREATED" ||
    canonicalJson(created.payload.manifest) !== canonicalJson(bundle.manifest)
  ) {
    throw new Error("Proof bundle manifest does not match RUN_CREATED");
  }

  const preflight = bundle.events.find(
    (event) => event.type === "PREFLIGHT_ACCEPTED",
  );
  if (
    preflight?.type !== "PREFLIGHT_ACCEPTED" ||
    preflight.payload.requestBytes.toLowerCase() !==
      bundle.requestBytes.toLowerCase()
  ) {
    throw new Error("Proof bundle request bytes do not match preflight evidence");
  }

  const round = bundle.events.find((event) => event.type === "ROUND_FINALIZED");
  if (
    round?.type !== "ROUND_FINALIZED" ||
    round.payload.votingRound !== bundle.proof.votingRound
  ) {
    throw new Error("Proof bundle voting round does not match lifecycle evidence");
  }

  const proofVerification = bundle.events.find(
    (event) => event.type === "PROOF_VERIFIED",
  );
  if (
    proofVerification?.type !== "PROOF_VERIFIED" ||
    proofVerification.payload.verificationContract.toLowerCase() !==
      bundle.network.resolvedContracts.FdcVerification.toLowerCase()
  ) {
    throw new Error(
      "Proof bundle verification contract does not match the network snapshot",
    );
  }
  if (bundle.verification.proofVerified !== true) {
    throw new Error(
      "Proof verification result contradicts the PROOF_VERIFIED lifecycle event",
    );
  }

  const consumer = bundle.events.find(
    (event) => event.type === "CONSUMER_VERIFIED",
  );
  if (
    consumer?.type !== "CONSUMER_VERIFIED" ||
    consumer.payload.passed !== bundle.verification.consumerVerified ||
    canonicalJson(consumer.payload.diagnostics) !==
      canonicalJson(bundle.verification.diagnostics)
  ) {
    throw new Error(
      "Consumer verification result does not match lifecycle evidence",
    );
  }
}
