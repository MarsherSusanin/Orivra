// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const commit = (value: string) => value.repeat(40).slice(0, 40);
const imageInputs = [
  ["caddy", "proofline/caddy", "ghcr.io/example-owner/orivra-caddy", "1"],
  ["web", "proofline/web", "ghcr.io/example-owner/orivra-web", "2"],
  ["api", "proofline/api", "ghcr.io/example-owner/orivra-api", "3"],
  ["worker", "proofline/worker", "ghcr.io/example-owner/orivra-worker", "4"],
  [
    "postgres-recovery",
    "proofline/postgres-recovery",
    "ghcr.io/example-owner/orivra-postgres-recovery",
    "5",
  ],
] as const;

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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

const checksum = (value: unknown) =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

const producer = { commitSha: commit("a"), treeSha: commit("b") };
const publishedImages = imageInputs.map(([id, sourceRepository, remoteRepository, digit], index) => {
  const imageManifestDigest = sha(digit);
  return {
    id,
    sourceRepository,
    platform: "linux/amd64",
    archiveFilename: `images/0${index + 1}-${id}.linux-amd64.oci.tar`,
    archiveSizeBytes: 1_024 + index,
    archiveSha256: sha(String.fromCharCode(97 + index)),
    imageManifestDigest,
    remoteRepository,
    remoteReference: `${remoteRepository}@${imageManifestDigest}`,
    remoteDigest: imageManifestDigest,
  };
});

const publicationEvidence = {
  version: "1",
  kind: "oci-publication-evidence",
  status: "passed",
  verification: "verified",
  publicationClaim: true,
  producer,
  runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  publishedAt: "2026-08-12T00:00:00Z",
  authorization: {
    credentialFreeMlpCandidateSha256: sha("a"),
    coreReportSha256: sha("e"),
    productReportSha256: sha("f"),
  },
  frozenRelease: {
    frozenReleaseManifestSha256: sha("b"),
    receiptSha256: sha("c"),
    artifactInventorySha256: sha("d"),
  },
  ghcrPublicationTargetsSha256: checksum(targetMap),
  registry: "ghcr.io",
  images: publishedImages,
};

const stagingEvidence = {
  version: "1",
  kind: "digitalocean-staging-deployment-evidence",
  status: "passed",
  verification: "verified",
  stagingClaim: true,
  producer,
  publicationEvidenceSha256: checksum(publicationEvidence),
  frozenReleaseManifestSha256: publicationEvidence.frozenRelease.frozenReleaseManifestSha256,
  target: {
    provider: "digitalocean",
    environment: "staging",
    deploymentId: "stg_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    composeProject: "proofline-staging-01k2q4p6r8t0v2x4z6b8d0f2h4",
    publicOrigin: "https://staging.example.test",
  },
  run: {
    runId: "stg_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    operatorId: publicationEvidence.operatorId,
    completedAt: "2026-08-12T00:10:00Z",
    sshHostKeySha256: sha("0"),
  },
  pullCredential: { registry: "ghcr.io", access: "read-only" },
  images: publishedImages.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({
    id,
    remoteRepository,
    remoteReference,
    remoteDigest,
  })),
  checks: {
    exactDigestPull: { status: "passed" },
    migration: { migrationManifestSha256: sha("6"), targetVersion: 10, schemaVersion: 10, status: "passed" },
    healthz: { status: "passed" },
    readyz: { status: "passed" },
    workerHeartbeat: { status: "current" },
    hostedBrowserSmoke: { status: "passed" },
    spacesRestore: { restoreEvidenceSha256: sha("7"), status: "passed" },
    liveCoston2: { runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", status: "passed" },
  },
};

async function feature(): Promise<Record<string, any>> {
  const path = "../src/publication";
  return import(/* @vite-ignore */ path).catch(() => ({}));
}

describe("Slice 028B publication and staging contracts", () => {
  it("exports the exact pure publication feature through both entrypoints", async () => {
    const [module, root] = await Promise.all([feature(), import("../src/index")]);
    const exports = [
      "GhcrPublicationTargetsV1Schema",
      "PublicationEvidenceV1Schema",
      "StagingDeploymentEvidenceV1Schema",
      "canonicalSerializeGhcrPublicationTargets",
      "canonicalSerializePublicationEvidence",
      "canonicalSerializeStagingDeploymentEvidence",
      "checksumGhcrPublicationTargets",
      "checksumPublicationEvidence",
      "checksumStagingDeploymentEvidence",
    ];
    expect(Object.keys(module).sort()).toEqual(exports.sort());
    for (const name of exports) expect(root[name]).toBe(module[name]);
  });

  it("requires one explicit exact ordered GHCR target map", async () => {
    const module = await feature();
    expect(module.GhcrPublicationTargetsV1Schema.parse(targetMap)).toEqual(targetMap);
    expect(module.canonicalSerializeGhcrPublicationTargets(targetMap)).toBe(canonicalJson(targetMap));
    expect(module.checksumGhcrPublicationTargets(targetMap)).toBe(checksum(targetMap));
  });

  it.each([
    ["missing image", { ...targetMap, images: targetMap.images.slice(0, -1) }],
    ["reordered image", { ...targetMap, images: [targetMap.images[1], targetMap.images[0], ...targetMap.images.slice(2)] }],
    ["duplicate repository", { ...targetMap, images: targetMap.images.map((image, index) => index === 1 ? { ...image, remoteRepository: targetMap.images[0].remoteRepository } : image) }],
    ["tag in repository", { ...targetMap, images: targetMap.images.map((image, index) => index === 0 ? { ...image, remoteRepository: `${image.remoteRepository}:latest` } : image) }],
    ["derived GitHub path", { ...targetMap, githubRemote: "github.com/MarsherSusanin/Orivra" }],
    ["secret path", { ...targetMap, tokenFile: "/run/secrets/ghcr" }],
  ])("rejects %s instead of inferring publication authority", async (_label, value) => {
    const module = await feature();
    expect(() => module.GhcrPublicationTargetsV1Schema.parse(value)).toThrow();
  });

  it("accepts one canonical append-only publication record with distinct digests", async () => {
    const module = await feature();
    expect(module.PublicationEvidenceV1Schema.parse(publicationEvidence)).toEqual(publicationEvidence);
    expect(module.canonicalSerializePublicationEvidence(publicationEvidence)).toBe(
      canonicalJson(publicationEvidence),
    );
    expect(module.checksumPublicationEvidence(publicationEvidence)).toBe(
      checksum(publicationEvidence),
    );
    for (const image of publicationEvidence.images) {
      expect(image.archiveSha256).not.toBe(image.remoteDigest);
      expect(image.remoteDigest).toBe(image.imageManifestDigest);
    }
  });

  it.each([
    ["archive digest as remote digest", { ...publicationEvidence, images: publicationEvidence.images.map((image, index) => index === 0 ? { ...image, remoteDigest: image.archiveSha256, remoteReference: `${image.remoteRepository}@${image.archiveSha256}` } : image) }],
    ["mutable remote reference", { ...publicationEvidence, images: publicationEvidence.images.map((image, index) => index === 0 ? { ...image, remoteReference: `${image.remoteRepository}:latest` } : image) }],
    ["failed status", { ...publicationEvidence, status: "failed", publicationClaim: false }],
    ["secret", { ...publicationEvidence, token: "secret" }],
    ["absolute path", { ...publicationEvidence, candidatePath: "/private/tmp/candidate" }],
  ])("rejects publication evidence with %s", async (_label, value) => {
    const module = await feature();
    expect(() => module.PublicationEvidenceV1Schema.parse(value)).toThrow();
  });

  it("accepts staging evidence only for immutable published references and read-only pull", async () => {
    const module = await feature();
    expect(module.StagingDeploymentEvidenceV1Schema.parse(stagingEvidence)).toEqual(stagingEvidence);
    expect(module.canonicalSerializeStagingDeploymentEvidence(stagingEvidence)).toBe(
      canonicalJson(stagingEvidence),
    );
    expect(module.checksumStagingDeploymentEvidence(stagingEvidence)).toBe(
      checksum(stagingEvidence),
    );
  });

  it.each([
    ["production environment", { ...stagingEvidence, target: { ...stagingEvidence.target, environment: "production" } }],
    ["write-capable pull credential", { ...stagingEvidence, pullCredential: { registry: "ghcr.io", access: "write" } }],
    ["mutable image reference", { ...stagingEvidence, images: stagingEvidence.images.map((image, index) => index === 0 ? { ...image, remoteReference: `${image.remoteRepository}:latest` } : image) }],
    ["missing PITR", { ...stagingEvidence, checks: { ...stagingEvidence.checks, spacesRestore: undefined } }],
    ["private-key path", { ...stagingEvidence, sshPrivateKeyFile: "/run/secrets/key" }],
  ])("rejects staging evidence with %s", async (_label, value) => {
    const module = await feature();
    expect(() => module.StagingDeploymentEvidenceV1Schema.parse(value)).toThrow();
  });
});
