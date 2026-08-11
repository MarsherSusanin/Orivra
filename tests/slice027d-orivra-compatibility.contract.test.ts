// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

async function text(path: string): Promise<string> {
  return readFile(new URL(path, `file://${root}/`), "utf8");
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await text(path)) as Record<string, unknown>;
}

describe("Slice 027D stable Proofline technical compatibility", () => {
  it("preserves every workspace package identity and the CLI executable", async () => {
    const manifests = await Promise.all([
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "apps/worker/package.json",
      "packages/action/package.json",
      "packages/cli/package.json",
      "packages/contracts/package.json",
      "packages/domain/package.json",
      "packages/fdc-coston2/package.json",
    ].map(json));
    expect(manifests.map((manifest) => manifest.name)).toEqual([
      "proofline",
      "@proofline/api",
      "@proofline/web",
      "@proofline/worker",
      "@proofline/action",
      "@proofline/cli",
      "@proofline/contracts",
      "@proofline/domain",
      "@proofline/fdc-coston2",
    ]);
    expect(manifests[5]?.bin).toEqual({ proofline: "./dist/index.js" });
  });

  it("preserves database, env, storage and idempotency namespaces", async () => {
    const sources = await Promise.all([
      "apps/api/src/db-role-bootstrap-core.ts",
      "apps/api/src/production-service.ts",
      "apps/api/src/wallet-session-service.ts",
      "src/App.tsx",
      "src/services/composer-draft-store.ts",
      "src/services/run-client.ts",
      "src/services/wallet-session-controller.ts",
      "packages/domain/src/product-analytics.ts",
    ].map(text));
    const joined = sources.join("\n");
    for (const value of [
      "proofline_private",
      "proofline_api_login",
      "proofline_worker_login",
      "proofline_recording_importer_login",
      "proofline_migrator_login",
      "proofline_backup_login",
      "proofline:quota:project-run-day:v1",
      "proofline:composer-draft:v1",
      "proofline:last-run",
      "proofline:project-token",
      "proofline:product-analytics:v1",
      ".proofline.json",
    ]) {
      expect(joined).toContain(value);
    }
    expect(joined).toContain("PROOFLINE_");
  });

  it("preserves Solidity, media-type, Docker and object-storage identities", async () => {
    const joined = (await Promise.all([
      "apps/api/src/app.ts",
      "apps/worker/src/worker.ts",
      "contracts/ProoflineUrlInvariant.sol",
      "packages/contracts/src/index.ts",
      "scripts/docker-smoke.mjs",
      "scripts/backup-evidence-validation.mjs",
      "deploy/compose.runtime.yaml",
    ].map(text))).join("\n");
    for (const value of [
      "ProoflineUrlInvariant",
      "ProoflineExactProofVerifier",
      "ProoflineSafeWeb2JsonConsumer",
      "application/vnd.proofline.canonical-url-attack-recording.v1+json",
      "proofline-027a-",
      "proofline/caddy:027a-qa",
      "/run/proofline/replay/bundle.json",
      "/proofline/v1/",
    ]) {
      expect(joined).toContain(value);
    }
  });

  it("keeps historical test origins and Sites routing compatibility", async () => {
    const origins = (await Promise.all([
      "apps/api/test/slice023a-wallet-auth-pure.contract.test.ts",
      "apps/api/test/slice023a-wallet-auth-routes.contract.test.ts",
      "tests/slice025-template-deep-route.contract.test.mjs",
    ].map(text))).join("\n");
    expect(origins).toContain("proofline.example");
    expect(origins).toContain("proofline.test");

    const [worker, hosting, packaging, sitesTest] = await Promise.all([
      text("worker/index.js"),
      text(".openai/hosting.json"),
      text("scripts/prepare-sites-build.mjs"),
      text("tests/sites-worker.test.mjs"),
    ]);
    expect(worker).toContain("/index.html");
    expect(hosting).toBe('{\n  "d1": null,\n  "r2": null\n}\n');
    expect(packaging).toContain("dist/.openai/hosting.json");
    expect(sitesTest).toContain("does not turn missing API or write requests into the app shell");
  });
});
