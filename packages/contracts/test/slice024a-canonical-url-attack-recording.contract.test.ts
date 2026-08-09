// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import { replayProofBundle } from "../../domain/src/index";
import {
  HOST_MISMATCH_SELECTOR,
  RESPONSE_SHAPE_CANONICAL_JSON,
  makeCanonicalUrlAttackRecording,
  makeCanonicalUrlAttackRecordingContent,
  sha256,
} from "./slice024a-canonical-url-attack.fixtures";

const contracts = Contracts as Record<string, any>;

function contentSchema() {
  return contracts.CanonicalUrlAttackRecordingContentV1Schema;
}

function envelopeSchema() {
  return contracts.CanonicalUrlAttackRecordingV1Schema;
}

describe("Slice 024A canonical URL attack recording public contract", () => {
  it("exports the strict content, checksummed envelope and 6 MiB UTF-8 limit", () => {
    expect(contentSchema()).toBeDefined();
    expect(envelopeSchema()).toBeDefined();
    expect(contracts.CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES).toBe(
      6 * 1_024 * 1_024,
    );
    expect(
      contracts.CANONICAL_URL_ATTACK_RECORDING_MAX_BUNDLE_UTF8_BYTES,
    ).toBe(2_200_000);
    expect(
      contracts.CANONICAL_URL_ATTACK_RECORDING_MAX_MERKLE_PROOF_ENTRIES,
    ).toBe(64);
  });

  it("accepts exactly two independently persisted live Coston2 bundles without changing ProofBundleV1", () => {
    const content = makeCanonicalUrlAttackRecordingContent();
    const recording = makeCanonicalUrlAttackRecording();

    expect(replayProofBundle(content.bundles.attack.canonicalBundle).runId).toBe(
      content.bundles.attack.runId,
    );
    expect(replayProofBundle(content.bundles.control.canonicalBundle).runId).toBe(
      content.bundles.control.runId,
    );
    expect(contentSchema().safeParse(content).success).toBe(true);
    expect(envelopeSchema().safeParse(recording).success).toBe(true);
    expect(Contracts.ProofBundleV1Schema.safeParse(
      JSON.parse(content.bundles.attack.canonicalBundle),
    ).success).toBe(true);
    expect(Contracts.ProofBundleV1Schema.safeParse(
      JSON.parse(content.bundles.control.canonicalBundle),
    ).success).toBe(true);
    expect(content.bundles.attack.runId).not.toBe(content.bundles.control.runId);
  });

  it.each([
    ["root", (value: any) => { value.fixture = true; }],
    ["release", (value: any) => { value.release.branch = "main"; }],
    ["network", (value: any) => { value.network.rpcUrl = "https://rpc.invalid"; }],
    ["shared request", (value: any) => { value.sharedRequest.headers = {}; }],
    ["bundle", (value: any) => { value.bundles.attack.rawToken = "project_secret"; }],
    ["toolchain", (value: any) => { value.toolchain.runtime.rpc = "http://localhost"; }],
    ["consumer", (value: any) => { value.consumers.safe.source = "contract Secret {}"; }],
    ["execution", (value: any) => { value.transcript.executions[0].gas = 1; }],
  ])("rejects unknown or secret-bearing keys at the %s boundary", (_name, mutate) => {
    const value: any = structuredClone(makeCanonicalUrlAttackRecording());
    mutate(value);
    expect(envelopeSchema().safeParse(value).success).toBe(false);
  });

  it.each(["replay", "synthetic", "test-system", "fixture", "recorded-replay"])(
    "rejects %s provenance instead of presenting generated evidence as live",
    (provenance) => {
      const value: any = structuredClone(makeCanonicalUrlAttackRecording());
      value.bundles.attack.provenance = provenance;
      expect(envelopeSchema().safeParse(value).success).toBe(false);
    },
  );

  it("requires live wallet or relayer submissions with exact persisted identity fields", () => {
    const invalidValues = [
      (value: any) => { value.bundles.attack.submissionMode = "replay"; },
      (value: any) => { value.bundles.attack.lastSequence = 0; },
      (value: any) => { value.bundles.attack.transactionHash = "0x1234"; },
      (value: any) => { value.bundles.attack.votingRound = -1; },
      (value: any) => { value.bundles.attack.bundleChecksum = "sha256:ABC"; },
      (value: any) => { value.bundles.attack.canonicalBundleUtf8Bytes = 0; },
    ];

    for (const mutate of invalidValues) {
      const value: any = structuredClone(makeCanonicalUrlAttackRecording());
      mutate(value);
      expect(envelopeSchema().safeParse(value).success).toBe(false);
    }
  });

  it("requires canonical millisecond UTC recording time and exact release commit/tree identities", () => {
    const invalidValues = [
      (value: any) => { value.recordedAt = "2026-08-09T12:00:00Z"; },
      (value: any) => { value.recordedAt = "2026-08-09T22:00:00.000+10:00"; },
      (value: any) => { value.release.commitSha = "A".repeat(40); },
      (value: any) => { value.release.treeSha = "b".repeat(39); },
    ];

    for (const mutate of invalidValues) {
      const value: any = structuredClone(makeCanonicalUrlAttackRecording());
      mutate(value);
      expect(envelopeSchema().safeParse(value).success).toBe(false);
    }
  });

  it("freezes compiler, source, creation/runtime bytecode, proof and calldata SHA-256 evidence", () => {
    const value = makeCanonicalUrlAttackRecording();
    const hashes = [
      value.toolchain.compiler.inputSha256,
      value.toolchain.compiler.outputSha256,
      value.consumers.vulnerable.sourceSha256,
      value.consumers.vulnerable.creationBytecodeSha256,
      value.consumers.vulnerable.runtimeBytecodeSha256,
      value.consumers.safe.sourceSha256,
      value.consumers.safe.creationBytecodeSha256,
      value.consumers.safe.runtimeBytecodeSha256,
      ...value.transcript.executions.flatMap((execution) => [
        execution.proofSha256,
        execution.calldataSha256,
        execution.runtimeBytecodeSha256,
      ]),
    ];

    expect(hashes).toHaveLength(17);
    expect(hashes.every((hash) => /^sha256:[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(envelopeSchema().safeParse(value).success).toBe(true);
  });

  it("freezes the exact three-call result anatomy and HostMismatch selector", () => {
    const value = makeCanonicalUrlAttackRecording();
    expect(value.transcript.executions.map(({ scenario, consumer, result }) => ({
      scenario,
      consumer,
      status: result.status,
    }))).toEqual([
      { scenario: "attack", consumer: "canonical-vulnerable", status: "accepted" },
      { scenario: "attack", consumer: "canonical-safe", status: "reverted" },
      { scenario: "control", consumer: "canonical-safe", status: "accepted" },
    ]);
    expect(value.transcript.executions[1].result).toMatchObject({
      error: "HostMismatch()",
      selector: HOST_MISMATCH_SELECTOR,
    });

    const invalid: any = structuredClone(value);
    invalid.transcript.executions.reverse();
    expect(envelopeSchema().safeParse(invalid).success).toBe(false);
  });

  it("rejects invalid hashes, toolchain versions and checksum envelopes", () => {
    const invalidValues = [
      (value: any) => { value.checksum = "sha256:0"; },
      (value: any) => { value.toolchain.compiler.version = "latest"; },
      (value: any) => { value.toolchain.runtime.version = "v10"; },
      (value: any) => { value.consumers.safe.runtimeBytecodeSha256 = "0x1234"; },
      (value: any) => { value.transcript.executions[1].result.selector = "0xdeadbeef"; },
    ];

    for (const mutate of invalidValues) {
      const value: any = structuredClone(makeCanonicalUrlAttackRecording());
      mutate(value);
      expect(envelopeSchema().safeParse(value).success).toBe(false);
    }
  });

  it("requires bounded raw reproduction material instead of a hash-only transcript", () => {
    const value = makeCanonicalUrlAttackRecording();
    expect(value.reproduction.standardJson.input).toMatch(/^\{"language":"Solidity"/);
    expect(value.reproduction.standardJson.output).toMatch(/^\{"contracts":/);
    expect(Object.keys(value.reproduction.sources)).toEqual([
      "vulnerable",
      "safe",
      "invariantLibrary",
      "web2JsonInterface",
      "contractRegistry",
      "exactProofVerifier",
    ]);
    expect(value.reproduction.transformedResponseShapeCanonicalJson).toBe(
      RESPONSE_SHAPE_CANONICAL_JSON,
    );
    expect(envelopeSchema().safeParse(value).success).toBe(true);

    const missing: any = structuredClone(value);
    delete missing.reproduction;
    expect(envelopeSchema().safeParse(missing).success).toBe(false);
  });

  it("freezes exact source paths and raw bytecode without duplicating derived calldata or EVM results", () => {
    const value = makeCanonicalUrlAttackRecording();
    expect(value.reproduction.sources.vulnerable.path).toBe(
      "contracts/CanonicalVulnerableWeb2JsonConsumer.sol",
    );
    expect(value.reproduction.sources.safe.path).toBe(
      "contracts/CanonicalSafeWeb2JsonConsumer.sol",
    );
    expect(value.reproduction.sources.invariantLibrary.path).toBe(
      "contracts/ProoflineUrlInvariant.sol",
    );
    expect(value.reproduction.sources.exactProofVerifier.path).toBe(
      "contracts/ProoflineExactProofVerifier.sol",
    );
    expect(value.reproduction.bytecode.vulnerable).toEqual({
      creation: expect.stringMatching(/^0x(?:[a-f0-9]{2})+$/),
      runtime: expect.stringMatching(/^0x(?:[a-f0-9]{2})+$/),
    });
    expect(value.reproduction).not.toHaveProperty("executions");
    expect(envelopeSchema().safeParse(value).success).toBe(true);
  });

  it("rejects missing, extra, unbounded or malformed raw reproduction fields", () => {
    expect(
      envelopeSchema().safeParse(makeCanonicalUrlAttackRecording()).success,
    ).toBe(true);

    const mutations: Array<[string, (value: any) => void]> = [
      ["source missing", (value) => { delete value.reproduction.sources.safe.content; }],
      ["source extra", (value) => { value.reproduction.sources.safe.url = "file:///tmp/fake.sol"; }],
      ["wrong checked-in path", (value) => { value.reproduction.sources.safe.path = "contracts/Fake.sol"; }],
      ["non-hex bytecode", (value) => { value.reproduction.bytecode.safe.runtime = "6000"; }],
      ["odd bytecode", (value) => { value.reproduction.bytecode.safe.creation = "0x123"; }],
      ["duplicated executions", (value) => { value.reproduction.executions = []; }],
      ["oversized standard JSON", (value) => { value.reproduction.standardJson.input = "x".repeat(1_048_577); }],
    ];

    for (const [name, mutate] of mutations) {
      const value: any = structuredClone(makeCanonicalUrlAttackRecording());
      mutate(value);
      expect(envelopeSchema().safeParse(value).success, name).toBe(false);
    }
  });

  it("keeps every declared raw source SHA structurally exact", () => {
    const value = makeCanonicalUrlAttackRecording();
    for (const source of Object.values(value.reproduction.sources)) {
      expect(source.sha256).toBe(sha256(source.content));
    }
    expect(envelopeSchema().safeParse(value).success).toBe(true);
  });

  it("caps each embedded recording bundle independently at 2,200,000 UTF-8 bytes", () => {
    const value: any = structuredClone(makeCanonicalUrlAttackRecording());
    expect(envelopeSchema().safeParse(value).success).toBe(true);
    value.bundles.attack.canonicalBundle = "x".repeat(2_200_001);
    value.bundles.attack.canonicalBundleUtf8Bytes = 2_200_001;
    expect(envelopeSchema().safeParse(value).success).toBe(false);
  });
});
