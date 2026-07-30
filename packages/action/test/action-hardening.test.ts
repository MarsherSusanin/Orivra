// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { runProoflineAction } from "../src/index";

function harness() {
  return {
    client: {
      replayManifest: vi.fn().mockResolvedValue({
        runId: "run_replay",
        checksum: `sha256:${"a".repeat(64)}`,
      }),
      runLive: vi.fn().mockResolvedValue({
        runId: "run_live",
        transactionHash: `0x${"b".repeat(64)}`,
        votingRound: "42871",
        proofChecksum: `sha256:${"c".repeat(64)}`,
        consumerVerified: true,
      }),
    },
    artifacts: {
      writeSummary: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function liveInput(deps: ReturnType<typeof harness>) {
  return {
    eventName: "merge_group",
    inputs: { manifest: "proofline.manifest.json" },
    env: {
      PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
      PROOFLINE_COSTON2_PRIVATE_KEY: "0xlocal-secret",
    },
    ...deps,
  };
}

describe("GitHub Action evidence hardening", () => {
  it("uploads the replay evidence only after the summary is written", async () => {
    const deps = harness();
    const order: string[] = [];
    deps.artifacts.writeSummary.mockImplementation(async () => {
      order.push("summary");
    });
    deps.artifacts.upload.mockImplementation(async () => {
      order.push("upload");
    });

    await expect(
      runProoflineAction({
        eventName: "pull_request",
        inputs: { manifest: "proofline.manifest.json" },
        env: {},
        ...deps,
      }),
    ).resolves.toBe(0);
    expect(order).toEqual(["summary", "upload"]);
    expect(deps.artifacts.upload).toHaveBeenCalledWith(
      "proofline-replay-evidence",
      expect.objectContaining({ runId: "run_replay" }),
    );
  });

  it.each([
    ["transaction hash", { transactionHash: "" }],
    ["voting round", { votingRound: "" }],
    ["proof checksum", { proofChecksum: "" }],
    ["consumer verification", { consumerVerified: false }],
  ])("fails closed when live %s evidence is incomplete", async (_label, override) => {
    const deps = harness();
    deps.client.runLive.mockResolvedValue({
      ...(await deps.client.runLive()),
      ...override,
    });
    deps.client.runLive.mockClear();

    await expect(runProoflineAction(liveInput(deps))).resolves.toBe(1);
    expect(deps.artifacts.writeSummary).toHaveBeenCalledWith(
      expect.stringMatching(/evidence is incomplete/i),
    );
    expect(deps.artifacts.upload).not.toHaveBeenCalled();
  });

  it("publishes no exception detail and uploads nothing if the live client throws", async () => {
    const deps = harness();
    deps.client.runLive.mockRejectedValue(
      new Error("Bearer project_secret privateKey=0xdeadbeef"),
    );

    await expect(runProoflineAction(liveInput(deps))).resolves.toBe(1);
    expect(deps.artifacts.writeSummary).toHaveBeenCalledWith(
      "Proofline live Coston2 gate failed without publishable evidence.",
    );
    expect(JSON.stringify(deps.artifacts.writeSummary.mock.calls)).not.toMatch(
      /project_secret|deadbeef/i,
    );
    expect(deps.artifacts.upload).not.toHaveBeenCalled();
  });

  it("uploads complete live evidence after writing its release summary", async () => {
    const deps = harness();
    const order: string[] = [];
    deps.artifacts.writeSummary.mockImplementation(async () => {
      order.push("summary");
    });
    deps.artifacts.upload.mockImplementation(async () => {
      order.push("upload");
    });

    await expect(runProoflineAction(liveInput(deps))).resolves.toBe(0);
    expect(order).toEqual(["summary", "upload"]);
    expect(deps.artifacts.upload).toHaveBeenCalledWith(
      "proofline-live-evidence",
      expect.objectContaining({ runId: "run_live", consumerVerified: true }),
    );
  });
});
