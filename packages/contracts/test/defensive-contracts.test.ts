// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  NormalizedFdcErrorSchema,
  RunProjectionV1Schema,
  Web2JsonManifestV1Schema,
} from "../src/index";
import { validManifest } from "./fixtures";

describe("defensive public contract branches", () => {
  it("rejects malformed URL text through the URL parser boundary", () => {
    expect(() =>
      Web2JsonManifestV1Schema.parse({
        ...validManifest,
        request: { ...validManifest.request, url: "not a url" },
      }),
    ).toThrow(/public HTTPS URL/i);
  });

  it.each([
    "configuration",
    "transport",
    "timeout",
    "not-finalized",
    "consensus-miss",
    "schema-invalid",
    "proof-invalid",
    "consumer-invariant",
  ] as const)("accepts the stable %s FDC error category", (category) => {
    expect(
      NormalizedFdcErrorSchema.parse({
        version: "1",
        category,
        code: "FDC_FAILURE",
        message: "Evidence-backed failure",
        retryable: category === "transport" || category === "timeout",
        evidence: {},
      }).category,
    ).toBe(category);
  });

  it("accepts an explicitly failed consumer stage without weakening the six-stage shape", () => {
    expect(
      RunProjectionV1Schema.parse({
        version: "1",
        runId: "run_failed",
        sequence: 7,
        terminal: true,
        stages: {
          preflight: "completed",
          request: "completed",
          round: "completed",
          proof: "completed",
          verify: "completed",
          consumer: "failed",
        },
      }).stages.consumer,
    ).toBe("failed");
  });
});
