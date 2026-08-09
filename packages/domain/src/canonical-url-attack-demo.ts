import {
  CanonicalUrlAttackDemoSummaryV1Schema,
  type CanonicalUrlAttackDemoSummaryV1,
  type CanonicalUrlAttackRecordingV1,
} from "@proofline/contracts";
import {
  canonicalSerializeCanonicalUrlAttackRecording,
  validateCanonicalUrlAttackRecording,
} from "./canonical-url-attack-recording";
import { sha256Hex } from "./sha256";

export function deriveCanonicalUrlAttackDemoSummary(input: {
  recording: CanonicalUrlAttackRecordingV1;
  recordingSha256: string;
}): CanonicalUrlAttackDemoSummaryV1 {
  const recording = validateCanonicalUrlAttackRecording(input.recording);
  const canonicalRecording =
    canonicalSerializeCanonicalUrlAttackRecording(recording);
  const recordingSha256 = `sha256:${sha256Hex(canonicalRecording)}`;
  if (input.recordingSha256 !== recordingSha256) {
    throw new Error(
      "Canonical URL attack recording digest does not match canonical bytes",
    );
  }

  return CanonicalUrlAttackDemoSummaryV1Schema.parse({
    version: "1",
    kind: "canonical-url-attack-demo-summary",
    status: "available",
    statement: recording.statement,
    recording: {
      sha256: recordingSha256,
      checksum: recording.checksum,
      recordedAt: recording.recordedAt,
      release: recording.release,
    },
    network: recording.network,
    runs: {
      attack: {
        runId: recording.bundles.attack.runId,
        submissionMode: recording.bundles.attack.submissionMode,
        requestedUrl: recording.bundles.attack.requestedUrl,
        transactionHash: recording.bundles.attack.transactionHash,
        votingRound: recording.bundles.attack.votingRound,
        proofSha256: recording.bundles.attack.proofSha256,
      },
      control: {
        runId: recording.bundles.control.runId,
        submissionMode: recording.bundles.control.submissionMode,
        requestedUrl: recording.bundles.control.requestedUrl,
        transactionHash: recording.bundles.control.transactionHash,
        votingRound: recording.bundles.control.votingRound,
        proofSha256: recording.bundles.control.proofSha256,
      },
    },
    toolchain: {
      compiler: {
        name: recording.toolchain.compiler.name,
        version: recording.toolchain.compiler.version,
        evmVersion: recording.toolchain.compiler.evmVersion,
      },
      runtime: recording.toolchain.runtime,
    },
    outcomes: recording.transcript.executions,
    downloadPath: "/v1/demo/canonical-url/recording",
  });
}
