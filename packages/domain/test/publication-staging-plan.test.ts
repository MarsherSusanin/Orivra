// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializePublicationEvidence,
  type PublicationEvidenceV1,
} from "@proofline/contracts/publication";
import { canonicalSerializeCredentialFreeMlpCandidate } from "@proofline/contracts/candidate";
import {
  canonicalSerializeFrozenOciReleaseManifest,
  canonicalSerializeFrozenOciReleaseReceipt,
  checksumReleaseArtifactInventory,
} from "@proofline/contracts/release";
import {
  createDigitalOceanStagingPlan,
  createPublicationEvidence,
} from "../src/publication";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const shaBytes = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const encode = (value: string) => new TextEncoder().encode(value);
const definitions = [
  ["caddy", "proofline/caddy", "images/01-caddy.linux-amd64.oci.tar", "1", "9"],
  ["web", "proofline/web", "images/02-web.linux-amd64.oci.tar", "2", "8"],
  ["api", "proofline/api", "images/03-api.linux-amd64.oci.tar", "3", "7"],
  ["worker", "proofline/worker", "images/04-worker.linux-amd64.oci.tar", "4", "6"],
  ["postgres-recovery", "proofline/postgres-recovery", "images/05-postgres-recovery.linux-amd64.oci.tar", "5", "0"],
] as const;

const evidence: PublicationEvidenceV1 = {
  version: "1",
  kind: "oci-publication-evidence",
  status: "passed",
  verification: "verified",
  publicationClaim: true,
  producer: { commitSha: "a".repeat(40), treeSha: "b".repeat(40) },
  runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  publishedAt: "2026-08-12T00:00:00Z",
  authorization: {
    credentialFreeMlpCandidateSha256: digest("a"),
    coreReportSha256: digest("b"),
    productReportSha256: digest("c"),
  },
  frozenRelease: {
    frozenReleaseManifestSha256: digest("d"),
    receiptSha256: digest("e"),
    artifactInventorySha256: digest("f"),
  },
  ghcrPublicationTargetsSha256: digest("1"),
  registry: "ghcr.io",
  images: definitions.map(([id, sourceRepository, archiveFilename, manifest, archive], index) => ({
    id,
    sourceRepository,
    platform: "linux/amd64" as const,
    archiveFilename,
    archiveSizeBytes: 1_024 + index,
    archiveSha256: digest(archive),
    imageManifestDigest: digest(manifest),
    remoteRepository: `ghcr.io/example-owner/orivra-${id}`,
    remoteReference: `ghcr.io/example-owner/orivra-${id}@${digest(manifest)}`,
    remoteDigest: digest(manifest),
  })) as PublicationEvidenceV1["images"],
};

const evidenceBytes = new TextEncoder().encode(canonicalSerializePublicationEvidence(evidence));

function validCreationInput() {
  const producer = evidence.producer;
  const manifest = {
    version: "1",
    kind: "frozen-oci-release-manifest",
    producer: {
      ...producer,
      sourceSnapshotSha256: digest("8"),
      sourceDateEpoch: 1_754_870_400,
      verification: "verified",
      releaseClaim: true,
    },
    database: {
      migrationManifestPath: "apps/api/db/migrations/manifest.v1.json",
      migrationManifestSha256: digest("7"),
      targetVersion: 10,
      minimumCompatibleVersion: 10,
      maximumCompatibleVersion: 10,
    },
    action: {
      metadataPath: "packages/action/action.yml",
      metadataSha256: digest("6"),
      artifactPath: "packages/action/dist/index.js",
      artifactSha256: digest("5"),
    },
    recovery: {
      walGVersion: "v3.0.8",
      walGReleaseLockPath: "docker/wal-g-release.v1.json",
      walGReleaseLockSha256: digest("4"),
      walGReceiptSha256: digest("3"),
      walGBinarySha256: digest("2"),
    },
    images: definitions.map(([id, repository, archiveFilename, manifestDigest, archiveDigest], index) => ({
      id,
      repository,
      reference: `${repository}@${digest(manifestDigest)}`,
      platform: "linux/amd64",
      archiveFilename,
      archiveFormat: "oci-image-layout-v1.0.0+ustar",
      archiveSizeBytes: 1_024 + index,
      archiveSha256: digest(archiveDigest),
      imageManifestDigest: digest(manifestDigest),
    })),
  };
  const manifestBytes = encode(canonicalSerializeFrozenOciReleaseManifest(manifest));
  const artifacts = [
    { filename: "frozen-release-manifest.v1.json", sizeBytes: manifestBytes.byteLength, sha256: shaBytes(manifestBytes) },
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
    frozenReleaseManifestSha256: shaBytes(manifestBytes),
    artifacts,
    artifactInventorySha256: checksumReleaseArtifactInventory(artifacts),
  };
  const receiptBytes = encode(canonicalSerializeFrozenOciReleaseReceipt(receipt));
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
      manifestSha256: shaBytes(manifestBytes),
      receiptSha256: shaBytes(receiptBytes),
      artifactInventorySha256: receipt.artifactInventorySha256,
    },
    product: {
      fixtureFilename: "recorded-product-fixture.v1.json",
      fixtureSha256: digest("f"),
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
  const candidateBytes = encode(canonicalSerializeCredentialFreeMlpCandidate(candidate));
  const targetMap = {
    version: "1",
    kind: "ghcr-publication-targets",
    registry: "ghcr.io",
    images: definitions.map(([id, sourceRepository]) => ({
      id,
      sourceRepository,
      remoteRepository: `ghcr.io/example-owner/orivra-${id}`,
    })),
  };
  return {
    candidate,
    candidateBytes,
    manifest,
    manifestBytes,
    receipt,
    receiptBytes,
    targetMap,
    targetMapBytes: encode(JSON.stringify(targetMap)),
    verifierReports: { coreReportSha256: digest("d"), productReportSha256: digest("e") },
    remoteResults: manifest.images.map((image, index) => ({
      id: image.id,
      remoteRepository: targetMap.images[index].remoteRepository,
      remoteDigest: image.imageManifestDigest,
    })),
    publication: {
      runId: evidence.runId,
      operatorId: evidence.operatorId,
      completedAt: evidence.publishedAt,
    },
  };
}

describe("publication staging plan target validation", () => {
  it.each([
    ["non-HTTPS origin", { origin: "http://staging.example.test" }],
    ["production environment", { environment: "production" }],
    ["non-staging project", { composeProject: "proofline-production-test" }],
  ])("rejects %s with otherwise-valid publication evidence", (_label, delta) => {
    expect(() => createDigitalOceanStagingPlan({
      publicationEvidence: evidence,
      publicationEvidenceBytes: evidenceBytes,
      origin: "https://staging.example.test",
      composeProject: "proofline-staging-test",
      ...delta,
    })).toThrow();
  });

  it("rejects a structurally valid but cross-unbound candidate handoff", () => {
    const input = validCreationInput();
    expect(() => createPublicationEvidence({
      ...input,
      candidate: {
        ...input.candidate,
        frozenRelease: { ...input.candidate.frozenRelease, manifestSha256: digest("0") },
      },
      candidateBytes: encode(canonicalSerializeCredentialFreeMlpCandidate({
        ...input.candidate,
        frozenRelease: { ...input.candidate.frozenRelease, manifestSha256: digest("0") },
      })),
    })).toThrow();
  });

  it("rejects an incomplete remote-result inventory", () => {
    const input = validCreationInput();
    expect(() => createPublicationEvidence({
      ...input,
      remoteResults: input.remoteResults.slice(0, -1),
    })).toThrow();
  });

  it("rejects duplicate publication and staging repositories", () => {
    const duplicateImages = evidence.images.map((image, index) => index === 1
      ? {
          ...image,
          remoteRepository: evidence.images[0].remoteRepository,
          remoteReference: `${evidence.images[0].remoteRepository}@${image.remoteDigest}`,
        }
      : image) as PublicationEvidenceV1["images"];
    expect(() => PublicationEvidenceV1Schema.parse({ ...evidence, images: duplicateImages })).toThrow();
    const staging = {
      version: "1",
      kind: "digitalocean-staging-deployment-evidence",
      status: "passed",
      verification: "verified",
      stagingClaim: true,
      producer: evidence.producer,
      publicationEvidenceSha256: digest("6"),
      frozenReleaseManifestSha256: digest("7"),
      target: {
        provider: "digitalocean",
        environment: "staging",
        deploymentId: "do-staging-1",
        composeProject: "proofline-staging-test",
        publicOrigin: "https://staging.example.test",
      },
      run: {
        runId: "stg_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
        operatorId: evidence.operatorId,
        completedAt: "2026-08-12T00:10:00Z",
        sshHostKeySha256: digest("8"),
      },
      pullCredential: { registry: "ghcr.io", access: "read-only" },
      images: duplicateImages.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({
        id, remoteRepository, remoteReference, remoteDigest,
      })),
      checks: {
        exactDigestPull: { status: "passed" },
        migration: { migrationManifestSha256: digest("9"), targetVersion: 10, schemaVersion: 10, status: "passed" },
        healthz: { status: "passed" },
        readyz: { status: "passed" },
        workerHeartbeat: { status: "current" },
        hostedBrowserSmoke: { status: "passed" },
        spacesRestore: { restoreEvidenceSha256: digest("a"), status: "passed" },
        liveCoston2: { runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", status: "passed" },
      },
    };
    expect(() => StagingDeploymentEvidenceV1Schema.parse(staging)).toThrow();
  });
});
