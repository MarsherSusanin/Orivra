// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Domain from "../src/index";
import {
  ATTACK_RUN_ID,
  CONTROL_RUN_ID,
  HOST_MISMATCH_SELECTOR,
  makeCanonicalUrlAttackRecording,
  makeCanonicalUrlAttackRecordingContent,
  sha256,
} from "../../contracts/test/slice024a-canonical-url-attack.fixtures";

const domain = Domain as Record<string, any>;

function createRecording(content = makeCanonicalUrlAttackRecordingContent()) {
  return domain.createCanonicalUrlAttackRecording(content);
}

function serializeRecording(recording: unknown): string {
  return domain.canonicalSerializeCanonicalUrlAttackRecording(recording);
}

function replayRecording(serialized: string): any {
  return domain.replayCanonicalUrlAttackRecording(serialized);
}

function expectCreateBoundary(): void {
  expect(domain.createCanonicalUrlAttackRecording).toBeTypeOf("function");
}

function expectReplayBoundaries(): void {
  expect(domain.canonicalSerializeCanonicalUrlAttackRecording).toBeTypeOf("function");
  expect(domain.replayCanonicalUrlAttackRecording).toBeTypeOf("function");
}

describe("Slice 024A canonical URL attack recording integrity", () => {
  it("exports pure create, validate, canonical serialize and replay boundaries", () => {
    expect(domain.createCanonicalUrlAttackRecording).toBeTypeOf("function");
    expect(domain.validateCanonicalUrlAttackRecording).toBeTypeOf("function");
    expect(domain.canonicalSerializeCanonicalUrlAttackRecording).toBeTypeOf("function");
    expect(domain.replayCanonicalUrlAttackRecording).toBeTypeOf("function");
  });

  it("creates the exact checksummed envelope deterministically despite object insertion order", () => {
    expectCreateBoundary();
    const content = makeCanonicalUrlAttackRecordingContent();
    const reordered = {
      transcript: content.transcript,
      consumers: content.consumers,
      toolchain: content.toolchain,
      bundles: {
        control: content.bundles.control,
        attack: content.bundles.attack,
      },
      reproduction: content.reproduction,
      sharedRequest: content.sharedRequest,
      statement: content.statement,
      network: content.network,
      release: content.release,
      recordedAt: content.recordedAt,
      kind: content.kind,
      version: content.version,
    };
    const first = createRecording(content);
    const second = createRecording(reordered);

    expect(first).toEqual(makeCanonicalUrlAttackRecording());
    expect(second.checksum).toBe(first.checksum);
    expect(serializeRecording(second)).toBe(serializeRecording(first));
  });

  it("round-trips byte-identically and validates both unchanged ProofBundleV1 byte strings", () => {
    expectCreateBoundary();
    expectReplayBoundaries();
    const recording = createRecording();
    const serialized = serializeRecording(recording);
    const replayed = replayRecording(serialized);

    expect(replayed).toEqual(recording);
    expect(serializeRecording(replayed)).toBe(serialized);
    expect(domain.validateCanonicalUrlAttackRecording(recording)).toEqual(recording);
    expect(replayed.bundles.attack.runId).toBe(ATTACK_RUN_ID);
    expect(replayed.bundles.control.runId).toBe(CONTROL_RUN_ID);
  });

  it("binds every persisted identity to the embedded bundle's exact checksum, bytes, run, sequence, tx and round", () => {
    expectCreateBoundary();
    const content = makeCanonicalUrlAttackRecordingContent();
    const mutations: Array<[string, (value: any) => void]> = [
      ["canonical bytes", (value) => { value.bundles.attack.canonicalBundle += " "; }],
      ["canonical bytes SHA", (value) => { value.bundles.attack.canonicalBundleSha256 = value.bundles.control.canonicalBundleSha256; }],
      ["canonical byte size", (value) => { value.bundles.attack.canonicalBundleUtf8Bytes += 1; }],
      ["bundle checksum", (value) => { value.bundles.attack.bundleChecksum = value.bundles.control.bundleChecksum; }],
      ["run id", (value) => { value.bundles.attack.runId = "run_substituted"; }],
      ["last sequence", (value) => { value.bundles.attack.lastSequence += 1; }],
      ["transaction", (value) => { value.bundles.attack.transactionHash = value.bundles.control.transactionHash; }],
      ["round", (value) => { value.bundles.attack.votingRound += 1; }],
      ["proof", (value) => { value.bundles.attack.proofSha256 = value.bundles.control.proofSha256; }],
      ["bundle substitution", (value) => { value.bundles.attack.canonicalBundle = value.bundles.control.canonicalBundle; }],
    ];

    for (const [name, mutate] of mutations) {
      const mutated: any = structuredClone(content);
      mutate(mutated);
      expect(() => createRecording(mutated), name).toThrow();
    }
  });

  it("requires two different live runs and forbids replay, synthetic and test-system evidence", () => {
    expectCreateBoundary();
    const mutations: Array<[string, (value: any) => void]> = [
      ["same run", (value) => { value.bundles.control.runId = value.bundles.attack.runId; }],
      ["replay mode", (value) => { value.bundles.attack.submissionMode = "replay"; }],
      ["replay provenance", (value) => { value.bundles.attack.provenance = "replay"; }],
      ["synthetic provenance", (value) => { value.bundles.attack.provenance = "synthetic"; }],
      ["test provenance", (value) => { value.bundles.attack.provenance = "test-system"; }],
    ];

    for (const [name, mutate] of mutations) {
      const mutated: any = structuredClone(makeCanonicalUrlAttackRecordingContent());
      mutate(mutated);
      expect(() => createRecording(mutated), name).toThrow();
    }
  });

  it("requires method, query, JQ, ABI and transformed response shape to match across attack and control", () => {
    expectCreateBoundary();
    const mutations: Array<[string, (value: any) => void]> = [
      ["query", (value) => { value.sharedRequest.query.currency = "EUR"; }],
      ["JQ", (value) => { value.sharedRequest.jq = ".different"; }],
      ["ABI", (value) => { value.sharedRequest.abiSignature = JSON.stringify({ name: "other", type: "uint256" }); }],
      ["attack shape", (value) => { value.bundles.attack.transformedResponseShapeSha256 = `sha256:${"c".repeat(64)}`; }],
      ["control shape", (value) => { value.bundles.control.transformedResponseShapeSha256 = `sha256:${"d".repeat(64)}`; }],
    ];

    for (const [name, mutate] of mutations) {
      const mutated: any = structuredClone(makeCanonicalUrlAttackRecordingContent());
      mutate(mutated);
      expect(() => createRecording(mutated), name).toThrow();
    }
  });

  it("proves an attack host distinct from the safe intended host while control covers that host", () => {
    expectCreateBoundary();
    const valid = createRecording();
    expect(new URL(valid.bundles.attack.requestedUrl).hostname).toBe("attacker.example");
    expect(new URL(valid.bundles.control.requestedUrl).hostname).toBe("api.example.com");

    const mutations: Array<[string, (value: any) => void]> = [
      ["same URL", (value) => { value.bundles.attack.requestedUrl = value.bundles.control.requestedUrl; }],
      ["attack reference drift", (value) => { value.bundles.attack.requestedUrl = "https://evil.invalid/prices/eth?currency=USD&source=primary&window=1h"; }],
      ["control reference drift", (value) => { value.bundles.control.requestedUrl = "https://mirror.invalid/prices/eth?currency=USD&source=primary&window=1h"; }],
    ];

    for (const [name, mutate] of mutations) {
      const mutated: any = structuredClone(makeCanonicalUrlAttackRecordingContent());
      mutate(mutated);
      expect(() => createRecording(mutated), name).toThrow();
    }
  });

  it("binds the deterministic compiler/runtime transcript to exact sources, bytecode, proofs and calldata", () => {
    expectCreateBoundary();
    const mutations: Array<[string, (value: any) => void]> = [
      ["vulnerable runtime", (value) => { value.transcript.executions[0].runtimeBytecodeSha256 = value.consumers.safe.runtimeBytecodeSha256; }],
      ["safe runtime", (value) => { value.transcript.executions[1].runtimeBytecodeSha256 = value.consumers.vulnerable.runtimeBytecodeSha256; }],
      ["attack proof", (value) => { value.transcript.executions[0].proofSha256 = value.bundles.control.proofSha256; }],
      ["control proof", (value) => { value.transcript.executions[2].proofSha256 = value.bundles.attack.proofSha256; }],
      ["same attack calldata", (value) => { value.transcript.executions[1].calldataSha256 = `sha256:${"e".repeat(64)}`; }],
      ["safe attack accepts", (value) => { value.transcript.executions[1].result = value.transcript.executions[0].result; }],
      ["wrong selector", (value) => { value.transcript.executions[1].result.selector = "0xdeadbeef"; }],
      ["control rejects", (value) => { value.transcript.executions[2].result = value.transcript.executions[1].result; }],
    ];

    for (const [name, mutate] of mutations) {
      const mutated: any = structuredClone(makeCanonicalUrlAttackRecordingContent());
      mutate(mutated);
      expect(() => createRecording(mutated), name).toThrow();
    }

    const valid = createRecording();
    expect(valid.transcript.executions[1].result).toMatchObject({
      status: "reverted",
      error: "HostMismatch()",
      selector: HOST_MISMATCH_SELECTOR,
    });
  });

  it("detects outer checksum, canonical-byte and truncation mutations", () => {
    expectCreateBoundary();
    expectReplayBoundaries();
    const serialized = serializeRecording(createRecording());
    const checksumMutation = serialized.replace(/"checksum":"sha256:[a-f0-9]/, '"checksum":"sha256:f');
    const nonCanonical = JSON.stringify(JSON.parse(serialized), null, 2);
    const truncated = serialized.slice(0, -1);

    expect(() => replayRecording(checksumMutation)).toThrow(/checksum/i);
    expect(() => replayRecording(nonCanonical)).toThrow(/canonical/i);
    expect(() => replayRecording(truncated)).toThrow(/JSON|recording/i);
  });

  it("rejects oversized input before parsing and never serializes credentials or raw secrets", () => {
    expectCreateBoundary();
    expectReplayBoundaries();
    const maximum = 6 * 1_024 * 1_024;
    const oversized = `{"padding":"${"x".repeat(maximum)}"}`;
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(maximum);
    expect(() => replayRecording(oversized)).toThrow(/6291456|6 MiB|size/i);

    const content: any = structuredClone(makeCanonicalUrlAttackRecordingContent());
    content.authorization = "Bearer project_super_secret";
    expect(() => createRecording(content)).toThrow();

    const serialized = serializeRecording(createRecording());
    expect(serialized).not.toMatch(/Bearer|project_[A-Za-z0-9_-]{16,}|private.?key|secret|authorization/i);
  });

  it("derives every transcript hash from bounded raw reproduction bytes", () => {
    const valid = makeCanonicalUrlAttackRecordingContent();
    expect(() => createRecording(valid)).not.toThrow();

    const mutations: Array<[string, (value: any) => void]> = [
      ["standard JSON input", (value) => { value.reproduction.standardJson.input += " "; }],
      ["standard JSON output", (value) => { value.reproduction.standardJson.output += " "; }],
      ["vulnerable source", (value) => { value.reproduction.sources.vulnerable.content += "// forged"; }],
      ["safe source", (value) => { value.reproduction.sources.safe.content += "// forged"; }],
      ["invariant source", (value) => { value.reproduction.sources.invariantLibrary.content += "// forged"; }],
      ["vulnerable creation", (value) => { value.reproduction.bytecode.vulnerable.creation = "0x6000"; }],
      ["vulnerable runtime", (value) => { value.reproduction.bytecode.vulnerable.runtime = "0x6000"; }],
      ["safe creation", (value) => { value.reproduction.bytecode.safe.creation = "0x6000"; }],
      ["safe runtime", (value) => { value.reproduction.bytecode.safe.runtime = "0x6000"; }],
      ["verifier runtime", (value) => { value.reproduction.bytecode.exactProofVerifier.runtime = "0x6000"; }],
      ["shape", (value) => { value.reproduction.transformedResponseShapeCanonicalJson = "{}"; }],
      ["attack calldata", (value) => { value.reproduction.executions[0].calldata = "0x0102"; }],
      ["safe attack calldata", (value) => { value.reproduction.executions[1].calldata = "0x0102"; }],
      ["control calldata", (value) => { value.reproduction.executions[2].calldata = "0x0102"; }],
      ["attack return", (value) => { value.reproduction.executions[0].result.returnData = "0x0102"; }],
      ["attack revert", (value) => { value.reproduction.executions[1].result.revertData = "0xb828610a00"; }],
      ["control return", (value) => { value.reproduction.executions[2].result.returnData = "0x0102"; }],
    ];

    for (const [name, mutate] of mutations) {
      const value: any = structuredClone(valid);
      mutate(value);
      expect(() => createRecording(value), name).toThrow(/recording|checksum|canonical|schema/i);
    }
  });

  it("requires canonical standard JSON and canonical transformed-shape bytes", () => {
    const mutations: Array<[string, (value: any) => void]> = [
      ["pretty compiler input", (value) => {
        value.reproduction.standardJson.input = JSON.stringify(
          JSON.parse(value.reproduction.standardJson.input),
          null,
          2,
        );
        value.toolchain.compiler.inputSha256 = sha256(
          value.reproduction.standardJson.input,
        );
      }],
      ["noncanonical compiler output", (value) => {
        value.reproduction.standardJson.output = '{"z":1,"a":2}';
        value.toolchain.compiler.outputSha256 = sha256(
          value.reproduction.standardJson.output,
        );
      }],
      ["noncanonical shape", (value) => {
        value.reproduction.transformedResponseShapeCanonicalJson = '{"z":1,"a":2}';
        const hash = sha256(
          value.reproduction.transformedResponseShapeCanonicalJson,
        );
        value.sharedRequest.transformedResponseShapeSha256 = hash;
        value.bundles.attack.transformedResponseShapeSha256 = hash;
        value.bundles.control.transformedResponseShapeSha256 = hash;
      }],
    ];

    for (const [name, mutate] of mutations) {
      const value: any = structuredClone(makeCanonicalUrlAttackRecordingContent());
      mutate(value);
      expect(() => createRecording(value), name).toThrow(/canonical|checksum|recording/i);
    }
  });
});
