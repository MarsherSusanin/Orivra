// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import { runProoflineCli } from "../src/index";

describe("Slice 017 CLI explicit persisted replay confirmation", () => {
  it("confirms the immutable replay mode once after run creation without wallet effects", async () => {
    const createRun = vi.fn().mockResolvedValue({ runId: "run_replay_017" });
    const prepareSubmission = vi.fn().mockResolvedValue({
      version: "1",
      runId: "run_replay_017",
      mode: "replay",
      effectOwner: "none",
      commandId: "command_replay_017",
    });
    const wallet = { signAndBroadcast: vi.fn() };
    const output: string[] = [];

    await expect(runProoflineCli({
      argv: ["run", "create", "--manifest", "manifest.json", "--mode", "replay"],
      client: {
        createRun,
        prepareSubmission,
        attachTransaction: vi.fn(),
      },
      wallet,
      env: {},
      io: {
        stdout: (line) => output.push(line),
        stderr: (line) => output.push(`ERR:${line}`),
      },
      files: {
        readText: vi.fn(async () => JSON.stringify({
          ...validManifest,
          submission: { ...validManifest.submission, mode: "replay" },
        })),
        writeText: vi.fn(),
      },
    })).resolves.toBe(0);

    expect(createRun).toHaveBeenCalledOnce();
    expect(prepareSubmission).toHaveBeenCalledOnce();
    expect(prepareSubmission).toHaveBeenCalledWith({
      runId: "run_replay_017",
      mode: "replay",
    });
    expect(wallet.signAndBroadcast).not.toHaveBeenCalled();
    expect(output.join("\n")).toMatch(/run_replay_017/i);
  });
});
