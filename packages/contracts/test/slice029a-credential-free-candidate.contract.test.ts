import { describe, expect, it } from "vitest";

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const commit = (value: string) => value.repeat(40).slice(0, 40);

const gateIds = [
  "typecheck",
  "unit",
  "core-coverage",
  "backend-coverage",
  "web-coverage",
  "postgres",
  "solidity",
  "e2e",
  "build",
  "sites",
  "action-artifact",
  "docker-static",
  "docker-images",
  "docker-runtime",
  "docker-recovery",
  "release-freeze",
  "product-compose",
] as const;

function candidate() {
  return {
    version: "1" as const,
    kind: "credential-free-mlp-candidate" as const,
    status: "passed" as const,
    verification: "verified" as const,
    releaseClaim: true as const,
    credentialFree: true as const,
    externalNetwork: false as const,
    producer: { commitSha: commit("a"), treeSha: commit("b") },
    frozenRelease: {
      manifestSha256: sha("1"),
      receiptSha256: sha("2"),
      artifactInventorySha256: sha("3"),
    },
    product: {
      fixtureFilename: "recorded-product-fixture.v1.json" as const,
      fixtureSha256: sha("4"),
      mode: "checked-in-recorded-fixture" as const,
      publicOrigin: "https://127.0.0.1" as const,
      worker: "stopped" as const,
      status: "passed" as const,
    },
    gates: gateIds.map((id) => ({ id, status: "passed" as const })),
  };
}

async function feature() {
  const path = "../src/candidate";
  return import(/* @vite-ignore */ path);
}

describe("Slice 029A credential-free candidate contract", () => {
  it("exports the candidate feature from its feature and root entrypoints", async () => {
    const [module, root] = await Promise.all([feature(), import("../src/index")]);
    for (const name of [
      "CredentialFreeMlpCandidateV1Schema",
      "canonicalSerializeCredentialFreeMlpCandidate",
      "checksumCredentialFreeMlpCandidate",
    ]) {
      expect(module[name as keyof typeof module]).toBeDefined();
      expect(root[name as keyof typeof root]).toBe(module[name as keyof typeof module]);
    }
  });

  it("accepts the exact canonical credential-free candidate", async () => {
    const module = await feature();
    expect(module.CredentialFreeMlpCandidateV1Schema.parse(candidate())).toEqual(candidate());
  });

  it("serializes deterministically and checksums the exact UTF-8 bytes", async () => {
    const module = await feature();
    const serialized = module.canonicalSerializeCredentialFreeMlpCandidate(candidate());
    expect(serialized).toBe(module.canonicalSerializeCredentialFreeMlpCandidate(candidate()));
    expect(serialized.endsWith("\n")).toBe(false);
    expect(module.checksumCredentialFreeMlpCandidate(candidate())).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each([
    ["credentials", { credentialFree: false }],
    ["external network", { externalNetwork: true }],
    ["draft", { verification: "draft", releaseClaim: false }],
  ])("rejects %s authority", async (_label, delta) => {
    const module = await feature();
    expect(() => module.CredentialFreeMlpCandidateV1Schema.parse({ ...candidate(), ...delta })).toThrow();
  });

  it("rejects missing, duplicate, reordered or failed gates", async () => {
    const module = await feature();
    const base = candidate();
    for (const gates of [
      base.gates.slice(1),
      [...base.gates.slice(0, -1), base.gates[0]],
      [base.gates[1], base.gates[0], ...base.gates.slice(2)],
      base.gates.map((gate, index) => index === 8 ? { ...gate, status: "failed" } : gate),
    ]) {
      expect(() => module.CredentialFreeMlpCandidateV1Schema.parse({ ...base, gates })).toThrow();
    }
  });

  it("rejects producer, checksum, fixture and product-mode mutations", async () => {
    const module = await feature();
    const base = candidate();
    for (const value of [
      { ...base, producer: { ...base.producer, treeSha: base.producer.commitSha } },
      { ...base, frozenRelease: { ...base.frozenRelease, manifestSha256: "sha256:abc" } },
      { ...base, product: { ...base.product, fixtureFilename: "/tmp/fixture.json" } },
      { ...base, product: { ...base.product, worker: "running" } },
    ]) {
      expect(() => module.CredentialFreeMlpCandidateV1Schema.parse(value)).toThrow();
    }
  });

  it("keeps remote, operator, timestamp, secret and absolute-path fields outside the schema", async () => {
    const module = await feature();
    for (const extra of [
      { createdAt: "2026-08-12T00:00:00.000Z" },
      { operator: "alice" },
      { registry: "ghcr.io" },
      { token: "secret" },
      { outputPath: "/private/tmp/output" },
    ]) {
      expect(() => module.CredentialFreeMlpCandidateV1Schema.parse({ ...candidate(), ...extra })).toThrow();
    }
  });
});
