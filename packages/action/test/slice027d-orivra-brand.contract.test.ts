// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { runProoflineAction } from "../src/index";

describe("Slice 027D Orivra Action display brand", () => {
  it("brands public Action metadata as Orivra while preserving input and runtime IDs", async () => {
    const action = await readFile(new URL("../action.yml", import.meta.url), "utf8");
    expect(action).toMatch(/^name: Orivra Web2Json$/m);
    expect(action).toMatch(/^description: Replay an Orivra bundle/m);
    expect(action).toMatch(/^  (manifest|mode|bundle):$/gm);
    expect(action.match(/^  (manifest|mode|bundle):$/gm)).toHaveLength(3);
    expect(action).toContain("default: fixtures/proofline.bundle.json");
    expect(action).toContain("main: dist/index.js");
  });

  it("writes an Orivra summary but preserves the proofline artifact identity", async () => {
    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };
    await expect(runProoflineAction({
      eventName: "pull_request",
      inputs: { manifest: "fixture.json" },
      env: {},
      client: {
        replayManifest: vi.fn(async () => ({
          runId: "run_replay",
          checksum: `sha256:${"a".repeat(64)}`,
        })),
        runLive: vi.fn(),
      },
      artifacts,
    })).resolves.toBe(0);
    expect(artifacts.writeSummary).toHaveBeenCalledWith(expect.stringMatching(/^Orivra replay/m));
    expect(artifacts.upload).toHaveBeenCalledWith(
      "proofline-replay-evidence",
      expect.objectContaining({ runId: "run_replay" }),
    );
  });

  it("preserves release environment and artifact identifiers", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    const runtime = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8");
    for (const identifier of [
      "PROOFLINE_API_URL",
      "PROOFLINE_PROJECT_TOKEN",
      "PROOFLINE_REPLAY_BUNDLE_PATH",
      "PROOFLINE_TREE_HASH",
      "proofline-replay-evidence",
      "proofline-live-evidence",
    ]) {
      expect(`${source}\n${runtime}`).toContain(identifier);
    }
  });

  it("requires the checked-in generated Action artifact to carry the new display strings", async () => {
    const artifact = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
    expect(artifact).toContain("Orivra replay");
    expect(artifact).toContain("proofline-replay-evidence");
    expect(artifact).not.toContain("Proofline replay");
  });
});
