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
const workerRuntimeConfiguration = resolve(
  root,
  "apps/worker/src/worker-runtime-configuration.ts",
);
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

const templateContractRuntimeExports = [
  "Web2JsonTemplateProvenanceV1Schema",
  "Web2JsonTemplateSummaryV1Schema",
  "Web2JsonTemplateCatalogV1Schema",
  "Web2JsonTemplateDetailV1Schema",
] as const;

const manifestContractRuntimeExports = [
  "Web2JsonAbiParameterV1Schema",
  "Web2JsonManifestV1Schema",
  "Coston2Web2JsonManifestV1Schema",
  "ComposerStepV1Schema",
  "Web2JsonDraftQueryRowV1Schema",
  "Web2JsonManifestDraftV1Schema",
  "isPublicUrlCredentialQueryName",
  "isPrivateUrlQueryValue",
  "isSafePublicUrlQueryEntry",
] as const;

const deploymentContractRuntimeExports = [
  "DeploymentHealthV1Schema",
  "DeploymentReadinessV1Schema",
] as const;

const recoveryContractRuntimeExports = [
  "BackupEvidenceV1Schema",
  "RestoreDrillEvidenceV1Schema",
  "RestorePromotionAuthorizationV1Schema",
  "RestorePromotionAuthorizationV2Schema",
  "RecoveryEvidenceHandoffV1Schema",
  "canonicalSerializeBackupEvidence",
  "canonicalSerializeRecoveryEvidenceHandoff",
  "canonicalSerializeRestoreDrillEvidence",
  "checksumBackupEvidence",
  "checksumRecoveryEvidenceHandoff",
  "checksumRestoreDrillEvidence",
] as const;

const releaseContractRuntimeExports = [
  "FrozenOciReleaseManifestV1Schema",
  "FrozenOciReleaseReceiptV1Schema",
  "canonicalSerializeFrozenOciReleaseManifest",
  "canonicalSerializeFrozenOciReleaseReceipt",
  "checksumFrozenOciReleaseManifest",
  "checksumReleaseArtifactInventory",
] as const;

const releaseDomainRuntimeExports = [
  "createFrozenOciReleaseManifest",
  "createFrozenOciReleaseReceipt",
  "deriveCanonicalOciArchiveEntries",
  "inspectSinglePlatformOciLayout",
  "verifyFrozenOciReleaseHandoff",
] as const;

const publicationContractRuntimeExports = [
  "GhcrPublicationTargetsV1Schema",
  "PublicationEvidenceV1Schema",
  "StagingDeploymentEvidenceV1Schema",
  "canonicalSerializeGhcrPublicationTargets",
  "canonicalSerializePublicationEvidence",
  "canonicalSerializeStagingDeploymentEvidence",
  "checksumGhcrPublicationTargets",
  "checksumPublicationEvidence",
  "checksumStagingDeploymentEvidence",
] as const;

const publicationDomainRuntimeExports = [
  "createDigitalOceanStagingPlan",
  "createPublicationEvidence",
  "verifyPublicationEvidenceHandoff",
] as const;

const productionPromotionContractRuntimeExports = [
  "ApplicationRollbackAuthorizationV1Schema",
  "ProductionDeploymentEvidenceV1Schema",
  "ProductionPromotionAuthorizationV1Schema",
  "ProductionPromotionEvidenceV1Schema",
  "ProductionTargetV1Schema",
  "canonicalSerializeProductionDeploymentEvidence",
  "canonicalSerializeProductionPromotionAuthorization",
  "canonicalSerializeProductionPromotionEvidence",
  "canonicalSerializeProductionTarget",
  "checksumProductionDeploymentEvidence",
  "checksumProductionPromotionAuthorization",
  "checksumProductionPromotionEvidence",
  "checksumProductionTarget",
] as const;

const productionPromotionDomainRuntimeExports = [
  "createProductionPromotionPlan",
  "selectSchemaCompatibleRollback",
  "verifyProductionPromotionHandoff",
] as const;

const templateDomainRuntimeExports = [
  "getWeb2JsonTemplateCatalog",
  "getWeb2JsonTemplateDetail",
  "resolveWeb2JsonTemplate",
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
  it("declares pure package metadata and exact custody/template/recovery/release/candidate/publication/production feature subpaths", () => {
    const contracts = JSON.parse(readFileSync(contractsPackage, "utf8"));
    const domain = JSON.parse(readFileSync(domainPackage, "utf8"));

    expect(contracts.sideEffects).toBe(false);
    expect(domain.sideEffects).toBe(false);
    expect(contracts.exports).toEqual({
      ".": "./src/index.ts",
      "./deployment": "./src/deployment.ts",
      "./wallet-auth": "./src/wallet-auth.ts",
      "./manifest": "./src/web2json-manifest.ts",
      "./templates": "./src/web2json-templates.ts",
      "./recovery": "./src/recovery.ts",
      "./release": "./src/release.ts",
      "./candidate": "./src/candidate.ts",
      "./publication": "./src/publication.ts",
      "./production-promotion": "./src/production-promotion.ts",
    });
    expect(domain.exports).toEqual({
      ".": "./src/index.ts",
      "./templates": "./src/web2json-template-catalog.ts",
      "./release": "./src/oci-release.ts",
      "./candidate": "./src/mlp-candidate.ts",
      "./publication": "./src/publication.ts",
      "./production-promotion": "./src/production-promotion.ts",
    });
  });

  it("keeps cycle-free production-promotion features identical through pure package roots", async () => {
    const contractFeature = resolve(root, "packages/contracts/src/production-promotion.ts");
    const domainFeature = resolve(root, "packages/domain/src/production-promotion.ts");
    expect(existsSync(contractFeature)).toBe(true);
    expect(existsSync(domainFeature)).toBe(true);
    if (!existsSync(contractFeature) || !existsSync(domainFeature)) return;
    const contractSpecifier = "@proofline/contracts/production-promotion";
    const domainSpecifier = "@proofline/domain/production-promotion";
    const [rootContracts, contracts, rootDomain, domain] = await Promise.all([
      import("@proofline/contracts"),
      import(/* @vite-ignore */ contractSpecifier),
      import("@proofline/domain"),
      import(/* @vite-ignore */ domainSpecifier),
    ]);
    expect(Object.keys(contracts).sort()).toEqual([...productionPromotionContractRuntimeExports].sort());
    expect(Object.keys(domain).sort()).toEqual([...productionPromotionDomainRuntimeExports].sort());
    for (const name of productionPromotionContractRuntimeExports) expect(contracts[name]).toBe(rootContracts[name]);
    for (const name of productionPromotionDomainRuntimeExports) expect(domain[name]).toBe(rootDomain[name]);
    for (const feature of [contractFeature, domainFeature]) {
      const source = readFileSync(feature, "utf8");
      expect(source).not.toMatch(/from\s*["']\.\/index["']|from\s*["']@proofline\/(?:contracts|domain)["']/);
      expect(moduleLoadEffectViolations(feature)).toEqual([]);
    }
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

  it("keeps every template runtime export identical through pure feature entries", async () => {
    const contractsSpecifier = "@proofline/contracts";
    const contractTemplatesSpecifier = "@proofline/contracts/templates";
    const domainSpecifier = "@proofline/domain";
    const domainTemplatesSpecifier = "@proofline/domain/templates";
    const [rootContracts, contractTemplates, rootDomain, domainTemplates] =
      await Promise.all([
        import(/* @vite-ignore */ contractsSpecifier),
        import(/* @vite-ignore */ contractTemplatesSpecifier),
        import(/* @vite-ignore */ domainSpecifier),
        import(/* @vite-ignore */ domainTemplatesSpecifier),
      ]);

    expect(Object.keys(contractTemplates).sort()).toEqual(
      [...templateContractRuntimeExports].sort(),
    );
    expect(Object.keys(domainTemplates).sort()).toEqual(
      [...templateDomainRuntimeExports].sort(),
    );
    for (const name of templateContractRuntimeExports) {
      expect(contractTemplates[name]).toBe(rootContracts[name]);
    }
    for (const name of templateDomainRuntimeExports) {
      expect(domainTemplates[name]).toBe(rootDomain[name]);
    }
  });

  it("keeps every manifest runtime export identical through the root entry", async () => {
    const contractsSpecifier = "@proofline/contracts";
    const manifestSpecifier = "@proofline/contracts/manifest";
    const [rootContracts, manifestContracts] = await Promise.all([
      import(/* @vite-ignore */ contractsSpecifier),
      import(/* @vite-ignore */ manifestSpecifier),
    ]);

    expect(Object.keys(manifestContracts).sort()).toEqual(
      [...manifestContractRuntimeExports].sort(),
    );
    for (const name of manifestContractRuntimeExports) {
      expect(manifestContracts[name]).toBe(rootContracts[name]);
    }
  });

  it("keeps the cycle-free deployment runtime export identical through the root entry", async () => {
    const [rootContracts, deploymentContracts, source] = await Promise.all([
      import(/* @vite-ignore */ "@proofline/contracts"),
      import(/* @vite-ignore */ "@proofline/contracts/deployment"),
      readFile(resolve(root, "packages/contracts/src/deployment.ts"), "utf8"),
    ]);

    expect(Object.keys(deploymentContracts).sort()).toEqual(
      [...deploymentContractRuntimeExports].sort(),
    );
    for (const name of deploymentContractRuntimeExports) {
      expect(deploymentContracts[name]).toBe(rootContracts[name]);
    }
    expect(source).not.toMatch(
      /from\s*["']\.\/index["']|from\s*["']@proofline\/contracts["']/,
    );
  });

  it("keeps the cycle-free recovery runtime export identical through the root entry", async () => {
    const recoveryFeature = resolve(root, "packages/contracts/src/recovery.ts");
    expect(existsSync(recoveryFeature)).toBe(true);
    if (!existsSync(recoveryFeature)) return;
    const rootSpecifier = "@proofline/contracts";
    const recoverySpecifier = "@proofline/contracts/recovery";
    const [rootContracts, recoveryContracts, source] = await Promise.all([
      import(/* @vite-ignore */ rootSpecifier),
      import(/* @vite-ignore */ recoverySpecifier),
      readFile(recoveryFeature, "utf8"),
    ]);

    expect(Object.keys(recoveryContracts).sort()).toEqual(
      [...recoveryContractRuntimeExports].sort(),
    );
    for (const name of recoveryContractRuntimeExports) {
      expect(recoveryContracts[name]).toBe(rootContracts[name]);
    }
    expect(source).not.toMatch(
      /from\s*["']\.\/index["']|from\s*["']@proofline\/contracts["']/,
    );
    expect(moduleLoadEffectViolations(recoveryFeature)).toEqual([]);
  });

  it("keeps cycle-free release features identical through both pure package roots", async () => {
    const contractFeature = resolve(root, "packages/contracts/src/release.ts");
    const domainFeature = resolve(root, "packages/domain/src/oci-release.ts");
    expect(existsSync(contractFeature)).toBe(true);
    expect(existsSync(domainFeature)).toBe(true);
    if (!existsSync(contractFeature) || !existsSync(domainFeature)) return;
    const releaseContractsSpecifier = "@proofline/contracts/release";
    const releaseDomainSpecifier = "@proofline/domain/release";
    const [rootContracts, releaseContracts, rootDomain, releaseDomain] =
      await Promise.all([
        import(/* @vite-ignore */ "@proofline/contracts"),
        import(/* @vite-ignore */ releaseContractsSpecifier),
        import(/* @vite-ignore */ "@proofline/domain"),
        import(/* @vite-ignore */ releaseDomainSpecifier),
      ]);
    expect(Object.keys(releaseContracts).sort()).toEqual(
      [...releaseContractRuntimeExports].sort(),
    );
    expect(Object.keys(releaseDomain).sort()).toEqual(
      [...releaseDomainRuntimeExports].sort(),
    );
    for (const name of releaseContractRuntimeExports) {
      expect(releaseContracts[name]).toBe(rootContracts[name]);
    }
    for (const name of releaseDomainRuntimeExports) {
      expect(releaseDomain[name]).toBe(rootDomain[name]);
    }
    for (const feature of [contractFeature, domainFeature]) {
      const source = readFileSync(feature, "utf8");
      expect(source).not.toMatch(
        /from\s*["']\.\/index["']|from\s*["']@proofline\/(?:contracts|domain)["']/,
      );
      expect(moduleLoadEffectViolations(feature)).toEqual([]);
    }
  });

  it("keeps cycle-free publication features identical through both pure package roots", async () => {
    const contractFeature = resolve(root, "packages/contracts/src/publication.ts");
    const domainFeature = resolve(root, "packages/domain/src/publication.ts");
    expect(existsSync(contractFeature)).toBe(true);
    expect(existsSync(domainFeature)).toBe(true);
    if (!existsSync(contractFeature) || !existsSync(domainFeature)) return;
    const publicationContractsSpecifier = "@proofline/contracts/publication";
    const publicationDomainSpecifier = "@proofline/domain/publication";
    const [rootContracts, publicationContracts, rootDomain, publicationDomain] =
      await Promise.all([
        import(/* @vite-ignore */ "@proofline/contracts"),
        import(/* @vite-ignore */ publicationContractsSpecifier),
        import(/* @vite-ignore */ "@proofline/domain"),
        import(/* @vite-ignore */ publicationDomainSpecifier),
      ]);
    expect(Object.keys(publicationContracts).sort()).toEqual(
      [...publicationContractRuntimeExports].sort(),
    );
    expect(Object.keys(publicationDomain).sort()).toEqual(
      [...publicationDomainRuntimeExports].sort(),
    );
    for (const name of publicationContractRuntimeExports) {
      expect(publicationContracts[name]).toBe(rootContracts[name]);
    }
    for (const name of publicationDomainRuntimeExports) {
      expect(publicationDomain[name]).toBe(rootDomain[name]);
    }
    for (const feature of [contractFeature, domainFeature]) {
      const source = readFileSync(feature, "utf8");
      expect(source).not.toMatch(
        /from\s*["']\.\/index["']|from\s*["']@proofline\/(?:contracts|domain)["']/,
      );
      expect(moduleLoadEffectViolations(feature)).toEqual([]);
    }
  });

  it("keeps manifest and template feature imports cycle-free", () => {
    const manifestFeature = resolve(
      root,
      "packages/contracts/src/web2json-manifest.ts",
    );
    const contractTemplates = resolve(
      root,
      "packages/contracts/src/web2json-templates.ts",
    );
    const domainTemplates = resolve(
      root,
      "packages/domain/src/web2json-template-catalog.ts",
    );
    expect(existsSync(manifestFeature)).toBe(true);
    expect(existsSync(contractTemplates)).toBe(true);
    expect(existsSync(domainTemplates)).toBe(true);
    if (
      !existsSync(manifestFeature) ||
      !existsSync(contractTemplates) ||
      !existsSync(domainTemplates)
    ) {
      return;
    }

    const manifestSource = readFileSync(manifestFeature, "utf8");
    const contractTemplateSource = readFileSync(contractTemplates, "utf8");
    const domainTemplateSource = readFileSync(domainTemplates, "utf8");
    expect(manifestSource).not.toMatch(/from\s*["']\.\/index["']/);
    expect(manifestSource).not.toMatch(/web2json-templates/);
    expect(contractTemplateSource).toMatch(
      /from\s*["']\.\/web2json-manifest["']/,
    );
    expect(contractTemplateSource).not.toMatch(
      /from\s*["']\.\/index["']|from\s*["']@proofline\/contracts["']/,
    );
    expect(domainTemplateSource).toMatch(
      /from\s*["']@proofline\/contracts\/templates["']/,
    );
    expect(domainTemplateSource).toMatch(
      /from\s*["']@proofline\/contracts\/manifest["']/,
    );
    expect(domainTemplateSource).not.toMatch(
      /from\s*["']@proofline\/contracts["']/,
    );
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
        "apps/worker/src/worker-runtime-configuration.ts",
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
      expect(
        bytesForSuffix("packages/contracts/src/web2json-manifest.ts"),
        "manifest feature runtime",
      ).toBeGreaterThan(0);
      for (const recoveryInput of [
        "packages/contracts/src/recovery.ts",
        "packages/contracts/src/recovery-schema.ts",
        "packages/contracts/src/recovery-runtime.mjs",
      ]) {
        expect(bytesForSuffix(recoveryInput), recoveryInput).toBe(0);
      }
      for (const releaseInput of [
        "packages/contracts/src/release.ts",
        "packages/domain/src/oci-release.ts",
      ]) {
        expect(bytesForSuffix(releaseInput), releaseInput).toBe(0);
      }
      for (const publicationInput of [
        "packages/contracts/src/publication.ts",
        "packages/contracts/src/publication-runtime.mjs",
        "packages/domain/src/publication.ts",
        "packages/domain/src/publication-runtime.mjs",
      ]) {
        expect(bytesForSuffix(publicationInput), publicationInput).toBe(0);
      }
      expect(freshArtifact).toMatch(/await startProductionWorker\(\)/);
      expect(freshArtifact).toMatch(/PROOFLINE_COSTON2_PRIVATE_KEY/);
      expect(freshArtifact).not.toMatch(
        /parseLegacyLiveCoston2RuntimeConfig|\bLiveRuntimeFactoryInput\b|\bLiveEnvironment\b/,
      );
      expect(freshArtifact).not.toMatch(
        /BackupEvidenceV1Schema|RestoreDrillEvidenceV1Schema|RestorePromotionAuthorizationV1Schema|RestorePromotionAuthorizationV2Schema|RecoveryEvidenceHandoffV1Schema|canonicalSerializeBackupEvidence|canonicalSerializeRecoveryEvidenceHandoff|canonicalSerializeRestoreDrillEvidence|checksumBackupEvidence|checksumRecoveryEvidenceHandoff|checksumRestoreDrillEvidence/,
      );
      expect(freshArtifact).not.toMatch(
        /FrozenOciReleaseManifestV1Schema|FrozenOciReleaseReceiptV1Schema|imageManifestDigest|archiveSha256|artifactInventorySha256/,
      );
      expect(freshArtifact).not.toMatch(
        /GhcrPublicationTargetsV1Schema|PublicationEvidenceV1Schema|StagingDeploymentEvidenceV1Schema|ghcr-publication-targets|oci-publication-evidence|digitalocean-staging-deployment-evidence/,
      );
      const artifactFindings = matchingLabels(
        freshArtifact,
        workerArtifactForbiddenRules,
      );
      const featureFindings = inputContributions
        .filter(
          ({ input, bytesInOutput }) =>
            bytesInOutput > 0 &&
            /(?:^|\/)wallet-auth\.ts$|(?:^|\/)canonical-url-attack-demo\.ts$|(?:^|\/)web2json-templates\.ts$|(?:^|\/)web2json-template-catalog\.ts$|(?:^|\/)deployment(?:-schema)?\.ts$|(?:^|\/)recovery(?:-schema)?\.ts$|(?:^|\/)recovery-runtime\.mjs$|(?:^|\/)release\.ts$|(?:^|\/)oci-release\.ts$|(?:^|\/)candidate(?:-runtime)?\.mjs$|(?:^|\/)candidate\.ts$|(?:^|\/)mlp-candidate(?:-runtime)?\.mjs$|(?:^|\/)mlp-candidate\.ts$|(?:^|\/)publication(?:-runtime)?\.mjs$|(?:^|\/)publication\.ts$/.test(
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
    const legacyRuntimeOwners = [...graph.entries()]
      .filter(([, source]) =>
        /parseLegacyLiveCoston2RuntimeConfig|\bLiveRuntimeFactoryInput\b|\bLiveEnvironment\b|\bliveRuntimeConfig\s*\(/.test(
          source,
        ),
      )
      .map(([file]) => relative(root, file));
    expect(legacyRuntimeOwners).toEqual([]);
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

  it("derives the worker-owned account once before typed live-pipeline composition", () => {
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
      /createLiveCoston2PipelinePorts[\s\S]{0,600}\bruntimeConfig\b/,
    );
    expect(pipeline).not.toMatch(
      /\bEnvironment\b|\bLiveEnvironment\b|process\.env|required\(|readFile(?:Sync)?\(|PROOFLINE_COSTON2_PRIVATE_KEY|PROJECT_TOKEN|projectToken|execution\.privateKey|\[\s*["']privateKey["']\s*\]/,
    );

    const graph = sourceImportGraph(entry);
    const keyAuthorityOwners = [...graph.entries()]
      .filter(([, candidate]) =>
        candidate.includes("PROOFLINE_COSTON2_PRIVATE_KEY"),
      )
      .map(([file]) => relative(root, file));
    expect(keyAuthorityOwners).toEqual([
      "apps/worker/src/worker-runtime-configuration.ts",
    ]);
    const accountDerivationOwners = [...graph.entries()]
      .filter(([, candidate]) => candidate.includes("privateKeyToAccount"))
      .map(([file]) => relative(root, file));
    expect(accountDerivationOwners).toEqual([
      "apps/worker/src/worker-runtime-configuration.ts",
    ]);

    expect(existsSync(workerRuntimeConfiguration)).toBe(true);
    if (!existsSync(workerRuntimeConfiguration)) return;
    const configurationSource = readFileSync(workerRuntimeConfiguration, "utf8");
    expect(configurationSource).toMatch(/parseWorkerRuntimeConfig/);
    expect(configurationSource).toMatch(/PROOFLINE_COSTON2_PRIVATE_KEY/);
    expect(configurationSource).toMatch(/privateKeyToAccount/);
    expect(configurationSource).not.toMatch(/\b(?:privateKey|rawPrivateKey)\s*:/);

    const artifact = readFileSync(workerArtifact, "utf8");
    expect(artifact).toMatch(/PROOFLINE_COSTON2_PRIVATE_KEY/);
    expect(matchingLabels(artifact, workerArtifactForbiddenRules)).toEqual([]);
  });

  it("removes the obsolete direct orchestrator from the repository and production graph", () => {
    expect(existsSync(obsoleteDirectGate)).toBe(false);
    expect(sourceImportGraph(entry).has(obsoleteDirectGate)).toBe(false);
    expect(readFileSync(bootstrap, "utf8")).not.toMatch(/from\s+["']\.\/live-gate["']/);
  });
});
