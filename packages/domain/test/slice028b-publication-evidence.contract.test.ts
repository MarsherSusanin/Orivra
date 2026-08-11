// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const commit = (value: string) => value.repeat(40).slice(0, 40);
const canonicalJson = (value: any): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};
const checksumBytes = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const bytes = (value: unknown) => new TextEncoder().encode(canonicalJson(value));

const imageInputs = [
  ["caddy", "proofline/caddy", "ghcr.io/example-owner/orivra-caddy", "1", "9"],
  ["web", "proofline/web", "ghcr.io/example-owner/orivra-web", "2", "8"],
  ["api", "proofline/api", "ghcr.io/example-owner/orivra-api", "3", "7"],
  ["worker", "proofline/worker", "ghcr.io/example-owner/orivra-worker", "4", "6"],
  ["postgres-recovery", "proofline/postgres-recovery", "ghcr.io/example-owner/orivra-postgres-recovery", "5", "0"],
] as const;
const producer = { commitSha: commit("a"), treeSha: commit("b") };
const targetMap = {
  version: "1",
  kind: "ghcr-publication-targets",
  registry: "ghcr.io",
  images: imageInputs.map(([id, sourceRepository, remoteRepository]) => ({
    id,
    sourceRepository,
    remoteRepository,
  })),
};
const manifest = {
  version: "1",
  kind: "frozen-oci-release-manifest",
  producer: { ...producer, sourceSnapshotSha256: sha("8"), sourceDateEpoch: 1_754_870_400, verification: "verified", releaseClaim: true },
  database: { migrationManifestPath: "apps/api/db/migrations/manifest.v1.json", migrationManifestSha256: sha("7"), targetVersion: 10, minimumCompatibleVersion: 10, maximumCompatibleVersion: 10 },
  action: { metadataPath: "packages/action/action.yml", metadataSha256: sha("6"), artifactPath: "packages/action/dist/index.js", artifactSha256: sha("5") },
  recovery: { walGVersion: "v3.0.8", walGReleaseLockPath: "docker/wal-g-release.v1.json", walGReleaseLockSha256: sha("4"), walGReceiptSha256: sha("3"), walGBinarySha256: sha("2") },
  images: imageInputs.map(([id, sourceRepository, , manifestDigit, archiveDigit], index) => {
    const imageManifestDigest = sha(manifestDigit);
    return {
      id,
      repository: sourceRepository,
      reference: `${sourceRepository}@${imageManifestDigest}`,
      platform: "linux/amd64",
      archiveFilename: `images/0${index + 1}-${id}.linux-amd64.oci.tar`,
      archiveFormat: "oci-image-layout-v1.0.0+ustar",
      archiveSizeBytes: 1_024 + index,
      archiveSha256: sha(archiveDigit),
      imageManifestDigest,
    };
  }),
};
const manifestBytes = bytes(manifest);
const artifacts = [
  {
    filename: "frozen-release-manifest.v1.json",
    sizeBytes: manifestBytes.byteLength,
    sha256: checksumBytes(manifestBytes),
  },
  ...manifest.images.map((image) => ({
    filename: image.archiveFilename,
    sizeBytes: image.archiveSizeBytes,
    sha256: image.archiveSha256,
  })),
].sort((left, right) => left.filename.localeCompare(right.filename, "en"));
const receipt = {
  version: "1",
  kind: "frozen-oci-release-receipt",
  status: "passed",
  verification: "verified",
  releaseClaim: true,
  producer,
  frozenReleaseManifestSha256: checksumBytes(manifestBytes),
  artifacts,
  artifactInventorySha256: checksumBytes(bytes(artifacts)),
};
const receiptBytes = bytes(receipt);
const candidate = {
  version: "1",
  kind: "credential-free-mlp-candidate",
  status: "passed",
  verification: "verified",
  releaseClaim: true,
  credentialFree: true,
  externalNetwork: false,
  producer,
  frozenRelease: {
    manifestSha256: checksumBytes(manifestBytes),
    receiptSha256: checksumBytes(receiptBytes),
    artifactInventorySha256: receipt.artifactInventorySha256,
  },
  product: {
    fixtureFilename: "recorded-product-fixture.v1.json",
    fixtureSha256: sha("f"),
    mode: "checked-in-recorded-fixture",
    publicOrigin: "https://127.0.0.1",
    worker: "stopped",
    status: "passed",
  },
  gates: [
    "typecheck", "unit", "core-coverage", "backend-coverage", "web-coverage",
    "postgres", "solidity", "e2e", "build", "sites", "action-artifact",
    "docker-static", "docker-images", "docker-runtime", "docker-recovery",
    "release-freeze", "product-compose",
  ].map((id) => ({ id, status: "passed" })),
};
const candidateBytes = bytes(candidate);
const targetMapBytes = bytes(targetMap);
const verifierReports = { coreReportSha256: sha("d"), productReportSha256: sha("e") };
const remoteResults = manifest.images.map((image, index) => ({
  id: image.id,
  remoteRepository: targetMap.images[index].remoteRepository,
  remoteDigest: image.imageManifestDigest,
}));

async function feature(): Promise<Record<string, any>> {
  const path = "../src/publication";
  return import(/* @vite-ignore */ path).catch(() => ({}));
}

describe("Slice 028B publication evidence domain", () => {
  it("creates immutable publication evidence only from the exact 029A handoff", async () => {
    const module = await feature();
    const evidence = module.createPublicationEvidence({
      candidate,
      candidateBytes,
      manifest,
      manifestBytes,
      receipt,
      receiptBytes,
      targetMap,
      targetMapBytes,
      verifierReports,
      remoteResults,
      publication: {
        runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
        operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
        completedAt: "2026-08-12T00:00:00Z",
      },
    });
    expect(evidence.producer).toEqual(producer);
    expect(evidence.authorization.credentialFreeMlpCandidateSha256).toBe(
      checksumBytes(candidateBytes),
    );
    expect(evidence.frozenRelease.frozenReleaseManifestSha256).toBe(
      checksumBytes(manifestBytes),
    );
    expect(evidence.frozenRelease.receiptSha256).toBe(checksumBytes(receiptBytes));
    expect(evidence.images.map((image: any) => image.remoteDigest)).toEqual(
      manifest.images.map((image) => image.imageManifestDigest),
    );
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(module.verifyPublicationEvidenceHandoff({
      evidence,
      candidateBytes,
      manifestBytes,
      receiptBytes,
      targetMapBytes,
      verifierReports,
    })).toBe(true);
  });

  it.each([
    ["candidate bytes", { candidateBytes: bytes({ ...candidate, extra: true }) }],
    ["manifest bytes", { manifestBytes: bytes({ ...manifest, extra: true }) }],
    ["receipt bytes", { receiptBytes: bytes({ ...receipt, extra: true }) }],
    ["target map", { targetMapBytes: bytes({ ...targetMap, extra: true }) }],
    ["Core report", { verifierReports: { ...verifierReports, coreReportSha256: sha("0") } }],
    ["Product report", { verifierReports: { ...verifierReports, productReportSha256: sha("0") } }],
  ])("rejects a mismatched %s before handoff", async (_label, delta) => {
    const module = await feature();
    expect(() => module.verifyPublicationEvidenceHandoff({
      evidence: {
        ...module.createPublicationEvidence({
          candidate, candidateBytes, manifest, manifestBytes, receipt, receiptBytes,
          targetMap, targetMapBytes, verifierReports, remoteResults,
          publication: { runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", completedAt: "2026-08-12T00:00:00Z" },
        }),
      },
      candidateBytes,
      manifestBytes,
      receiptBytes,
      targetMapBytes,
      verifierReports,
      ...delta,
    })).toThrow();
  });

  it.each([
    ["archive digest", manifest.images.map((image, index) => ({ ...remoteResults[index], remoteDigest: image.archiveSha256 }))],
    ["reordered result", [remoteResults[1], remoteResults[0], ...remoteResults.slice(2)]],
    ["unmapped repository", remoteResults.map((result, index) => index === 0 ? { ...result, remoteRepository: "ghcr.io/other/image" } : result)],
  ])("rejects %s as remote publication authority", async (_label, results) => {
    const module = await feature();
    expect(() => module.createPublicationEvidence({
      candidate, candidateBytes, manifest, manifestBytes, receipt, receiptBytes,
      targetMap, targetMapBytes, verifierReports, remoteResults: results,
      publication: { runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", completedAt: "2026-08-12T00:00:00Z" },
    })).toThrow();
  });

  it("derives a staging-only immutable plan from publication evidence", async () => {
    const module = await feature();
    const evidence = module.createPublicationEvidence({
      candidate, candidateBytes, manifest, manifestBytes, receipt, receiptBytes,
      targetMap, targetMapBytes, verifierReports, remoteResults,
      publication: { runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", completedAt: "2026-08-12T00:00:00Z" },
    });
    const plan = module.createDigitalOceanStagingPlan({
      publicationEvidence: evidence,
      publicationEvidenceBytes: bytes(evidence),
      origin: "https://staging.example.test",
      composeProject: "proofline-staging-01k2q4p6r8t0v2x4z6b8d0f2h4",
    });
    expect(plan.environment).toBe("staging");
    expect(plan.pullCredential).toEqual({ registry: "ghcr.io", access: "read-only" });
    expect(plan.images.map((image: any) => image.reference)).toEqual(
      evidence.images.map((image: any) => image.remoteReference),
    );
    expect(plan.startOrder).toEqual([
      "postgres", "role-bootstrap", "migrator", "api", "worker", "web", "caddy",
    ]);
    expect(JSON.stringify(plan)).not.toMatch(/latest|production|privateKey|token/i);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("rejects production, mutable or mismatched staging inputs", async () => {
    const module = await feature();
    for (const value of [
      { origin: "http://staging.example.test", composeProject: "proofline-staging-test" },
      { origin: "https://staging.example.test", composeProject: "proofline-production-test" },
      { origin: "https://staging.example.test", composeProject: "proofline-staging-test", environment: "production" },
    ]) {
      expect(() => module.createDigitalOceanStagingPlan({
        publicationEvidence: {},
        publicationEvidenceBytes: bytes({}),
        ...value,
      })).toThrow();
    }
  });
});
