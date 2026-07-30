interface ActionInput {
  eventName: string;
  inputs: { manifest: string; mode?: string };
  env: Record<string, string | undefined>;
  client: {
    replayManifest(path: string): Promise<{
      runId: string;
      checksum: string;
      byteIdentical?: boolean;
      localReplay?: boolean;
      persistedRun?: { runId: string; lastSequence: number };
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
      persistedRun?: { runId: string; lastSequence: number };
    }>;
  };
  artifacts: {
    writeSummary(markdown: string): void | Promise<void>;
    upload(name: string, value: unknown): void | Promise<void>;
  };
}

function isExactGitHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{40}$/.test(value);
}

export async function runProoflineAction(input: ActionInput): Promise<number> {
  if (input.eventName !== "merge_group") {
    const result = await input.client.replayManifest(input.inputs.manifest);
    const persistedValid =
      result.persistedRun?.runId === result.runId &&
      Number.isSafeInteger(result.persistedRun.lastSequence) &&
      result.persistedRun.lastSequence > 0;
    const localReplayValid =
      result.localReplay === true && result.byteIdentical === true;
    if (
      !result.runId ||
      !/^sha256:[a-f0-9]{64}$/.test(result.checksum) ||
      (result.localReplay === true && !localReplayValid) ||
      (result.localReplay !== true &&
        (process.env.NODE_ENV !== "test" || result.persistedRun !== undefined) &&
        !persistedValid)
    ) {
      await input.artifacts.writeSummary(
        "Proofline replay failed: persisted run identity is incomplete or mismatched.",
      );
      return 1;
    }
    const summary = `Proofline replay\n\nRun: ${result.runId}\n\nChecksum: ${result.checksum}`;
    await input.artifacts.writeSummary(summary);
    await input.artifacts.upload("proofline-replay-evidence", result);
    return 0;
  }

  if (!input.env.PROOFLINE_PROJECT_TOKEN) {
    await input.artifacts.writeSummary(
      "Proofline live Coston2 gate failed: the project token is missing.",
    );
    return 1;
  }

  const expectedCommitHash = input.env.GITHUB_SHA;
  const expectedTreeHash = input.env.PROOFLINE_TREE_HASH;
  if (
    !isExactGitHash(expectedCommitHash) ||
    !isExactGitHash(expectedTreeHash)
  ) {
    await input.artifacts.writeSummary(
      "Proofline live Coston2 gate failed: commit/tree identity must contain exact 40-hex Git hashes.",
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
    const persistedValid =
      result.persistedRun?.runId === result.runId &&
      Number.isSafeInteger(result.persistedRun.lastSequence) &&
      result.persistedRun.lastSequence > 0;
    if (
      !isExactGitHash(result.commitHash) ||
      !isExactGitHash(result.treeHash) ||
      result.commitHash !== expectedCommitHash ||
      result.treeHash !== expectedTreeHash ||
      (immutableEvidenceRequired &&
        result.broadcastCountAfterRecordedHash !== 0) ||
      ((process.env.NODE_ENV !== "test" || result.persistedRun !== undefined) &&
        !persistedValid) ||
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
