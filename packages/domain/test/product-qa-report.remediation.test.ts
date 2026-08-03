// @vitest-environment node

import {
  ProductEventV1Schema,
  type ProductEventNameV1,
  type ProductEventV1,
} from "@proofline/contracts";
import { describe, expect, it } from "vitest";
import { reduceProductQaReport } from "../src/product-analytics";

const metadata = {
  COMPOSER_STARTED: { entryPoint: "runs" },
  CONSUMER_VERIFICATION_FAILED: { category: "consumer-invariant" },
  BUNDLE_REPLAYED: { outcome: "byte-identical" },
} as const;

function event(name: keyof typeof metadata, offset: number): ProductEventV1 {
  return ProductEventV1Schema.parse({
    version: "1",
    sessionId: "session_12121212-1212-4121-8121-121212121212",
    occurredAt: new Date(Date.UTC(2026, 7, 3) + offset).toISOString(),
    name: name as ProductEventNameV1,
    metadata: metadata[name],
  });
}

describe("ProductQaReport structural fail-closed branches", () => {
  it("invalidates consumer failure before proof evidence", () => {
    const report = reduceProductQaReport([
      event("COMPOSER_STARTED", 0),
      event("CONSUMER_VERIFICATION_FAILED", 1),
    ]);

    expect(report.sessions).toMatchObject({ valid: 0, invalid: 1 });
    expect(report.journeys).toMatchObject({ valid: 0, invalid: 1 });
  });

  it("invalidates a canonical step without its predecessors", () => {
    const report = reduceProductQaReport([event("BUNDLE_REPLAYED", 0)]);

    expect(report.sessions).toMatchObject({ valid: 0, invalid: 1 });
    expect(report.journeys).toMatchObject({ valid: 0, invalid: 1 });
  });
});
