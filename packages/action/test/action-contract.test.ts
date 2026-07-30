// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { runProoflineAction } from "../src/index";

const COMMIT_HASH = "c".repeat(40);
const TREE_HASH = "d".repeat(40);

function harness() {
  return {
    client: {
      replayManifest: vi.fn().mockResolvedValue({
        runId: "run_replay",
        checksum: `sha256:${"a".repeat(64)}`,
      }),
      runLive: vi.fn().mockResolvedValue({
        commitHash: COMMIT_HASH,
        treeHash: TREE_HASH,
        runId: "run_live",
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        votingRound: "42871",
        proofChecksum: `sha256:${"b".repeat(64)}`,
        consumerVerified: true,
      }),
    },
    artifacts: {
      writeSummary: vi.fn(),
      upload: vi.fn(),
    },
  };
}

describe("Proofline GitHub Action release modes", () => {
  it("defaults pull requests to hermetic replay and publishes checksum evidence", async () => {
    const deps = harness();
    await expect(
      runProoflineAction({
        eventName: "pull_request",
        inputs: { manifest: "proofline.manifest.json" },
        env: {},
        ...deps,
      }),
    ).resolves.toBe(0);
    expect(deps.client.replayManifest).toHaveBeenCalledWith(
      "proofline.manifest.json",
    );
    expect(deps.client.runLive).not.toHaveBeenCalled();
    expect(deps.artifacts.writeSummary).toHaveBeenCalledWith(
      expect.stringMatching(/run_replay.*sha256:/s),
    );
  });

  it("requires one bounded live Coston2 run for merge_group", async () => {
    const deps = harness();
    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: "proofline.manifest.json" },
        env: {
          PROOFLINE_PROJECT_TOKEN: "project_" + "a".repeat(64),
          PROOFLINE_COSTON2_PRIVATE_KEY: "0xlocal-secret",
          GITHUB_SHA: COMMIT_HASH,
          PROOFLINE_TREE_HASH: TREE_HASH,
        },
        ...deps,
      }),
    ).resolves.toBe(0);
    expect(deps.client.runLive).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestPath: "proofline.manifest.json",
        network: "coston2",
        timeoutMs: 600_000,
        rebroadcastAfterTransactionHash: false,
      }),
    );
    expect(deps.artifacts.writeSummary).toHaveBeenCalledWith(
      expect.stringMatching(/run_live.*42871.*consumer/s),
    );
  });

  it("fails closed if live merge evidence or required secrets are missing", async () => {
    const deps = harness();
    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: "proofline.manifest.json" },
        env: {},
        ...deps,
      }),
    ).resolves.toBe(1);
    expect(deps.client.runLive).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.artifacts.writeSummary.mock.calls)).not.toMatch(
      /local-secret|PRIVATE_KEY/,
    );
  });
});
