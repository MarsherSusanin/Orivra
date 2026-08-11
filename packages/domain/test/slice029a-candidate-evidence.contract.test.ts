import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);

function fixture() {
  const fixtureBytes = Buffer.from('{"kind":"recorded-product-fixture","version":"1"}', "utf8");
  const manifestBytes = Buffer.from('{"kind":"frozen-oci-release-manifest"}', "utf8");
  const receiptBytes = Buffer.from('{"kind":"frozen-oci-release-receipt"}', "utf8");
  return { fixtureBytes, manifestBytes, receiptBytes };
}

async function module() {
  const path = "../src/mlp-candidate";
  return import(/* @vite-ignore */ path);
}

describe("Slice 029A candidate evidence binding", () => {
  it("exports a pure candidate creator and verifier", async () => {
    const feature = await module();
    expect(feature.createCredentialFreeMlpCandidate).toBeTypeOf("function");
    expect(feature.verifyCredentialFreeMlpCandidateHandoff).toBeTypeOf("function");
  });

  it("creates an exact candidate from independently supplied verified bytes", async () => {
    const feature = await module();
    const bytes = fixture();
    const candidate = feature.createCredentialFreeMlpCandidate({
      producer: { commitSha, treeSha },
      frozenRelease: {
        manifestSha256: sha256(bytes.manifestBytes),
        receiptSha256: sha256(bytes.receiptBytes),
        artifactInventorySha256: `sha256:${"3".repeat(64)}`,
      },
      fixtureSha256: sha256(bytes.fixtureBytes),
    });
    expect(candidate.producer).toEqual({ commitSha, treeSha });
    expect(candidate.gates).toHaveLength(17);
    expect(candidate.gates.every((gate: { status: string }) => gate.status === "passed")).toBe(true);
  });

  it("verifies producer, release bytes, receipt inventory and fixture bytes together", async () => {
    const feature = await module();
    const bytes = fixture();
    const candidate = feature.createCredentialFreeMlpCandidate({
      producer: { commitSha, treeSha },
      frozenRelease: {
        manifestSha256: sha256(bytes.manifestBytes),
        receiptSha256: sha256(bytes.receiptBytes),
        artifactInventorySha256: `sha256:${"3".repeat(64)}`,
      },
      fixtureSha256: sha256(bytes.fixtureBytes),
    });
    expect(feature.verifyCredentialFreeMlpCandidateHandoff({
      candidate,
      expectedProducer: { commitSha, treeSha },
      manifestBytes: bytes.manifestBytes,
      receiptBytes: bytes.receiptBytes,
      receiptArtifactInventorySha256: `sha256:${"3".repeat(64)}`,
      fixtureBytes: bytes.fixtureBytes,
    })).toBe(true);
  });

  it("rejects malformed candidate bytes before any handoff comparison", async () => {
    const feature = await module();
    const bytes = fixture();
    expect(() => feature.verifyCredentialFreeMlpCandidateHandoff({
      candidate: { version: "1", kind: "credential-free-mlp-candidate" },
      expectedProducer: { commitSha, treeSha },
      manifestBytes: bytes.manifestBytes,
      receiptBytes: bytes.receiptBytes,
      receiptArtifactInventorySha256: `sha256:${"3".repeat(64)}`,
      fixtureBytes: bytes.fixtureBytes,
    })).toThrowError(/candidate/i);
  });

  it.each(["producer", "manifest", "receipt", "inventory", "fixture"])(
    "rejects a %s mismatch before acceptance",
    async (kind) => {
      const feature = await module();
      const bytes = fixture();
      const candidate = feature.createCredentialFreeMlpCandidate({
        producer: { commitSha, treeSha },
        frozenRelease: {
          manifestSha256: sha256(bytes.manifestBytes),
          receiptSha256: sha256(bytes.receiptBytes),
          artifactInventorySha256: `sha256:${"3".repeat(64)}`,
        },
        fixtureSha256: sha256(bytes.fixtureBytes),
      });
      const input = {
        candidate,
        expectedProducer: { commitSha, treeSha },
        manifestBytes: bytes.manifestBytes,
        receiptBytes: bytes.receiptBytes,
        receiptArtifactInventorySha256: `sha256:${"3".repeat(64)}`,
        fixtureBytes: bytes.fixtureBytes,
      };
      if (kind === "producer") input.expectedProducer = { commitSha: "c".repeat(40), treeSha };
      if (kind === "manifest") input.manifestBytes = Buffer.from("changed");
      if (kind === "receipt") input.receiptBytes = Buffer.from("changed");
      if (kind === "inventory") input.receiptArtifactInventorySha256 = `sha256:${"9".repeat(64)}`;
      if (kind === "fixture") input.fixtureBytes = Buffer.from("changed");
      expect(() => feature.verifyCredentialFreeMlpCandidateHandoff(input)).toThrowError(/candidate/i);
    },
  );
});
