// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prooflineHelp } from "../src/index";

describe("Slice 027D Orivra CLI display brand", () => {
  it("shows Orivra as the product while retaining the proofline command grammar", () => {
    const help = prooflineHelp([]);
    expect(help).toContain("Orivra Web2Json release client");
    expect(help).toContain("Usage: proofline <command> [options]");
    expect(help).toContain("Run proofline <command> --help for command options.");
    expect(help).not.toContain("Proofline Web2Json release client");
  });

  it("preserves the installed bin and package compatibility identity", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.name).toBe("@proofline/cli");
    expect(manifest.bin).toEqual({ proofline: "./dist/index.js" });
  });

  it("removes the old display label from CLI strings without renaming symbols", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    const withoutStableSymbols = source
      .replaceAll("runProoflineCli", "")
      .replaceAll("prooflineHelp", "");
    expect(withoutStableSymbols).not.toContain("Proofline");
    expect(source).toContain("runProoflineCli");
    expect(source).toContain("Usage: proofline");
  });
});
