// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeFdcError } from "../src/errors";

describe("evidence-backed FDC error normalization", () => {
  it.each([
    ["missing RPC URL", { kind: "configuration" }, "configuration", false],
    ["socket reset", { code: "ECONNRESET" }, "transport", true],
    ["deadline", { name: "TimeoutError" }, "timeout", true],
    ["round pending", { status: "NOT_FINALIZED" }, "not-finalized", true],
    ["no consensus", { status: "CONSENSUS_MISS" }, "consensus-miss", false],
    ["bad verifier JSON", { status: "SCHEMA_INVALID" }, "schema-invalid", false],
    ["bad proof", { status: "PROOF_INVALID" }, "proof-invalid", false],
    ["wrong host", { status: "CONSUMER_INVARIANT" }, "consumer-invariant", false],
  ])(
    "maps %s to %s",
    (_name, error, category, retryable) => {
      expect(normalizeFdcError(error, { operation: "fixture" })).toMatchObject({
        version: "1",
        category,
        retryable,
        evidence: { operation: "fixture" },
      });
    },
  );

  it("redacts nested keys, bearer tokens, and authorization values from evidence", () => {
    const normalized = normalizeFdcError(
      new Error("request failed with Bearer top-secret-token"),
      {
        apiKey: "top-secret-api-key",
        privateKey: "0xdeadbeef",
        authorization: "Bearer project-secret",
        endpoint: "https://verifier.example",
      },
    );
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toMatch(/top-secret|deadbeef|project-secret/);
    expect(serialized).toContain("verifier.example");
  });
});
