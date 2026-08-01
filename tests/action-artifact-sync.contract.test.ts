// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const actionRoot = join(repositoryRoot, "packages/action");
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("checked-in GitHub Action artifact", () => {
  it("is byte-identical to a clean deterministic build without mutating the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofline-action-sync-"));
    temporaryDirectories.push(directory);
    const cleanArtifact = join(directory, "index.js");

    await execFileAsync(
      join(repositoryRoot, "node_modules/.bin/esbuild"),
      [
        "src/entry.ts",
        "--bundle",
        "--minify",
        "--platform=node",
        "--format=esm",
        "--target=node20",
        '--define:process.env.NODE_ENV="production"',
        '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
        `--outfile=${cleanArtifact}`,
      ],
      { cwd: actionRoot, timeout: 30_000 },
    );

    const [checkedIn, clean] = await Promise.all([
      readFile(join(actionRoot, "dist/index.js")),
      readFile(cleanArtifact),
    ]);
    expect(checkedIn.equals(clean)).toBe(true);
  });
});
