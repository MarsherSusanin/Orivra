// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Slice 027A worker container bootstrap boundary", () => {
  it("uses the shared strict worker secret profile before Pool or verifier composition", async () => {
    const source = await readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
    expect(source).toMatch(/@proofline\/api\/src\/deployment-secrets/);
    expect(source).toMatch(/await\s+resolveDeploymentEnvironment\(\s*["']worker["']/);
    const start = source.indexOf("export async function startProductionWorker");
    const body = source.slice(start);
    expect(body.indexOf("resolveDeploymentEnvironment")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("resolveDeploymentEnvironment")).toBeLessThan(body.indexOf("new Pool"));
    expect(body.indexOf("resolveDeploymentEnvironment")).toBeLessThan(
      body.indexOf("createWeb2JsonVerifierClient"),
    );
  });

  it("keeps live authority fail-closed with no dummy secret or production test adapter", async () => {
    const [bootstrap, entry] = await Promise.all([
      readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/entry.ts", import.meta.url), "utf8"),
    ]);
    expect(bootstrap).toMatch(/PROOFLINE_VERIFIER_API_KEY/);
    expect(bootstrap).toMatch(/PROOFLINE_COSTON2_PRIVATE_KEY|createLiveCoston2PipelinePorts/);
    expect(`${bootstrap}\n${entry}`).not.toMatch(
      /dummy|fixture|test-system|synthetic|NODE_ENV\s*===?\s*["']test["']/i,
    );
  });

  it("does not invent worker HTTP health or readiness before Slice 027B", async () => {
    const source = await readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/createServer|\.listen\(|\/healthz|\/readyz/);
    expect(source).not.toMatch(/deployment[_-]?heartbeat/i);
  });
});
