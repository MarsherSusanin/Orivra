import { createHash } from "node:crypto";
import {
  canonicalSerializeGhcrPublicationTargets,
  canonicalSerializePublicationEvidence,
  checksumPublicationEvidence,
} from "../../packages/contracts/src/publication-runtime.mjs";
import { canonicalSerializeCredentialFreeMlpCandidate } from "../../packages/contracts/src/candidate-runtime.mjs";
import {
  canonicalSerializeFrozenOciReleaseManifest,
  canonicalSerializeFrozenOciReleaseReceipt,
  checksumReleaseArtifactInventory,
} from "../../packages/contracts/src/release-runtime.mjs";
import { createPublicationEvidence } from "../../packages/domain/src/publication-runtime.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const encode = (value) => new TextEncoder().encode(value);
const definitions = Object.freeze([
  ["caddy", "proofline/caddy", "images/01-caddy.linux-amd64.oci.tar", "1", "a"],
  ["web", "proofline/web", "images/02-web.linux-amd64.oci.tar", "2", "b"],
  ["api", "proofline/api", "images/03-api.linux-amd64.oci.tar", "3", "c"],
  ["worker", "proofline/worker", "images/04-worker.linux-amd64.oci.tar", "4", "d"],
  ["postgres-recovery", "proofline/postgres-recovery", "images/05-postgres-recovery.linux-amd64.oci.tar", "5", "e"],
]);

export function createPublicationHandoffFixture() {
  const producer = { commitSha: "a".repeat(40), treeSha: "b".repeat(40) };
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
    images: definitions.map(([id, repository, archiveFilename, manifestDigit, archiveDigit], index) => ({
      id,
      repository,
      reference: `${repository}@${digest(manifestDigit)}`,
      platform: "linux/amd64",
      archiveFilename,
      archiveFormat: "oci-image-layout-v1.0.0+ustar",
      archiveSizeBytes: 1_024 + index,
      archiveSha256: digest(archiveDigit),
      imageManifestDigest: digest(manifestDigit),
    })),
  };
  const manifestBytes = encode(canonicalSerializeFrozenOciReleaseManifest(manifest));
  const artifacts = [
    {
      filename: "frozen-release-manifest.v1.json",
      sizeBytes: manifestBytes.byteLength,
      sha256: digestFromBytes(manifestBytes),
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
    frozenReleaseManifestSha256: digestFromBytes(manifestBytes),
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
      manifestSha256: digestFromBytes(manifestBytes),
      receiptSha256: digestFromBytes(receiptBytes),
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
  const targetMapBytes = encode(canonicalSerializeGhcrPublicationTargets(targetMap));
  const verifierReports = {
    coreReportSha256: digest("d"),
    productReportSha256: digest("e"),
  };
  const evidence = createPublicationEvidence({
    candidate,
    candidateBytes,
    manifest,
    manifestBytes,
    receipt,
    receiptBytes,
    targetMap,
    targetMapBytes,
    verifierReports,
    remoteResults: manifest.images.map((image, index) => ({
      id: image.id,
      remoteRepository: targetMap.images[index].remoteRepository,
      remoteDigest: image.imageManifestDigest,
    })),
    publication: {
      runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      completedAt: "2026-08-12T00:00:00Z",
    },
  });
  const evidenceBytes = encode(canonicalSerializePublicationEvidence(evidence));
  return Object.freeze({
    evidence,
    evidenceBytes,
    expectedPublicationEvidenceSha256: checksumPublicationEvidence(evidence),
    candidateBytes,
    manifestBytes,
    receiptBytes,
    targetMapBytes,
    verifierReports,
    manifest,
  });
}

function digestFromBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
