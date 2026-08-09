import {
  canonicalSerializeTestRecording,
  makeCanonicalUrlAttackRecording,
  sha256,
} from "./slice024a-canonical-url-attack.fixtures";

export const RECORDING_BYTES = canonicalSerializeTestRecording();
export const RECORDING_SHA256 = sha256(RECORDING_BYTES);

export function makeCanonicalUrlAttackDemoSummary() {
  const recording = makeCanonicalUrlAttackRecording();
  return {
    version: "1" as const,
    kind: "canonical-url-attack-demo-summary" as const,
    status: "available" as const,
    statement: "Valid proof ≠ trusted URL" as const,
    recording: {
      sha256: RECORDING_SHA256,
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
    downloadPath: "/v1/demo/canonical-url/recording" as const,
  };
}
