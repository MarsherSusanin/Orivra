import {
  CredentialFreeMlpCandidateV1Schema,
  credentialFreeCandidateGateIds,
} from "../../contracts/src/candidate-runtime.mjs";
import { sha256Bytes } from "../../contracts/src/release-runtime.mjs";

function invalid() {
  throw Object.assign(new Error("Credential-free candidate handoff is invalid"), {
    code: "MLP_CANDIDATE_INVALID",
  });
}

export function createCredentialFreeMlpCandidate({
  producer,
  frozenRelease,
  fixtureSha256,
}) {
  return CredentialFreeMlpCandidateV1Schema.parse({
    version: "1",
    kind: "credential-free-mlp-candidate",
    status: "passed",
    verification: "verified",
    releaseClaim: true,
    credentialFree: true,
    externalNetwork: false,
    producer,
    frozenRelease,
    product: {
      fixtureFilename: "recorded-product-fixture.v1.json",
      fixtureSha256,
      mode: "checked-in-recorded-fixture",
      publicOrigin: "https://127.0.0.1",
      worker: "stopped",
      status: "passed",
    },
    gates: credentialFreeCandidateGateIds.map((id) => ({ id, status: "passed" })),
  });
}

export function verifyCredentialFreeMlpCandidateHandoff({
  candidate,
  expectedProducer,
  manifestBytes,
  receiptBytes,
  receiptArtifactInventorySha256,
  fixtureBytes,
}) {
  let parsed;
  try {
    parsed = CredentialFreeMlpCandidateV1Schema.parse(candidate);
  } catch {
    invalid();
  }
  const checks = [
    parsed.producer.commitSha === expectedProducer?.commitSha,
    parsed.producer.treeSha === expectedProducer?.treeSha,
    parsed.frozenRelease.manifestSha256 === sha256Bytes(manifestBytes),
    parsed.frozenRelease.receiptSha256 === sha256Bytes(receiptBytes),
    parsed.frozenRelease.artifactInventorySha256 === receiptArtifactInventorySha256,
    parsed.product.fixtureSha256 === sha256Bytes(fixtureBytes),
  ];
  if (checks.includes(false)) invalid();
  return true;
}
