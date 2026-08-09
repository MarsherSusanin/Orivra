// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Domain from "../src/index";
import {
  canonicalSerializeTestRecording,
  makeCanonicalUrlAttackRecording,
  sha256,
} from "../../contracts/test/slice024a-canonical-url-attack.fixtures";
import { makeCanonicalUrlAttackDemoSummary } from "../../contracts/test/slice024b-canonical-url-attack-demo.fixtures";

const domain = Domain as Record<string, any>;

function derive(recording = makeCanonicalUrlAttackRecording(), recordingBytes = canonicalSerializeTestRecording()) {
  expect(domain.deriveCanonicalUrlAttackDemoSummary).toBeTypeOf("function");
  return domain.deriveCanonicalUrlAttackDemoSummary({
    recording,
    recordingSha256: sha256(recordingBytes),
  });
}

describe("Slice 024B pure canonical URL attack demo derivation", () => {
  it("exports one deterministic pure derivation boundary", () => {
    expect(domain.deriveCanonicalUrlAttackDemoSummary).toBeTypeOf("function");
    expect(derive()).toEqual(makeCanonicalUrlAttackDemoSummary());
  });

  it("derives identical summaries despite recording object insertion order", () => {
    const recording = makeCanonicalUrlAttackRecording();
    const reordered: any = {
      checksum: recording.checksum,
      reproduction: recording.reproduction,
      transcript: recording.transcript,
      consumers: recording.consumers,
      toolchain: recording.toolchain,
      bundles: recording.bundles,
      sharedRequest: recording.sharedRequest,
      statement: recording.statement,
      network: recording.network,
      release: recording.release,
      recordedAt: recording.recordedAt,
      kind: recording.kind,
      version: recording.version,
    };
    expect(derive(reordered)).toEqual(derive(recording));
  });

  it("copies only bounded public evidence and never reproduction or bundle bytes", () => {
    const summary = derive();
    const serialized = domain.canonicalJson(summary);
    expect(serialized).not.toContain("canonicalBundle");
    expect(serialized).not.toContain("reproduction");
    expect(serialized).not.toContain("standardJson");
    expect(serialized).not.toContain("bytecode");
    expect(serialized).not.toMatch(/returnData"|revertData"|calldata"/);
  });

  it("requires the supplied exact-byte digest to be a lowercase SHA-256 envelope", () => {
    expect(domain.deriveCanonicalUrlAttackDemoSummary).toBeTypeOf("function");
    for (const digest of ["sha256:1234", `sha256:${"A".repeat(64)}`, `0x${"a".repeat(64)}`]) {
      expect(() => domain.deriveCanonicalUrlAttackDemoSummary({
        recording: makeCanonicalUrlAttackRecording(),
        recordingSha256: digest,
      })).toThrow();
    }
  });

  it("does not turn pure replay or derivation into import authority", () => {
    expect(domain.authorizeCanonicalUrlAttackRecordingImport).toBeUndefined();
    expect(domain.runtimeVerifyCanonicalUrlAttackRecording).toBeUndefined();
    const replayed = domain.replayCanonicalUrlAttackRecording(
      canonicalSerializeTestRecording(),
    );
    expect(derive(replayed).status).toBe("available");
    expect(derive(replayed)).not.toHaveProperty("runtimeVerified");
  });

  it("rejects invalid recording content rather than deriving a plausible summary", () => {
    expect(domain.deriveCanonicalUrlAttackDemoSummary).toBeTypeOf("function");
    const invalid: any = structuredClone(makeCanonicalUrlAttackRecording());
    invalid.transcript.executions[1].result.status = "accepted";
    expect(() => domain.deriveCanonicalUrlAttackDemoSummary({
      recording: invalid,
      recordingSha256: sha256(canonicalSerializeTestRecording()),
    })).toThrow();
  });
});
