import {
  CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES,
  CanonicalUrlAttackRecordingContentV1Schema,
  CanonicalUrlAttackRecordingV1Schema,
  type CanonicalUrlAttackRecordingContentV1,
  type CanonicalUrlAttackRecordingV1,
  type ProofBundleV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";
import { canonicalizeManifestUrl } from "./diagnostics";
import { replayProofBundle } from "./proof-bundle";
import { sha256Hex } from "./sha256";

const textEncoder = new TextEncoder();

function sha256(value: string | Uint8Array): string {
  return `sha256:${sha256Hex(value)}`;
}

function proofSha256(response: string): string {
  const hex = response.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return sha256(bytes);
}

function utf8Bytes(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function assertRecording(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Canonical URL attack recording ${message}`);
}

function validateBundleEvidence(
  evidence: CanonicalUrlAttackRecordingContentV1["bundles"]["attack"] |
    CanonicalUrlAttackRecordingContentV1["bundles"]["control"],
): ProofBundleV1 {
  const bundle = replayProofBundle(evidence.canonicalBundle);
  const submitted = bundle.events.filter(
    (event) => event.type === "REQUEST_SUBMITTED",
  );
  const lastEvent = bundle.events.at(-1);

  assertRecording(lastEvent?.type === "CONSUMER_VERIFIED", "requires a terminal proof bundle");
  assertRecording(submitted.length === 1, "requires one persisted transaction");
  const transaction = submitted[0];
  assertRecording(transaction.type === "REQUEST_SUBMITTED", "has invalid transaction evidence");
  assertRecording(bundle.runId === evidence.runId, "run identity mismatch");
  assertRecording(bundle.checksum === evidence.bundleChecksum, "bundle checksum mismatch");
  assertRecording(
    utf8Bytes(evidence.canonicalBundle) === evidence.canonicalBundleUtf8Bytes,
    "canonical bundle UTF-8 size mismatch",
  );
  assertRecording(
    sha256(evidence.canonicalBundle) === evidence.canonicalBundleSha256,
    "canonical bundle byte checksum mismatch",
  );
  assertRecording(lastEvent.sequence === evidence.lastSequence, "last sequence mismatch");
  assertRecording(
    transaction.payload.transactionHash === evidence.transactionHash,
    "transaction hash mismatch",
  );
  assertRecording(
    transaction.payload.mode === evidence.submissionMode &&
      bundle.manifest.submission.mode === evidence.submissionMode,
    "live submission mode mismatch",
  );
  assertRecording(bundle.proof.votingRound === evidence.votingRound, "voting round mismatch");
  assertRecording(proofSha256(bundle.proof.response) === evidence.proofSha256, "proof checksum mismatch");
  assertRecording(
    canonicalizeManifestUrl(bundle.manifest) === evidence.requestedUrl,
    "canonical request URL mismatch",
  );
  return bundle;
}

function validateSemanticIntegrity(
  content: CanonicalUrlAttackRecordingContentV1,
): void {
  const attackBundle = validateBundleEvidence(content.bundles.attack);
  const controlBundle = validateBundleEvidence(content.bundles.control);
  const attack = content.bundles.attack;
  const control = content.bundles.control;

  assertRecording(attack.runId !== control.runId, "requires two different live runs");
  assertRecording(
    content.sharedRequest.method === attackBundle.manifest.request.method &&
      content.sharedRequest.method === controlBundle.manifest.request.method,
    "method mismatch",
  );
  assertRecording(
    canonicalJson(content.sharedRequest.query) ===
      canonicalJson(attackBundle.manifest.request.query) &&
      canonicalJson(content.sharedRequest.query) ===
        canonicalJson(controlBundle.manifest.request.query),
    "query mismatch",
  );
  assertRecording(
    content.sharedRequest.jq === attackBundle.manifest.request.jq &&
      content.sharedRequest.jq === controlBundle.manifest.request.jq,
    "JQ mismatch",
  );
  assertRecording(
    content.sharedRequest.abiSignature === attackBundle.manifest.request.abiSignature &&
      content.sharedRequest.abiSignature === controlBundle.manifest.request.abiSignature,
    "ABI mismatch",
  );
  assertRecording(
    content.sharedRequest.transformedResponseShapeSha256 ===
      attack.transformedResponseShapeSha256 &&
      content.sharedRequest.transformedResponseShapeSha256 ===
        control.transformedResponseShapeSha256,
    "transformed response shape mismatch",
  );

  const attackHost = new URL(attack.requestedUrl).hostname;
  const controlHost = new URL(control.requestedUrl).hostname;
  assertRecording(attackHost !== controlHost, "requires different attack and control hosts");
  assertRecording(
    controlBundle.manifest.consumer.expectedHost === controlHost,
    "control host does not define the safe intended host",
  );

  const [vulnerableAttack, safeAttack, safeControl] =
    content.transcript.executions;
  assertRecording(
    content.consumers.vulnerable.runtimeBytecodeSha256 !==
      content.consumers.safe.runtimeBytecodeSha256,
    "requires distinct vulnerable and safe runtimes",
  );
  assertRecording(
    vulnerableAttack.runtimeBytecodeSha256 ===
      content.consumers.vulnerable.runtimeBytecodeSha256,
    "vulnerable runtime checksum mismatch",
  );
  assertRecording(
    safeAttack.runtimeBytecodeSha256 ===
      content.consumers.safe.runtimeBytecodeSha256 &&
      safeControl.runtimeBytecodeSha256 ===
        content.consumers.safe.runtimeBytecodeSha256,
    "safe runtime checksum mismatch",
  );
  assertRecording(
    vulnerableAttack.proofSha256 === attack.proofSha256 &&
      safeAttack.proofSha256 === attack.proofSha256 &&
      safeControl.proofSha256 === control.proofSha256,
    "transcript proof checksum mismatch",
  );
  assertRecording(
    vulnerableAttack.calldataSha256 === safeAttack.calldataSha256,
    "attack calldata mismatch",
  );
  assertRecording(
    safeControl.calldataSha256 !== safeAttack.calldataSha256,
    "control calldata must be distinct from attack calldata",
  );
}

function contentChecksum(content: CanonicalUrlAttackRecordingContentV1): string {
  return sha256(canonicalJson(content));
}

function assertBoundedCanonicalBytes(serialized: string): void {
  assertRecording(
    utf8Bytes(serialized) <= CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES,
    `exceeds the ${CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES} byte (6 MiB) size limit`,
  );
}

export function createCanonicalUrlAttackRecording(
  input: CanonicalUrlAttackRecordingContentV1,
): CanonicalUrlAttackRecordingV1 {
  const content = CanonicalUrlAttackRecordingContentV1Schema.parse(input);
  validateSemanticIntegrity(content);
  const recording = CanonicalUrlAttackRecordingV1Schema.parse({
    ...content,
    checksum: contentChecksum(content),
  });
  assertBoundedCanonicalBytes(canonicalJson(recording));
  return recording;
}

export function validateCanonicalUrlAttackRecording(
  input: unknown,
): CanonicalUrlAttackRecordingV1 {
  const recording = CanonicalUrlAttackRecordingV1Schema.parse(input);
  const { checksum, ...contentValue } = recording;
  const content = CanonicalUrlAttackRecordingContentV1Schema.parse(contentValue);
  assertRecording(contentChecksum(content) === checksum, "checksum mismatch");
  validateSemanticIntegrity(content);
  assertBoundedCanonicalBytes(canonicalJson(recording));
  return recording;
}

export function canonicalSerializeCanonicalUrlAttackRecording(
  input: unknown,
): string {
  const serialized = canonicalJson(validateCanonicalUrlAttackRecording(input));
  assertBoundedCanonicalBytes(serialized);
  return serialized;
}

export function replayCanonicalUrlAttackRecording(
  serialized: string,
): CanonicalUrlAttackRecordingV1 {
  assertBoundedCanonicalBytes(serialized);
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Canonical URL attack recording is not valid JSON", {
      cause: error,
    });
  }
  const recording = validateCanonicalUrlAttackRecording(decoded);
  assertRecording(
    canonicalJson(recording) === serialized,
    "input bytes are not canonical JSON",
  );
  return recording;
}
