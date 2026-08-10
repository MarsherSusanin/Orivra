// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

async function optionalModule(path: string): Promise<Record<string, any>> {
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

async function deploymentContracts(): Promise<Record<string, any>> {
  return optionalModule(pathToFileURL(fileURLToPath(
    new URL("../src/deployment.ts", import.meta.url),
  )).href);
}

const HEALTH = { version: "1", status: "ok" } as const;
const READY = {
  version: "1",
  status: "ready",
  checks: { database: "ready", schema: "ready", worker: "ready" },
} as const;

describe("Slice 027B deployment liveness/readiness public contracts", () => {
  it("exports one cycle-free deployment feature with root identity compatibility", async () => {
    const [feature, root, packageJson, source] = await Promise.all([
      deploymentContracts(),
      optionalModule(pathToFileURL(fileURLToPath(
        new URL("../src/index.ts", import.meta.url),
      )).href),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../src/deployment.ts", import.meta.url), "utf8").catch(() => ""),
    ]);
    expect(packageJson.exports?.["./deployment"]).toBe("./src/deployment.ts");
    expect(feature.DeploymentHealthV1Schema).toBeDefined();
    expect(feature.DeploymentReadinessV1Schema).toBeDefined();
    expect(root.DeploymentHealthV1Schema).toBe(feature.DeploymentHealthV1Schema);
    expect(root.DeploymentReadinessV1Schema)
      .toBe(feature.DeploymentReadinessV1Schema);
    expect(source).not.toMatch(/node:|process\.|fetch\s*\(|setTimeout|@proofline\/contracts(?:["'])/);
  });

  it("accepts only the exact process-only health response", async () => {
    const { DeploymentHealthV1Schema: schema } = await deploymentContracts();
    expect(schema).toBeDefined();
    expect(schema.parse(HEALTH)).toEqual(HEALTH);
    for (const invalid of [
      { version: 1, status: "ok" },
      { version: "1", status: "healthy" },
      { version: "1", status: "ok", checks: {} },
      { version: "1", status: "ok", message: "database ready" },
    ]) expect(() => schema.parse(invalid)).toThrow();
  });

  it("accepts exact ready and bounded honest not-ready component states", async () => {
    const { DeploymentReadinessV1Schema: schema } = await deploymentContracts();
    expect(schema).toBeDefined();
    const accepted = [
      READY,
      {
        version: "1",
        status: "not-ready",
        checks: {
          database: "unavailable",
          schema: "unavailable",
          worker: "unavailable",
        },
      },
      {
        version: "1",
        status: "not-ready",
        checks: {
          database: "ready",
          schema: "mismatch",
          worker: "unavailable",
        },
      },
      ...["unavailable", "missing", "stale"].map((worker) => ({
        version: "1",
        status: "not-ready",
        checks: { database: "ready", schema: "ready", worker },
      })),
    ];
    for (const value of accepted) expect(schema.parse(value)).toEqual(value);
  });

  it("rejects contradictory readiness, authority fields and unknown component states", async () => {
    const { DeploymentReadinessV1Schema: schema } = await deploymentContracts();
    expect(schema).toBeDefined();
    const invalid = [
      { ...READY, status: "not-ready" },
      {
        version: "1",
        status: "ready",
        checks: { database: "ready", schema: "ready", worker: "stale" },
      },
      {
        version: "1",
        status: "not-ready",
        checks: { database: "unavailable", schema: "ready", worker: "ready" },
      },
      {
        version: "1",
        status: "not-ready",
        checks: { database: "ready", schema: "mismatch", worker: "stale" },
      },
      {
        version: "1",
        status: "not-ready",
        checks: { database: "ready", schema: "ready", worker: "offline" },
      },
      { ...READY, deploymentId: `deployment_${"a".repeat(64)}` },
      { ...READY, checkedAt: "2026-08-10T00:00:00.000Z" },
      { ...READY, message: "postgres://secret@db.invalid/proofline" },
    ];
    for (const value of invalid) expect(() => schema.parse(value)).toThrow();
  });
});
