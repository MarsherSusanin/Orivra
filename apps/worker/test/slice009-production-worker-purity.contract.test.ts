// @vitest-environment node

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = resolve(root, "apps/worker/src/entry.ts");
const bootstrap = resolve(root, "apps/worker/src/bootstrap.ts");
const liveRuntime = resolve(root, "apps/worker/src/live-runtime.ts");
const commandHandlers = resolve(root, "apps/worker/src/worker.ts");
const obsoleteDirectGate = resolve(root, "apps/worker/src/live-gate.ts");
const workerArtifact = resolve(root, "apps/worker/dist/worker.js");
const contractsPackage = resolve(root, "packages/contracts/package.json");
const domainPackage = resolve(root, "packages/domain/package.json");

const walletAuthRuntimeExports = [
  "isCanonicalAuthTimestampV1",
  "WalletChallengeRequestV1Schema",
  "WalletChallengeV1Schema",
  "WalletSessionRequestV1Schema",
  "WalletSessionV1Schema",
  "AccountTokenCreateRequestV1Schema",
  "AccountTokenSummaryV1Schema",
  "AccountV1Schema",
  "AccountTokenCreatedV1Schema",
  "AccountTokenRevokedV1Schema",
] as const;

const workerArtifactForbiddenRules = [
  ["project-token environment compatibility", /PROJECT_TOKEN/],
  ["projectToken execution field", /projectToken/],
  ["privateKey execution field", /\[\s*["']privateKey["']\s*\]\s*:/],
  ["wildcard private-key lookup", /endsWith\(["']PRIVATE_KEY["']\)/],
  [
    "injectable compatibility runtime",
    /compatibilityRuntime|createRuntime\?\./,
  ],
  [
    "synthetic live handler marker",
    /RUN_LIVE_COSTON2|\[\s*["']RUN["']\s*,\s*["']LIVE["']\s*,\s*["']COSTON2["']\s*\]/,
  ],
  ["legacy credential error", /Legacy test credentials/],
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

function moduleLoadEffectViolations(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return matchingLabels(source, [
    ["side-effect-only import", /^\s*import\s*["']/m],
    ["dynamic import", /\bimport\s*\(/],
    ["async module execution", /\bawait\b/],
    ["process/global access", /\b(?:process|globalThis)\b/],
    [
      "I/O or timer access",
      /\b(?:fetch|queueMicrotask|readFile|readFileSync|request|setImmediate|setInterval|setTimeout|writeFile|writeFileSync)\s*\(/,
    ],
  ]).map((violation) => `${relative(root, file)}: ${violation}`);
}

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

function expectNoPreflightTestBridge(candidate: string, label: string) {
  expect(candidate, `${label} must fail closed independently of NODE_ENV`).not.toMatch(
    /process\.env\.NODE_ENV/,
  );
  expect(candidate).toMatch(/PREFLIGHT_OUTCOME_INVALID/);
  expect(candidate).toMatch(/REPLAY_PREFLIGHT_REPORT_MISSING/);
}

describe("Slice 009 production worker purity", () => {
  it("declares pure package metadata and the exact wallet-auth feature subpath", () => {
    const contracts = JSON.parse(readFileSync(contractsPackage, "utf8"));
    const domain = JSON.parse(readFileSync(domainPackage, "utf8"));

    expect(contracts.sideEffects).toBe(false);
    expect(domain.sideEffects).toBe(false);
    expect(contracts.exports).toEqual({
      ".": "./src/index.ts",
      "./wallet-auth": "./src/wallet-auth.ts",
    });
  });

  it("backs sideEffects false with effect-free package module initialization", () => {
    const files = [
      ...sourceFiles(resolve(root, "packages/contracts/src")),
      ...sourceFiles(resolve(root, "packages/domain/src")),
    ];
    expect(files.flatMap(moduleLoadEffectViolations)).toEqual([]);
  });

  it("exports the shared auth timestamp helper directly without loading wallet custody", () => {
    const contractsRoot = readFileSync(
      resolve(root, "packages/contracts/src/index.ts"),
      "utf8",
    );
    expect(contractsRoot).toMatch(
      /export\s*\{[^}]*\bisCanonicalAuthTimestampV1\b[^}]*\}\s*from\s*["']\.\/auth-timestamp["']/s,
    );
  });

  it("keeps every wallet-auth runtime export identical through the root entry", async () => {
    const rootSpecifier = "@proofline/contracts";
    const walletAuthSpecifier = "@proofline/contracts/wallet-auth";
    const [rootContracts, walletAuth] = await Promise.all([
      import(/* @vite-ignore */ rootSpecifier),
      import(/* @vite-ignore */ walletAuthSpecifier),
    ]);

    expect(Object.keys(walletAuth).sort()).toEqual(
      [...walletAuthRuntimeExports].sort(),
    );
    for (const name of walletAuthRuntimeExports) {
      expect(walletAuth[name]).toBe(rootContracts[name]);
    }
  });

  it("proves a fresh worker build excludes unused custody and demo feature modules", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofline-worker-purity-"));
    const artifact = join(directory, "worker.js");
    const metafile = join(directory, "worker-meta.json");
    try {
      await execFileAsync(
        resolve(root, "node_modules/.bin/esbuild"),
        [
          "apps/worker/src/entry.ts",
          "--bundle",
          "--platform=node",
          "--format=esm",
          "--target=node22",
          '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
          `--outfile=${artifact}`,
          `--metafile=${metafile}`,
          "--external:pg",
          "--external:solc",
        ],
        { cwd: root, timeout: 30_000 },
      );

      const [freshArtifact, rawMetadata] = await Promise.all([
        readFile(artifact, "utf8"),
        readFile(metafile, "utf8"),
      ]);
      const metadata = JSON.parse(rawMetadata) as {
        outputs: Record<
          string,
          { inputs: Record<string, { bytesInOutput: number }> }
        >;
      };
      const outputs = Object.values(metadata.outputs);
      expect(outputs).toHaveLength(1);
      const inputContributions = Object.entries(outputs[0].inputs).map(
        ([input, value]) => ({
          input: input.replaceAll("\\", "/"),
          bytesInOutput: value.bytesInOutput,
        }),
      );

      const bytesForSuffix = (suffix: string) =>
        inputContributions
          .filter(({ input }) => input.endsWith(suffix))
          .reduce((total, { bytesInOutput }) => total + bytesInOutput, 0);
      const bytesForPattern = (pattern: RegExp) =>
        inputContributions
          .filter(({ input }) => pattern.test(input))
          .reduce((total, { bytesInOutput }) => total + bytesInOutput, 0);

      for (const runtimeInput of [
        "apps/worker/src/entry.ts",
        "apps/worker/src/bootstrap.ts",
        "apps/worker/src/worker.ts",
        "apps/worker/src/live-runtime.ts",
        "apps/api/src/postgres.ts",
      ]) {
        expect(bytesForSuffix(runtimeInput), runtimeInput).toBeGreaterThan(0);
      }
      for (const [label, pattern] of [
        ["contracts runtime", /(?:^|\/)packages\/contracts\/src\/.*\.ts$/],
        ["domain runtime", /(?:^|\/)packages\/domain\/src\/.*\.ts$/],
        ["FDC runtime", /(?:^|\/)packages\/fdc-coston2\/src\/.*\.ts$/],
      ] as const) {
        expect(bytesForPattern(pattern), label).toBeGreaterThan(0);
      }
      expect(freshArtifact).toMatch(/await startProductionWorker\(\)/);
      expect(freshArtifact).toMatch(/PROOFLINE_COSTON2_PRIVATE_KEY/);
      const artifactFindings = matchingLabels(
        freshArtifact,
        workerArtifactForbiddenRules,
      );
      const featureFindings = inputContributions
        .filter(
          ({ input, bytesInOutput }) =>
            bytesInOutput > 0 &&
            /(?:^|\/)wallet-auth\.ts$|(?:^|\/)canonical-url-attack-demo\.ts$/.test(
              input,
            ),
        )
        .map(
          ({ input, bytesInOutput }) =>
            `${input} contributes ${bytesInOutput} output bytes`,
        );
      expect([...artifactFindings, ...featureFindings]).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
    expect([...graph.keys()]).not.toContain(obsoleteDirectGate);
  });

  it("ships no project-token/private-key execution compatibility path", () => {
    expect(existsSync(workerArtifact), "build @proofline/worker before this gate").toBe(
      true,
    );
    const artifact = readFileSync(workerArtifact, "utf8");

    expect(
      matchingLabels(artifact, workerArtifactForbiddenRules),
    ).toEqual([]);
  });

  it("keeps NODE_ENV test bridges out of the preflight production source", () => {
    const source = [commandHandlers, liveRuntime]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expectNoPreflightTestBridge(source, "production source");
  });

  it("keeps NODE_ENV test bridges out of the built worker artifact", () => {
    const artifact = readFileSync(workerArtifact, "utf8");
    expectNoPreflightTestBridge(artifact, "built worker artifact");
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

  it("removes the obsolete direct orchestrator from the repository and production graph", () => {
    expect(existsSync(obsoleteDirectGate)).toBe(false);
    expect(sourceImportGraph(entry).has(obsoleteDirectGate)).toBe(false);
    expect(readFileSync(bootstrap, "utf8")).not.toMatch(/from\s+["']\.\/live-gate["']/);
  });
});
