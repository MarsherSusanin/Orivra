// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";

const readFile = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({ readFile }));

import { runLiveCoston2Gate } from "../src/live-gate";

const evidence = {
  commitHash: "a".repeat(40),
  treeHash: "b".repeat(40),
  runId: "run_live",
  transactionHash: `0x${"c".repeat(64)}`,
  votingRound: "42871",
  proofChecksum: `sha256:${"d".repeat(64)}`,
  consumerVerified: true,
  broadcastCountAfterRecordedHash: 0,
};

function configured() {
  return {
    projectToken: `project_${"a".repeat(64)}`,
    privateKey: "0xprivate-key",
    verifierApiKey: "verifier-key",
    manifestPath: "/fixtures/web2json.json",
    timeoutMs: 600_000,
  };
}

beforeEach(() => {
  readFile.mockReset();
  readFile.mockResolvedValue(JSON.stringify(validManifest));
});

describe("live Coston2 gate composition", () => {
  it.each([
    ["project token", { projectToken: "" }],
    ["private key", { privateKey: "short" }],
    ["verifier key", { verifierApiKey: " " }],
  ])("fails before reading the manifest when %s is absent", async (_label, override) => {
    const runtime = { kind: "live" as const, execute: vi.fn() };
    await expect(
      runLiveCoston2Gate({ ...configured(), ...override, runtime }),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(readFile).not.toHaveBeenCalled();
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it.each([0, -1, 600_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unsafe timeout %s",
    async (timeoutMs) => {
      const runtime = { kind: "live" as const, execute: vi.fn() };
      await expect(
        runLiveCoston2Gate({ ...configured(), timeoutMs, runtime }),
      ).rejects.toMatchObject({ kind: "configuration" });
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it("rejects missing or non-live runtime after validating the manifest", async () => {
    await expect(runLiveCoston2Gate(configured())).rejects.toMatchObject({
      kind: "configuration",
      message: expect.stringMatching(/runtime|replay|simulator/i),
    });
    expect(readFile).toHaveBeenCalledWith("/fixtures/web2json.json", "utf8");
  });

  it("passes validated input and a verifier client only to an injected live runtime", async () => {
    const runtime = {
      kind: "live" as const,
      execute: vi.fn().mockResolvedValue(evidence),
    };

    await expect(
      runLiveCoston2Gate({ ...configured(), runtime }),
    ).resolves.toEqual(evidence);
    expect(runtime.execute).toHaveBeenCalledWith({
      manifest: validManifest,
      projectToken: configured().projectToken,
      privateKey: configured().privateKey,
      verifier: expect.objectContaining({ prepareRequest: expect.any(Function) }),
      timeoutMs: 600_000,
    });
  });
});
