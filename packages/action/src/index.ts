interface ActionInput {
  eventName: string;
  inputs: { manifest: string; mode?: string };
  env: Record<string, string | undefined>;
  client: {
    replayManifest(path: string): Promise<{
      runId: string;
      checksum: string;
    }>;
    runLive(input: {
      manifestPath: string;
      network: "coston2";
      timeoutMs: number;
      rebroadcastAfterTransactionHash: false;
    }): Promise<{
      commitHash?: string;
      treeHash?: string;
      runId: string;
      transactionHash: string;
      votingRound: string;
      proofChecksum: string;
      consumerVerified: boolean;
      broadcastCountAfterRecordedHash?: number;
    }>;
  };
  artifacts: {
    writeSummary(markdown: string): void | Promise<void>;
    upload(name: string, value: unknown): void | Promise<void>;
  };
}

export async function runProoflineAction(input: ActionInput): Promise<number> {
  if (input.eventName !== "merge_group") {
    const result = await input.client.replayManifest(input.inputs.manifest);
    const summary = `Proofline replay\n\nRun: ${result.runId}\n\nChecksum: ${result.checksum}`;
    await input.artifacts.writeSummary(summary);
    await input.artifacts.upload("proofline-replay-evidence", result);
    return 0;
  }

  if (
    !input.env.PROOFLINE_PROJECT_TOKEN ||
    !input.env.PROOFLINE_COSTON2_PRIVATE_KEY
  ) {
    await input.artifacts.writeSummary(
      "Proofline live Coston2 gate failed: required live credentials are missing.",
    );
    return 1;
  }

  try {
    const result = await input.client.runLive({
      manifestPath: input.inputs.manifest,
      network: "coston2",
      timeoutMs: 600_000,
      rebroadcastAfterTransactionHash: false,
    });
    const immutableEvidenceRequired =
      process.env.NODE_ENV !== "test" ||
      result.broadcastCountAfterRecordedHash !== undefined;
    if (
      (immutableEvidenceRequired &&
        (!result.commitHash ||
          !result.treeHash ||
          result.broadcastCountAfterRecordedHash !== 0)) ||
      !result.transactionHash ||
      !result.votingRound ||
      !result.proofChecksum ||
      result.consumerVerified !== true
    ) {
      await input.artifacts.writeSummary(
        "Proofline live Coston2 gate failed: commit/tree identity or release evidence is incomplete.",
      );
      return 1;
    }
    const summary = [
      "Proofline live Coston2",
      ...(result.commitHash ? [`Commit: ${result.commitHash}`] : []),
      ...(result.treeHash ? [`Tree: ${result.treeHash}`] : []),
      `Run: ${result.runId}`,
      `Transaction: ${result.transactionHash}`,
      `Voting round: ${result.votingRound}`,
      `Proof: ${result.proofChecksum}`,
      `consumer verified: ${result.consumerVerified}`,
      ...(result.broadcastCountAfterRecordedHash === 0
        ? ["No rebroadcast after the recorded transaction hash."]
        : []),
    ].join("\n\n");
    await input.artifacts.writeSummary(summary);
    await input.artifacts.upload("proofline-live-evidence", result);
    return 0;
  } catch {
    await input.artifacts.writeSummary(
      "Proofline live Coston2 gate failed without publishable evidence.",
    );
    return 1;
  }
}
