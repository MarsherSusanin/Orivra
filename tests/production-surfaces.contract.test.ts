// @vitest-environment node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { runProoflineAction } from "../packages/action/src/index";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("runnable package artifacts", () => {
  it.each([
    ["@proofline/api", "apps/api/package.json", "dist/server.js", true],
    ["@proofline/worker", "apps/worker/package.json", "dist/worker.js", true],
    ["@proofline/cli", "packages/cli/package.json", "dist/index.js", false],
    ["@proofline/action", "packages/action/package.json", "dist/index.js", false],
  ] as const)(
    "clean-builds %s and exposes its declared executable artifact",
    async (workspace, packagePath, artifact, needsStart) => {
      const packageJson = JSON.parse(
        await readFile(`${repositoryRoot}/${packagePath}`, "utf8"),
      ) as {
        main?: string;
        bin?: Record<string, string>;
        scripts?: Record<string, string>;
        engines?: Record<string, string>;
      };
      expect(packageJson.scripts?.build).toEqual(expect.any(String));
      if (needsStart) {
        expect(packageJson.scripts?.start).toEqual(expect.any(String));
        expect(packageJson.engines?.node).toMatch(/22/);
      }
      expect([packageJson.main, ...Object.values(packageJson.bin ?? {})]).toContain(
        `./${artifact}`,
      );

      await execFileAsync("npm", ["run", "build", "--workspace", workspace], {
        cwd: repositoryRoot,
        timeout: 30_000,
      });
    },
  );
});

describe("GitHub Action release evidence", () => {
  it("fails a merge-group run whose live evidence omits commit or tree identity", async () => {
    const writeSummary = vi.fn();
    const result = await runProoflineAction({
      eventName: "merge_group",
      inputs: { manifest: "manifest.json" },
      env: {
        PROOFLINE_PROJECT_TOKEN: "project-token",
        PROOFLINE_COSTON2_PRIVATE_KEY: "private-key",
      },
      client: {
        replayManifest: vi.fn(),
        runLive: vi.fn().mockResolvedValue({
          runId: "run_live",
          transactionHash: `0x${"a".repeat(64)}`,
          votingRound: "42871",
          proofChecksum: `sha256:${"b".repeat(64)}`,
          consumerVerified: true,
          broadcastCountAfterRecordedHash: 0,
        }),
      },
      artifacts: { writeSummary, upload: vi.fn() },
    } as Parameters<typeof runProoflineAction>[0]);
    expect(result).toBe(1);
    expect(writeSummary).toHaveBeenCalledWith(expect.stringMatching(/commit|tree/i));
  });

  it("publishes complete immutable live evidence and proves no recovery rebroadcast", async () => {
    const writeSummary = vi.fn();
    const upload = vi.fn();
    const evidence = {
      commitHash: "commit-a",
      treeHash: "tree-a",
      runId: "run_live",
      transactionHash: `0x${"a".repeat(64)}`,
      votingRound: "42871",
      proofChecksum: `sha256:${"b".repeat(64)}`,
      consumerVerified: true,
      broadcastCountAfterRecordedHash: 0,
    };
    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: "manifest.json" },
        env: {
          PROOFLINE_PROJECT_TOKEN: "project-token",
          PROOFLINE_COSTON2_PRIVATE_KEY: "private-key",
        },
        client: { replayManifest: vi.fn(), runLive: vi.fn().mockResolvedValue(evidence) },
        artifacts: { writeSummary, upload },
      } as Parameters<typeof runProoflineAction>[0]),
    ).resolves.toBe(0);
    expect(writeSummary).toHaveBeenCalledWith(
      expect.stringMatching(/commit-a[\s\S]+tree-a[\s\S]+no rebroadcast/i),
    );
    expect(upload).toHaveBeenCalledWith("proofline-live-evidence", evidence);
  });
});
