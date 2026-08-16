import { describe, expect, it } from "vitest";
import {
  DeployedConsumerEvidenceV1Schema,
  DeployedConsumerVerificationRequestV1Schema,
} from "../src";

const sha = `sha256:${"a".repeat(64)}`;

describe("Issue #9 deployed consumer contracts", () => {
  it("accepts only a chain-114 address request", () => {
    expect(DeployedConsumerVerificationRequestV1Schema.parse({
      version: "1",
      chainId: 114,
      address: "0x1111111111111111111111111111111111111111",
    })).toEqual({
      version: "1",
      chainId: 114,
      address: "0x1111111111111111111111111111111111111111",
    });
    expect(() => DeployedConsumerVerificationRequestV1Schema.parse({
      version: "1",
      chainId: 14,
      address: "0x1111111111111111111111111111111111111111",
    })).toThrow();
  });

  it.each(["verified", "mismatched", "unavailable", "proxy-unsupported"] as const)(
    "represents the honest %s state with immutable observation and compiler bindings",
    (status) => {
      const evidence = DeployedConsumerEvidenceV1Schema.parse({
        version: "1",
        runId: "01900000-0000-4000-8000-000000000009",
        commandId: "verify-deployed",
        chainId: 114,
        address: "0x1111111111111111111111111111111111111111",
        status,
        observedAt: "2026-08-16T00:00:00.000Z",
        blockNumber: "123",
        registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
        codeSizeBytes: status === "unavailable" ? 0 : 45,
        observedRuntimeBytecodeSha256: status === "unavailable" ? null : sha,
        expectedRuntimeBytecodeSha256: sha,
        sourceSha256: sha,
        compilerVersion: "solc-0.8.36",
        diagnostics: status === "verified" ? [] : [{
          version: "1",
          code: status === "proxy-unsupported" ? "DEPLOYED_CONSUMER_PROXY_UNSUPPORTED" :
            status === "unavailable" ? "DEPLOYED_CONSUMER_CODE_UNAVAILABLE" :
              "DEPLOYED_CONSUMER_BYTECODE_MISMATCH",
          severity: status === "unavailable" ? "warning" : "error",
          confidence: "high",
          summary: "Observed deployed code does not match the canonical generated consumer.",
          evidence: { address: "0x1111111111111111111111111111111111111111" },
          remediation: "Verify the exact deployment artifact before integration.",
        }],
      });
      expect(evidence.status).toBe(status);
    },
  );

  it("rejects contradictory bytecode, verdict, and diagnostic combinations", () => {
    const verified = {
      version: "1",
      runId: "01900000-0000-4000-8000-000000000009",
      commandId: "verify-deployed",
      chainId: 114,
      address: "0x1111111111111111111111111111111111111111",
      status: "verified",
      observedAt: "2026-08-16T00:00:00.000Z",
      blockNumber: "123",
      registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
      codeSizeBytes: 45,
      observedRuntimeBytecodeSha256: sha,
      expectedRuntimeBytecodeSha256: sha,
      sourceSha256: sha,
      compilerVersion: "solc-0.8.36",
      diagnostics: [],
    };
    const diagnostic = {
      version: "1",
      code: "DEPLOYED_CONSUMER_BYTECODE_MISMATCH",
      severity: "error",
      confidence: "high",
      summary: "Observed runtime does not match.",
      evidence: {},
      remediation: "Review the deployment.",
    };

    expect(DeployedConsumerEvidenceV1Schema.safeParse({
      ...verified,
      codeSizeBytes: 0,
    }).success).toBe(false);
    expect(DeployedConsumerEvidenceV1Schema.safeParse({
      ...verified,
      diagnostics: [diagnostic],
    }).success).toBe(false);
    expect(DeployedConsumerEvidenceV1Schema.safeParse({
      ...verified,
      observedRuntimeBytecodeSha256: `sha256:${"b".repeat(64)}`,
    }).success).toBe(false);
    expect(DeployedConsumerEvidenceV1Schema.safeParse({
      ...verified,
      status: "mismatched",
      diagnostics: [],
    }).success).toBe(false);
  });
});
