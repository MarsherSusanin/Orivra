// @vitest-environment node

import {
  ProductEventV1Schema,
  type ProductEventNameV1,
  type ProductEventV1,
} from "@proofline/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_ANALYTICS_QUEUE_KEY_V1,
  createLocalProductAnalytics,
  reduceProductFunnel,
} from "../src/product-analytics";

const metadataByName = {
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

function event(
  name: ProductEventNameV1,
  sessionId = "session_primary",
  offsetMs = 0,
): ProductEventV1 {
  return ProductEventV1Schema.parse({
    version: "1",
    sessionId,
    occurredAt: new Date(Date.UTC(2026, 7, 2, 2, 0, 0) + offsetMs).toISOString(),
    name,
    metadata: metadataByName[name],
  });
}

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

describe("versioned local product analytics queue", () => {
  it("keeps at most 500 valid events and discards the oldest first", () => {
    const storage = memoryStorage();
    const analytics = createLocalProductAnalytics({ storage });
    const emitted = Array.from({ length: 503 }, (_, index) =>
      event("COMPOSER_STARTED", `session_${index}`, index),
    );

    for (const item of emitted) analytics.emit(item);

    expect(analytics.readEvents()).toEqual(emitted.slice(3));
    expect(analytics.readEvents()).toHaveLength(500);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      PRODUCT_ANALYTICS_QUEUE_KEY_V1,
      expect.any(String),
    );
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1])).toMatchObject({
      version: "1",
      events: emitted.slice(3),
    });
  });

  it.each(["not-json", JSON.stringify({ version: "2", events: [] }), JSON.stringify({
    version: "1",
    events: [{ token: `project_${"a".repeat(64)}` }],
  })])("fails closed for corrupt persisted state", (persisted) => {
    const analytics = createLocalProductAnalytics({ storage: memoryStorage(persisted) });

    expect(analytics.readEvents()).toEqual([]);
    expect(() => analytics.emit(event("RUN_RESUMED"))).not.toThrow();
    expect(analytics.readEvents()).toEqual([event("RUN_RESUMED")]);
  });

  it("never lets denied browser storage block the product flow", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    };
    const analytics = createLocalProductAnalytics({ storage });

    expect(() => analytics.emit(event("COMPOSER_STARTED"))).not.toThrow();
    expect(analytics.readEvents()).toEqual([]);
  });
});

describe("deterministic product funnel", () => {
  it("counts a duplicated, completed journey once per session in canonical step order", () => {
    const completeNames: ProductEventNameV1[] = [
      "COMPOSER_STARTED",
      "MANIFEST_VALIDATED",
      "PREFLIGHT_COMPLETED",
      "SUBMISSION_REQUESTED",
      "PROOF_AVAILABLE",
      "SAFE_CODEGEN_GENERATED",
      "BUNDLE_REPLAYED",
    ];
    const events = [
      ...completeNames.map((name, index) => event(name, "session_complete", index)),
      event("PROOF_AVAILABLE", "session_complete", 20),
      event("RUN_RESUMED", "session_complete", 21),
      event("COMPOSER_STARTED", "session_failed", 30),
      event("MANIFEST_VALIDATED", "session_failed", 31),
      event("PREFLIGHT_COMPLETED", "session_failed", 32),
      event("SUBMISSION_REQUESTED", "session_failed", 33),
      event("PROOF_AVAILABLE", "session_failed", 34),
      event("CONSUMER_VERIFICATION_FAILED", "session_failed", 35),
    ];

    const first = reduceProductFunnel(events);
    const second = reduceProductFunnel(events.map((item) => structuredClone(item)));

    expect(second).toEqual(first);
    expect(first).toEqual({
      version: "1",
      sessions: 2,
      completedSessions: 1,
      failedSessions: 1,
      resumedSessions: 1,
      steps: [
        { name: "COMPOSER_STARTED", sessions: 2 },
        { name: "MANIFEST_VALIDATED", sessions: 2 },
        { name: "PREFLIGHT_COMPLETED", sessions: 2 },
        { name: "SUBMISSION_REQUESTED", sessions: 2 },
        { name: "PROOF_AVAILABLE", sessions: 2 },
        { name: "CONSUMER_VERIFICATION_FAILED", sessions: 1 },
        { name: "SAFE_CODEGEN_GENERATED", sessions: 1 },
        { name: "BUNDLE_REPLAYED", sessions: 1 },
        { name: "RUN_RESUMED", sessions: 1 },
      ],
    });
  });
});
