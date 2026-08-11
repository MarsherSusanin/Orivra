// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

type ActionRuntimeModule = {
  createProductionActionDependencies?: (input: Record<string, unknown>) => any;
  runActionEntry?: (input: Record<string, unknown>) => Promise<number>;
};

async function loadRuntime(): Promise<Required<ActionRuntimeModule>> {
  const module = (await import("../src/runtime")) as ActionRuntimeModule;
  expect(module.createProductionActionDependencies).toEqual(expect.any(Function));
  expect(module.runActionEntry).toEqual(expect.any(Function));
  if (!module.createProductionActionDependencies || !module.runActionEntry) {
    throw new Error("Slice 004 production Action runtime is missing");
  }
  return module as Required<ActionRuntimeModule>;
}

describe("Slice 004 GitHub Action production adapter", () => {
  it("builds replay/live/artifact dependencies from supplied adapters, not globals", async () => {
    const { createProductionActionDependencies } = await loadRuntime();
    const replayManifest = vi.fn(async () => ({
      runId: "run_replay",
      checksum: `sha256:${"a".repeat(64)}`,
    }));
    const runLive = vi.fn(async () => ({
      commitHash: "b".repeat(40),
      treeHash: "c".repeat(40),
      runId: "run_live",
      transactionHash: `0x${"d".repeat(64)}`,
      votingRound: "42871",
      proofChecksum: `sha256:${"e".repeat(64)}`,
      consumerVerified: true,
      broadcastCountAfterRecordedHash: 0,
    }));
    const uploadJson = vi.fn(async () => undefined);
    const environment = {
      GITHUB_EVENT_NAME: "merge_group",
      PROOFLINE_PROJECT_TOKEN: `project_${"f".repeat(64)}`,
      PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"1".repeat(64)}`,
      PROOFLINE_VERIFIER_API_KEY: "verifier-test-key",
    };

    const dependencies = createProductionActionDependencies({
      environment,
      core: {
        getInput: vi.fn((name: string) =>
          name === "manifest" ? "proofline.manifest.json" : "live",
        ),
        setFailed: vi.fn(),
        writeSummary: vi.fn(),
      },
      replayManifest,
      runLive,
      uploadJson,
    });

    expect(dependencies).toMatchObject({
      eventName: "merge_group",
      inputs: { manifest: "proofline.manifest.json", mode: "live" },
      env: {
        GITHUB_EVENT_NAME: "merge_group",
        PROOFLINE_PROJECT_TOKEN: environment.PROOFLINE_PROJECT_TOKEN,
      },
    });
    expect(dependencies.env).not.toHaveProperty("PROOFLINE_COSTON2_PRIVATE_KEY");
    expect(dependencies.env).not.toHaveProperty("PROOFLINE_VERIFIER_API_KEY");
    await dependencies.client.runLive({
      manifestPath: "proofline.manifest.json",
      network: "coston2",
      timeoutMs: 600_000,
      rebroadcastAfterTransactionHash: false,
    });
    await dependencies.artifacts.upload("proofline-live-evidence", {
      runId: "run_live",
    });
    expect(runLive).toHaveBeenCalledWith({
      manifestPath: "proofline.manifest.json",
      network: "coston2",
      timeoutMs: 600_000,
      rebroadcastAfterTransactionHash: false,
    });
    expect(uploadJson).toHaveBeenCalledWith(
      "proofline-live-evidence",
      { runId: "run_live" },
    );
  });

  it("publishes only a generic failure when entry execution throws", async () => {
    const { runActionEntry } = await loadRuntime();
    const setFailed = vi.fn();
    const setExitCode = vi.fn();

    await expect(
      runActionEntry({
        dependencies: {},
        runAction: vi.fn(async () => {
          throw new Error("Bearer project_secret privateKey=0xdeadbeef");
        }),
        setFailed,
        setExitCode,
      }),
    ).resolves.toBe(1);
    expect(setFailed).toHaveBeenCalledWith(
      "Orivra release gate failed without publishable detail",
    );
    expect(JSON.stringify(setFailed.mock.calls)).not.toMatch(
      /project_secret|deadbeef/i,
    );
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});
