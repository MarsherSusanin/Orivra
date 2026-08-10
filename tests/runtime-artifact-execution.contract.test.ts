// @vitest-environment node

import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { validManifest } from "../packages/contracts/test/fixtures";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectories: string[] = [];

async function cleanBuild(workspace: string, artifact: string) {
  await rm(join(repositoryRoot, artifact), { force: true });
  await execFileAsync("npm", ["run", "build", "--workspace", workspace], {
    cwd: repositoryRoot,
    timeout: 30_000,
  });
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("clean-built executable package artifacts", () => {
  it("boots the worker far enough to fail fast on missing live configuration", async () => {
    const artifact = "apps/worker/dist/worker.js";
    await cleanBuild("@proofline/worker", artifact);

    const execution = spawnSync(process.execPath, [join(repositoryRoot, artifact)], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { NODE_ENV: "production" },
      timeout: 10_000,
    });
    const output = `${execution.stdout}\n${execution.stderr}`;

    expect(execution.status).not.toBe(0);
    expect(output).toContain("DEPLOYMENT_SECRET_CONFIGURATION_INVALID");
    expect(output).toContain("Deployment secret configuration is invalid");
    expect(output).not.toMatch(
      /DATABASE_URL|PROOFLINE_(?:VERIFIER|COSTON2|WORKER)|\/run\/secrets|postgres(?:ql)?:\/\/|private.?key|verifier.?api.?key/i,
    );
    expect(output).not.toMatch(
      /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b|fdc-verifiers|createWeb2JsonVerifierClient|new Pool|WORKER_READY|RUN_LIVE_COSTON2/i,
    );
    expect(output).not.toMatch(/Dynamic require of/i);
  });

  it("executes the Action artifact using its declared node20 contract", async () => {
    const artifact = "packages/action/dist/index.js";
    const descriptor = await readFile(
      join(repositoryRoot, "packages/action/action.yml"),
      "utf8",
    );
    const packageJson = JSON.parse(
      await readFile(
        join(repositoryRoot, "packages/action/package.json"),
        "utf8",
      ),
    ) as { scripts?: { build?: string }; engines?: { node?: string } };
    expect(descriptor).toMatch(/using:\s*node20/);
    expect(packageJson.scripts?.build).toContain("--target=node20");
    expect(packageJson.engines?.node).toMatch(/20/);

    const directory = await mkdtemp(join(tmpdir(), "proofline-action-red-"));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");
    await cleanBuild("@proofline/action", artifact);

    const execution = spawnSync(process.execPath, [join(repositoryRoot, artifact)], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        NODE_ENV: "production",
        GITHUB_EVENT_NAME: "pull_request",
        INPUT_MANIFEST: manifestPath,
      },
      timeout: 10_000,
    });
    const output = `${execution.stdout}\n${execution.stderr}`;

    expect(execution.status).toBe(1);
    expect(output).toMatch(/Proofline release gate|configuration/i);
    expect(output).not.toMatch(/Dynamic require of "?(?:os|node:os)"?/i);
  });
});
