// @vitest-environment node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const binSourcePath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const builtCliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const cliPackagePath = fileURLToPath(new URL("../package.json", import.meta.url));

describe("Slice 024A packaged runtime authority composition", () => {
  it("wires the concrete FDC compiler/EVM runtime into the production bin", () => {
    const source = readFileSync(binSourcePath, "utf8");
    const packageJson = JSON.parse(readFileSync(cliPackagePath, "utf8"));

    expect(packageJson.dependencies).toHaveProperty("@proofline/fdc-coston2");
    expect(source).toMatch(/createProductionCanonicalUrlAttackRuntime/);
    expect(source).toMatch(
      /demoRecorder\s*:\s*(?:canonicalUrlAttackRuntime|createProductionCanonicalUrlAttackRuntime)/,
    );
    expect(source).not.toMatch(/demoRecorder\?\?|recorder is unavailable/i);
  });

  it("returns bounded exit 2 for missing production config without a stack or absolute path", () => {
    const result = spawnSync(
      process.execPath,
      [
        builtCliPath,
        "demo",
        "record",
        "--attack-run",
        "run_attack",
        "--control-run",
        "run_control",
        "--commit",
        "a".repeat(40),
        "--tree",
        "b".repeat(40),
        "--out",
        "recording.json",
      ],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1" },
        timeout: 10_000,
      },
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/PROOFLINE_API_URL.*PROOFLINE_PROJECT_TOKEN/i);
    expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(512);
    expect(result.stderr).not.toMatch(
      /file:\/\/|\/Users\/|Proofline\/packages\/|\bat\s+\S+[:(]\d+/i,
    );
  });
});
