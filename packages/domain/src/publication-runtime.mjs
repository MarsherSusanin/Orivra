import {
  GhcrPublicationTargetsV1Schema,
  PublicationEvidenceV1Schema,
  canonicalSerializePublicationEvidence,
  checksumGhcrPublicationTargets,
  checksumPublicationEvidence,
} from "../../contracts/src/publication-runtime.mjs";
import {
  CredentialFreeMlpCandidateV1Schema,
  canonicalSerializeCredentialFreeMlpCandidate,
} from "../../contracts/src/candidate-runtime.mjs";
import {
  FrozenOciReleaseManifestV1Schema,
  FrozenOciReleaseReceiptV1Schema,
  canonicalSerializeFrozenOciReleaseManifest,
  canonicalSerializeFrozenOciReleaseReceipt,
  sha256Bytes,
} from "../../contracts/src/release-runtime.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });

function invalid(message = "Publication evidence handoff is invalid") {
  throw Object.assign(new Error(message), { code: "PUBLICATION_EVIDENCE_INVALID" });
}

function exactBytes(bytes, canonical) {
  return bytes instanceof Uint8Array && decoder.decode(bytes) === canonical;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function parseInputs(input) {
  const candidate = CredentialFreeMlpCandidateV1Schema.parse(input.candidate);
  const manifest = FrozenOciReleaseManifestV1Schema.parse(input.manifest);
  const receipt = FrozenOciReleaseReceiptV1Schema.parse(input.receipt);
  const targetMap = GhcrPublicationTargetsV1Schema.parse(input.targetMap);
  const checks = [
    exactBytes(input.candidateBytes, canonicalSerializeCredentialFreeMlpCandidate(candidate)),
    exactBytes(input.manifestBytes, canonicalSerializeFrozenOciReleaseManifest(manifest)),
    exactBytes(input.receiptBytes, canonicalSerializeFrozenOciReleaseReceipt(receipt)),
    candidate.producer.commitSha === manifest.producer.commitSha,
    candidate.producer.treeSha === manifest.producer.treeSha,
    receipt.producer.commitSha === candidate.producer.commitSha,
    receipt.producer.treeSha === candidate.producer.treeSha,
    candidate.frozenRelease.manifestSha256 === sha256Bytes(input.manifestBytes),
    candidate.frozenRelease.receiptSha256 === sha256Bytes(input.receiptBytes),
    candidate.frozenRelease.artifactInventorySha256 === receipt.artifactInventorySha256,
    receipt.frozenReleaseManifestSha256 === sha256Bytes(input.manifestBytes),
  ];
  if (checks.includes(false)) invalid();
  return { candidate, manifest, receipt, targetMap };
}

export function createPublicationEvidence(input) {
  const { candidate, manifest, receipt, targetMap } = parseInputs(input);
  if (!Array.isArray(input.remoteResults) || input.remoteResults.length !== manifest.images.length) invalid();
  const images = manifest.images.map((image, index) => {
    const target = targetMap.images[index];
    const remote = input.remoteResults[index];
    if (target.id !== image.id || target.sourceRepository !== image.repository ||
      remote?.id !== image.id || remote.remoteRepository !== target.remoteRepository ||
      remote.remoteDigest !== image.imageManifestDigest) invalid();
    return {
      id: image.id,
      sourceRepository: image.repository,
      platform: image.platform,
      archiveFilename: image.archiveFilename,
      archiveSizeBytes: image.archiveSizeBytes,
      archiveSha256: image.archiveSha256,
      imageManifestDigest: image.imageManifestDigest,
      remoteRepository: target.remoteRepository,
      remoteReference: `${target.remoteRepository}@${remote.remoteDigest}`,
      remoteDigest: remote.remoteDigest,
    };
  });
  const evidence = PublicationEvidenceV1Schema.parse({
    version: "1",
    kind: "oci-publication-evidence",
    status: "passed",
    verification: "verified",
    publicationClaim: true,
    producer: candidate.producer,
    runId: input.publication.runId,
    operatorId: input.publication.operatorId,
    publishedAt: input.publication.completedAt,
    authorization: {
      credentialFreeMlpCandidateSha256: sha256Bytes(input.candidateBytes),
      coreReportSha256: input.verifierReports.coreReportSha256,
      productReportSha256: input.verifierReports.productReportSha256,
    },
    frozenRelease: {
      frozenReleaseManifestSha256: sha256Bytes(input.manifestBytes),
      receiptSha256: sha256Bytes(input.receiptBytes),
      artifactInventorySha256: receipt.artifactInventorySha256,
    },
    ghcrPublicationTargetsSha256: checksumGhcrPublicationTargets(targetMap),
    registry: "ghcr.io",
    images,
  });
  return deepFreeze(evidence);
}

export function verifyPublicationEvidenceHandoff(input) {
  const evidence = PublicationEvidenceV1Schema.parse(input.evidence);
  const candidate = CredentialFreeMlpCandidateV1Schema.parse(JSON.parse(decoder.decode(input.candidateBytes)));
  const manifest = FrozenOciReleaseManifestV1Schema.parse(JSON.parse(decoder.decode(input.manifestBytes)));
  const receipt = FrozenOciReleaseReceiptV1Schema.parse(JSON.parse(decoder.decode(input.receiptBytes)));
  const targetMap = GhcrPublicationTargetsV1Schema.parse(JSON.parse(decoder.decode(input.targetMapBytes)));
  const checks = [
    exactBytes(input.candidateBytes, canonicalSerializeCredentialFreeMlpCandidate(candidate)),
    exactBytes(input.manifestBytes, canonicalSerializeFrozenOciReleaseManifest(manifest)),
    exactBytes(input.receiptBytes, canonicalSerializeFrozenOciReleaseReceipt(receipt)),
    evidence.authorization.credentialFreeMlpCandidateSha256 === sha256Bytes(input.candidateBytes),
    evidence.authorization.coreReportSha256 === input.verifierReports?.coreReportSha256,
    evidence.authorization.productReportSha256 === input.verifierReports?.productReportSha256,
    evidence.frozenRelease.frozenReleaseManifestSha256 === sha256Bytes(input.manifestBytes),
    evidence.frozenRelease.receiptSha256 === sha256Bytes(input.receiptBytes),
    evidence.frozenRelease.artifactInventorySha256 === receipt.artifactInventorySha256,
    evidence.ghcrPublicationTargetsSha256 === checksumGhcrPublicationTargets(targetMap),
    evidence.producer.commitSha === candidate.producer.commitSha,
    evidence.producer.treeSha === candidate.producer.treeSha,
    evidence.images.every((image, index) =>
      image.id === manifest.images[index].id &&
      image.archiveSha256 === manifest.images[index].archiveSha256 &&
      image.remoteRepository === targetMap.images[index].remoteRepository),
  ];
  if (checks.includes(false)) invalid();
  return true;
}

export function createDigitalOceanStagingPlan({ publicationEvidence, publicationEvidenceBytes, origin, composeProject, environment = "staging" }) {
  const evidence = PublicationEvidenceV1Schema.parse(publicationEvidence);
  if (!exactBytes(publicationEvidenceBytes, canonicalSerializePublicationEvidence(evidence)) ||
    checksumPublicationEvidence(evidence) !== sha256Bytes(publicationEvidenceBytes) ||
    environment !== "staging" || !origin.startsWith("https://") ||
    !/^proofline-staging-[a-z0-9-]+$/.test(composeProject)) invalid("DigitalOcean staging plan is invalid");
  return deepFreeze({
    environment: "staging",
    origin,
    composeProject,
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: evidence.images.map(({ id, remoteReference }) => ({ id, reference: remoteReference })),
    startOrder: ["postgres", "role-bootstrap", "migrator", "api", "worker", "web", "caddy"],
  });
}
