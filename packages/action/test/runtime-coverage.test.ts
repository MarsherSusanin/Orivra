// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { runProoflineAction } from "../src/index";
import {
  createProductionActionDependencies,
  runActionEntry,
} from "../src/runtime";

function completeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    commitHash: "a".repeat(40),
    treeHash: "b".repeat(40),
    runId: "run_live",
    transactionHash: `0x${"c".repeat(64)}`,
    votingRound: "42871",
    proofChecksum: `sha256:${"d".repeat(64)}`,
    consumerVerified: true,
    broadcastCountAfterRecordedHash: 0,
    ...overrides,
  };
}

function actionHarness(result = completeEvidence()) {
  return {
    eventName: "merge_group",
    inputs: { manifest: "proofline.manifest.json", mode: "live" },
    env: {
      PROOFLINE_PROJECT_TOKEN: `project_${"e".repeat(64)}`,
      PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"f".repeat(64)}`,
      GITHUB_SHA: "a".repeat(40),
      PROOFLINE_TREE_HASH: "b".repeat(40),
    },
    client: {
      replayManifest: vi.fn(),
      runLive: vi.fn(async () => result) as any,
    },
    artifacts: {
      writeSummary: vi.fn(async () => undefined),
      upload: vi.fn(async () => undefined),
    },
  };
}

describe("Action production runtime coverage", () => {
  it("uses empty defaults only from the supplied environment", async () => {
    const runLive = vi.fn(async (value) => value);
    const dependencies = createProductionActionDependencies({
      environment: {},
      core: {
        getInput: vi.fn(() => ""),
        setFailed: vi.fn(),
        writeSummary: vi.fn(),
      },
      replayManifest: vi.fn(),
      runLive,
      uploadJson: vi.fn(),
    });
    expect(dependencies.eventName).toBe("");
    await dependencies.client.runLive({ manifestPath: "manifest.json" });
    expect(runLive).toHaveBeenCalledWith({ manifestPath: "manifest.json" });
  });

  it.each([0, 2])("maps action result %s to exit state and a generic failure", async (code) => {
    const setFailed = vi.fn();
    const setExitCode = vi.fn();
    await expect(
      runActionEntry({
        dependencies: {},
        runAction: vi.fn(async () => code),
        setFailed,
        setExitCode,
      }),
    ).resolves.toBe(code);
    expect(setExitCode).toHaveBeenCalledWith(code);
    if (code === 0) expect(setFailed).not.toHaveBeenCalled();
    else expect(setFailed).toHaveBeenCalledWith("Proofline release gate failed");
  });
});

describe("Action immutable live evidence coverage", () => {
  it("publishes every immutable identity field and no-rebroadcast evidence", async () => {
    const harness = actionHarness();
    await expect(runProoflineAction(harness)).resolves.toBe(0);
    expect(harness.artifacts.writeSummary).toHaveBeenCalledWith(
      expect.stringMatching(/Commit:.*Tree:.*No rebroadcast/s),
    );
    expect(harness.artifacts.upload).toHaveBeenCalledWith(
      "proofline-live-evidence",
      expect.objectContaining({ broadcastCountAfterRecordedHash: 0 }),
    );
  });

  it.each([
    ["commit", { commitHash: "" }],
    ["tree", { treeHash: "" }],
    ["broadcast count", { broadcastCountAfterRecordedHash: 1 }],
  ])("fails closed for invalid %s evidence", async (_label, override) => {
    const harness = actionHarness(completeEvidence(override));
    await expect(runProoflineAction(harness)).resolves.toBe(1);
    expect(harness.artifacts.upload).not.toHaveBeenCalled();
  });

  it("requires the opaque project token before live execution", async () => {
    const harness = actionHarness();
    harness.env = {} as any;
    await expect(runProoflineAction(harness)).resolves.toBe(1);
    expect(harness.client.runLive).not.toHaveBeenCalled();
  });
});
