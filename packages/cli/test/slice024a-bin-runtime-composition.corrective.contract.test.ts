// @vitest-environment node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeRuntimeInput } from "../../fdc-coston2/test/slice024a-runtime-recording.fixtures";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
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

  it("normalizes a built-bin missing source without external network, write or path disclosure", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "proofline-024a-built-source-"),
    );
    const copiedCliPath = join(
      temporaryRoot,
      "packages/cli/dist/index.js",
    );
    const outputPath = join(temporaryRoot, "recording.json");
    const input = makeRuntimeInput();
    mkdirSync(dirname(copiedCliPath), { recursive: true });
    copyFileSync(builtCliPath, copiedCliPath);
    symlinkSync(join(repoRoot, "node_modules"), join(temporaryRoot, "node_modules"));
    const bootstrap = `
      import { pathToFileURL } from "node:url";
      const bundles = JSON.parse(process.env.PROOFLINE_TEST_BUNDLES);
      let fetchCalls = 0;
      globalThis.fetch = async (request) => {
        fetchCalls += 1;
        const url = String(request);
        const body = url.includes(encodeURIComponent(bundles.attackRunId))
          ? bundles.attackBundle
          : url.includes(encodeURIComponent(bundles.controlRunId))
            ? bundles.controlBundle
            : undefined;
        if (body === undefined) throw new Error("unexpected mocked API path");
        return new Response(body, { status: 200 });
      };
      process.argv = [process.execPath, process.env.PROOFLINE_TEST_BIN,
        ...JSON.parse(process.env.PROOFLINE_TEST_ARGV)];
      await import(pathToFileURL(process.env.PROOFLINE_TEST_BIN).href);
      if (fetchCalls !== 2) throw new Error("expected exactly two mocked bundle reads");
    `;

    try {
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", bootstrap],
        {
          cwd: temporaryRoot,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            NODE_NO_WARNINGS: "1",
            PROOFLINE_API_URL: "https://api.example.invalid",
            PROOFLINE_PROJECT_TOKEN: "project_test_only_scoped_token_024a",
            PROOFLINE_TEST_BIN: copiedCliPath,
            PROOFLINE_TEST_BUNDLES: JSON.stringify(input),
            PROOFLINE_TEST_ARGV: JSON.stringify([
              "demo",
              "record",
              "--attack-run",
              input.attackRunId,
              "--control-run",
              input.controlRunId,
              "--commit",
              input.release.commitSha,
              "--tree",
              input.release.treeSha,
              "--out",
              outputPath,
            ]),
          },
          timeout: 20_000,
        },
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(
        "Canonical URL attack source read failed",
      );
      expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(96);
      expect(result.stderr).not.toMatch(
        /ENOENT|EACCES|file:\/\/|\/Users\/|Canonical(?:Safe|Vulnerable)|ProoflineUrlInvariant|\.sol|\bat\s+\S+[:(]\d+/i,
      );
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
