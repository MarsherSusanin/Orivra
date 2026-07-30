// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../packages/contracts/test/fixtures";
import { runProoflineAction } from "../packages/action/src/index";
import { runLiveCoston2Gate } from "../apps/worker/src/live-gate";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("production Coston2 composition", () => {
  it("exports the legacy runtime only from the isolated live-gate surface", async () => {
    const [pipelineModule, gateRuntimeModule] = await Promise.all([
      import("../apps/worker/src/live-runtime"),
      import("../apps/worker/src/live-gate-runtime"),
    ]);
    expect(pipelineModule).not.toHaveProperty("createLiveCoston2Runtime");
    expect(gateRuntimeModule.createLiveCoston2Runtime).toEqual(
      expect.any(Function),
    );
    expect(
      gateRuntimeModule.createLiveCoston2Runtime({ environment: {} }).kind,
    ).toBe("live");
  });

  it("uses the default live runtime factory when no test seam is supplied", async () => {
    const directory = await mkdtemp(`${tmpdir()}/proofline-live-gate-`);
    temporaryDirectories.push(directory);
    const manifestPath = `${directory}/manifest.json`;
    await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");
    const execute = vi.fn().mockResolvedValue({
      commitHash: "commit-a",
      treeHash: "tree-a",
      runId: "run_live",
      transactionHash: `0x${"a".repeat(64)}`,
      votingRound: "42871",
      proofChecksum: `sha256:${"b".repeat(64)}`,
      consumerVerified: true,
      broadcastCountAfterRecordedHash: 0,
    });
    const runtimeFactory = vi.fn().mockReturnValue({ kind: "live", execute });

    await expect(
      runLiveCoston2Gate({
        projectToken: `project_${"c".repeat(64)}`,
        privateKey: `0x${"d".repeat(64)}`,
        verifierApiKey: "verifier-secret",
        manifestPath,
        timeoutMs: 600_000,
        runtimeFactory,
      } as Parameters<typeof runLiveCoston2Gate>[0]),
    ).resolves.toMatchObject({ runId: "run_live", consumerVerified: true });
    expect(runtimeFactory).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
});

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
      await expect(readFile(`${repositoryRoot}/${artifact.startsWith("dist") ? packagePath.replace("package.json", artifact) : artifact}`)).resolves.toBeInstanceOf(Buffer);
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
