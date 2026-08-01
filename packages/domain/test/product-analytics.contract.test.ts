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
  sessionId = "session_11111111-1111-4111-8111-111111111111",
  offsetMs = 0,
  metadata: unknown = metadataByName[name],
): ProductEventV1 {
  return ProductEventV1Schema.parse({
    version: "1",
    sessionId,
    occurredAt: new Date(Date.UTC(2026, 7, 2, 2, 0, 0) + offsetMs).toISOString(),
    name,
    metadata,
  });
}

function indexedSessionId(index: number): string {
  return `session_00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
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
      event("COMPOSER_STARTED", indexedSessionId(index), index),
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
    const completeSession = "session_22222222-2222-4222-8222-222222222222";
    const failedSession = "session_33333333-3333-4333-8333-333333333333";
    const completeNames: ProductEventNameV1[] = [
      "COMPOSER_STARTED",
      "MANIFEST_VALIDATED",
      "PREFLIGHT_COMPLETED",
      "SUBMISSION_REQUESTED",
      "PROOF_AVAILABLE",
      "PROOF_AVAILABLE",
      "SAFE_CODEGEN_GENERATED",
      "BUNDLE_REPLAYED",
    ];
    const events = [
      ...completeNames.map((name, index) => event(name, completeSession, index)),
      event("RUN_RESUMED", completeSession, 21),
      event("COMPOSER_STARTED", failedSession, 30),
      event("MANIFEST_VALIDATED", failedSession, 31),
      event("PREFLIGHT_COMPLETED", failedSession, 32),
      event("SUBMISSION_REQUESTED", failedSession, 33),
      event("PROOF_AVAILABLE", failedSession, 34),
      event("CONSUMER_VERIFICATION_FAILED", failedSession, 35),
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

  it("does not complete replay-only, out-of-order, backwards-time, or backwards-duplicate sessions", () => {
    const success: ProductEventNameV1[] = [
      "COMPOSER_STARTED",
      "MANIFEST_VALIDATED",
      "PREFLIGHT_COMPLETED",
      "SUBMISSION_REQUESTED",
      "PROOF_AVAILABLE",
      "SAFE_CODEGEN_GENERATED",
      "BUNDLE_REPLAYED",
    ];
    const replayOnly = "session_44444444-4444-4444-8444-444444444444";
    const outOfOrder = "session_55555555-5555-4555-8555-555555555555";
    const backwardsTime = "session_66666666-6666-4666-8666-666666666666";
    const backwardsDuplicate = "session_77777777-7777-4777-8777-777777777777";
    const events = [
      event("BUNDLE_REPLAYED", replayOnly, 0),
      ...[
        "COMPOSER_STARTED",
        "PREFLIGHT_COMPLETED",
        "MANIFEST_VALIDATED",
        "SUBMISSION_REQUESTED",
        "PROOF_AVAILABLE",
        "SAFE_CODEGEN_GENERATED",
        "BUNDLE_REPLAYED",
      ].map((name, index) => event(name as ProductEventNameV1, outOfOrder, 100 + index)),
      ...success.map((name, index) =>
        event(name, backwardsTime, index === 4 ? 199 : 200 + index),
      ),
      ...success.map((name, index) => event(name, backwardsDuplicate, 300 + index)),
      event("MANIFEST_VALIDATED", backwardsDuplicate, 308),
    ];

    expect(reduceProductFunnel(events)).toMatchObject({
      sessions: 4,
      completedSessions: 0,
    });
  });

  it("advances to safe handoff only through accepted outcomes and byte-identical replay", () => {
    const canonicalJourney = (
      sessionId: string,
      outcomes: {
        manifest?: "accepted" | "rejected";
        preflight?: "accepted" | "rejected";
        bundle?: "byte-identical" | "mismatch" | "rejected";
      } = {},
    ) => [
      event("COMPOSER_STARTED", sessionId, 0),
      event("MANIFEST_VALIDATED", sessionId, 1, {
        outcome: outcomes.manifest ?? "accepted",
      }),
      event("PREFLIGHT_COMPLETED", sessionId, 2, {
        outcome: outcomes.preflight ?? "accepted",
      }),
      event("SUBMISSION_REQUESTED", sessionId, 3),
      event("PROOF_AVAILABLE", sessionId, 4),
      event("SAFE_CODEGEN_GENERATED", sessionId, 5),
      event("BUNDLE_REPLAYED", sessionId, 6, {
        outcome: outcomes.bundle ?? "byte-identical",
      }),
    ];
    const accepted = "session_99999999-9999-4999-8999-999999999999";
    const manifestRejected = "session_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const preflightRejected = "session_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const bundleMismatch = "session_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const bundleRejected = "session_dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    expect(reduceProductFunnel([
      ...canonicalJourney(accepted),
      ...canonicalJourney(manifestRejected, { manifest: "rejected" }),
      ...canonicalJourney(preflightRejected, { preflight: "rejected" }),
      ...canonicalJourney(bundleMismatch, { bundle: "mismatch" }),
      ...canonicalJourney(bundleRejected, { bundle: "rejected" }),
    ])).toMatchObject({
      sessions: 5,
      completedSessions: 1,
      steps: [
        { name: "COMPOSER_STARTED", sessions: 5 },
        { name: "MANIFEST_VALIDATED", sessions: 5 },
        { name: "PREFLIGHT_COMPLETED", sessions: 4 },
        { name: "SUBMISSION_REQUESTED", sessions: 3 },
        { name: "PROOF_AVAILABLE", sessions: 3 },
        { name: "CONSUMER_VERIFICATION_FAILED", sessions: 0 },
        { name: "SAFE_CODEGEN_GENERATED", sessions: 3 },
        { name: "BUNDLE_REPLAYED", sessions: 1 },
        { name: "RUN_RESUMED", sessions: 0 },
      ],
    });
  });
});
