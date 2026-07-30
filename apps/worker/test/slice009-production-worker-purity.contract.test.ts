// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = resolve(root, "apps/worker/src/entry.ts");
const bootstrap = resolve(root, "apps/worker/src/bootstrap.ts");
const liveRuntime = resolve(root, "apps/worker/src/live-runtime.ts");
const legacyLiveGate = resolve(root, "apps/worker/src/live-gate.ts");
const workerArtifact = resolve(root, "apps/worker/dist/worker.js");

function sourceImportGraph(start: string): Map<string, string> {
  const visited = new Map<string, string>();
  const visit = (file: string) => {
    if (visited.has(file)) return;
    const source = readFileSync(file, "utf8");
    visited.set(file, source);
    const specifiers = [
      ...source.matchAll(/from\s+["'](\.[^"']+)["']/g),
      ...source.matchAll(/import\s+["'](\.[^"']+)["']/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const candidate = resolve(dirname(file), specifier);
      const resolved = [
        ...(extname(candidate) ? [candidate] : []),
        `${candidate}.ts`,
        `${candidate}.tsx`,
        resolve(candidate, "index.ts"),
      ].find(existsSync);
      if (resolved?.startsWith(resolve(root, "apps/worker/src"))) visit(resolved);
    }
  };
  visit(start);
  return visited;
}

function matchingLabels(
  source: string,
  rules: ReadonlyArray<readonly [label: string, pattern: RegExp]>,
): string[] {
  return rules
    .filter(([, pattern]) => pattern.test(source))
    .map(([label]) => label);
}

describe("Slice 009 production worker purity", () => {
  it("keeps injectable legacy custody and synthetic handlers out of the entry graph", () => {
    const graph = sourceImportGraph(entry);
    const combined = [...graph.entries()]
      .map(([file, source]) => `${relative(root, file)}\n${source}`)
      .join("\n");

    expect(
      matchingLabels(combined, [
        ["injectable createRuntime input", /createRuntime\s*\?/],
        ["compatibility runtime composition", /compatibilityRuntime/],
        ["project token custody field", /projectToken|PROJECT_TOKEN/],
        ["private key execution transport", /execution\.privateKey|["']private["']\s*\+\s*["']Key["']/],
        ["wildcard private-key lookup", /endsWith\(["']PRIVATE_KEY["']\)/],
        ["synthetic live command", /RUN_LIVE_COSTON2|["']RUN["']\s*,\s*["']LIVE["']\s*,\s*["']COSTON2["']/],
        ["legacy credential error", /Legacy test credentials/],
      ]),
    ).toEqual([]);
    expect([...graph.keys()]).not.toContain(legacyLiveGate);
  });

  it("ships no project-token/private-key execution compatibility path", () => {
    expect(existsSync(workerArtifact), "build @proofline/worker before this gate").toBe(
      true,
    );
    const artifact = readFileSync(workerArtifact, "utf8");

    expect(
      matchingLabels(artifact, [
        ["project-token environment compatibility", /PROJECT_TOKEN/],
        ["projectToken execution field", /projectToken/],
        ["privateKey execution field", /\[\s*["']privateKey["']\s*\]\s*:/],
        ["wildcard private-key lookup", /endsWith\(["']PRIVATE_KEY["']\)/],
        ["injectable compatibility runtime", /compatibilityRuntime|createRuntime\?\./],
        ["synthetic live handler marker", /RUN_LIVE_COSTON2|\[\s*["']RUN["']\s*,\s*["']LIVE["']\s*,\s*["']COSTON2["']\s*\]/],
        ["legacy credential error", /Legacy test credentials/],
      ]),
    ).toEqual([]);
  });

  it("allows the worker-owned relayer key only inside the persisted live pipeline", () => {
    const source = readFileSync(liveRuntime, "utf8");
    const pipelineStart = source.indexOf(
      "export function createLiveCoston2PipelinePorts",
    );
    const legacyRuntimeStart = source.indexOf(
      "export function createLiveCoston2Runtime",
    );
    expect(pipelineStart).toBeGreaterThanOrEqual(0);
    const pipeline = source.slice(
      pipelineStart,
      legacyRuntimeStart >= 0 ? legacyRuntimeStart : undefined,
    );

    expect(pipeline).toMatch(
      /required\(environment,\s*["']PROOFLINE_COSTON2_PRIVATE_KEY["']\)/,
    );
    expect(pipeline).not.toMatch(/PROJECT_TOKEN|projectToken|execution\.privateKey/);

    const artifact = readFileSync(workerArtifact, "utf8");
    expect(artifact).toMatch(
      /required\d*\(environment,\s*["']PROOFLINE_COSTON2_PRIVATE_KEY["']\)/,
    );
  });

  it("keeps the narrow legacy live-gate module outside the production graph", () => {
    expect(existsSync(legacyLiveGate)).toBe(true);
    expect(sourceImportGraph(entry).has(legacyLiveGate)).toBe(false);
    expect(readFileSync(bootstrap, "utf8")).not.toMatch(/from\s+["']\.\/live-gate["']/);
  });
});
