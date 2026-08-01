// @vitest-environment node

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("production client truth", () => {
  it("excludes fabricated cockpit defaults from clean-built browser chunks", async () => {
    await execFileAsync("npm", ["run", "build"], {
      cwd: repositoryRoot,
      timeout: 60_000,
    });

    const assetsDirectory = join(repositoryRoot, "dist/client/assets");
    const chunks = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".js"));
    expect(chunks.length).toBeGreaterThan(0);
    const clientArtifact = (
      await Promise.all(
        chunks.map((name) => readFile(join(assetsDirectory, name), "utf8")),
      )
    ).join("\n");

    for (const marker of [
      "ETH/USD snapshot",
      "0.012345 ETH",
      "42871",
      "0x9f3e0000000000000000000000007ab2c1d4",
      "api.example.com",
      "CONSUMER_INVARIANT_MISSING",
    ]) {
      expect(clientArtifact, `production client contains demo marker: ${marker}`).not.toContain(
        marker,
      );
    }
  }, 70_000);
});
