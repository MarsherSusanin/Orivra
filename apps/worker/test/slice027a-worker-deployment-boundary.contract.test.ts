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

  it("keeps worker HTTP authority absent and starts the worker-owned 027B heartbeat only after full composition", async () => {
    const [source, apiBootstrap, entry] = await Promise.all([
      readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../../api/src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/entry.ts", import.meta.url), "utf8"),
    ]);
    expect(source).not.toMatch(/createServer|\.listen\(|\/healthz|\/readyz/);

    const start = source.indexOf("export async function startProductionWorker");
    const body = source.slice(start);
    const secrets = body.indexOf("resolveDeploymentEnvironment");
    const verifier = body.indexOf("createWeb2JsonVerifierClient");
    const schema = body.indexOf("verifyDeploymentSchema");
    const worker = body.indexOf("createProductionWorker");
    const lifecycle = body.indexOf('for (const signal of ["SIGINT", "SIGTERM"]');
    const heartbeatStart = body.indexOf("heartbeatStore.start");
    const claimLoop = body.indexOf("runWorkerLoop");
    expect(secrets).toBeGreaterThanOrEqual(0);
    expect(verifier).toBeGreaterThan(secrets);
    expect(schema).toBeGreaterThan(verifier);
    expect(worker).toBeGreaterThan(schema);
    expect(lifecycle).toBeGreaterThan(worker);
    expect(heartbeatStart).toBeGreaterThan(lifecycle);
    expect(claimLoop).toBeGreaterThan(heartbeatStart);
    expect(body).toMatch(/await heartbeatStore\.start\([^;]+;\s*await runWorkerLoop\(/s);

    expect(apiBootstrap).not.toMatch(
      /createPostgresDeploymentHeartbeatStore|refreshAndCleanup|deploymentHeartbeat\.start/i,
    );
    expect(`${source}\n${entry}`).not.toMatch(
      /heartbeat-only|heartbeat.?sidecar|NODE_ENV\s*===?\s*["']test["']|test.?adapter/i,
    );
  });
});
