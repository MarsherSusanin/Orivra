// @vitest-environment node

import {
  ProductEventV1Schema,
  type ProductEventNameV1,
  type ProductEventV1,
} from "@proofline/contracts";
import { describe, expect, it } from "vitest";
import { reduceProductFunnel } from "../src/product-analytics";

const metadata = {
  COMPOSER_STARTED: { entryPoint: "runs" },
  MANIFEST_VALIDATED: { outcome: "accepted" },
  PREFLIGHT_COMPLETED: { outcome: "accepted" },
  SUBMISSION_REQUESTED: { mode: "wallet" },
  PROOF_AVAILABLE: { source: "live" },
  CONSUMER_VERIFICATION_FAILED: { category: "consumer-invariant" },
  SAFE_CODEGEN_GENERATED: { target: "solidity" },
  BUNDLE_REPLAYED: { outcome: "byte-identical" },
  RUN_RESUMED: { priorStatus: "active" },
} as const;

function event(name: ProductEventNameV1, offset: number): ProductEventV1 {
  return ProductEventV1Schema.parse({
    version: "1",
    sessionId: "session_99999999-9999-4999-8999-999999999999",
    occurredAt: new Date(Date.UTC(2026, 7, 2) + offset).toISOString(),
    name,
    metadata: metadata[name],
  });
}

describe("product funnel remediation branches", () => {
  it("invalidates consumer failure without the proof predecessor", () => {
    expect(reduceProductFunnel([
      event("COMPOSER_STARTED", 0),
      event("CONSUMER_VERIFICATION_FAILED", 1),
    ])).toMatchObject({
      sessions: 1,
      failedSessions: 0,
      completedSessions: 0,
    });
  });
});
