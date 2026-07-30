// @vitest-environment node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runProoflineCli } from "../src/index";

const helpCases = [
  ["--help"],
  ["help"],
  ["run", "--help"],
  ["run", "create", "--help"],
  ["bundle", "export", "--help"],
  ["replay", "--help"],
] as const;

function unitHarness(argv: string[]) {
  return {
    argv,
    client: new Proxy(
      {},
      {
        get: () =>
          vi.fn(async () => {
            throw new Error("Help must not construct or call an API client");
          }),
      },
    ) as Record<string, (...args: any[]) => Promise<any>>,
    wallet: {
      signAndBroadcast: vi.fn(async () => {
        throw new Error("Help must not construct or call a wallet");
      }),
    },
    env: {},
    io: { stdout: vi.fn(), stderr: vi.fn() },
    files: {
      readText: vi.fn(async () => {
        throw new Error("Help must not read command inputs");
      }),
      writeText: vi.fn(async () => undefined),
    },
  };
}

describe("Slice 008 credential-free CLI help", () => {
  it.each(helpCases)(
    "returns zero for proofline %s before production dependency construction",
    async (...argv) => {
      const harness = unitHarness([...argv]);
      await expect(runProoflineCli(harness)).resolves.toBe(0);
      expect(harness.io.stdout).toHaveBeenCalledWith(
        expect.stringMatching(/proofline|usage|commands/i),
      );
      expect(harness.io.stderr).not.toHaveBeenCalled();
      expect(harness.files.readText).not.toHaveBeenCalled();
      expect(harness.wallet.signAndBroadcast).not.toHaveBeenCalled();
    },
  );

  it.each(helpCases)(
    "the packaged CLI exits zero offline for %s",
    (...argv) => {
      const executable = fileURLToPath(
        new URL("../dist/index.js", import.meta.url),
      );
      const result = spawnSync(process.execPath, [executable, ...argv], {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          NODE_NO_WARNINGS: "1",
        },
        timeout: 10_000,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/proofline|usage|commands/i);
      expect(result.stderr).not.toMatch(
        /PROOFLINE_API_URL|PROJECT_TOKEN|PRIVATE_KEY|at\s+\S+:\d+/i,
      );
    },
  );
});
