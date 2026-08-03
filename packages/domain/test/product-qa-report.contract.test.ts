// @vitest-environment node

import fc from "fast-check";
import {
  ProductEventV1Schema,
  type ProductEventNameV1,
  type ProductEventV1,
} from "@proofline/contracts";
import { describe, expect, it, vi } from "vitest";
import * as Domain from "../src";

const FUNNEL_STEPS = [
  "COMPOSER_STARTED",
  "MANIFEST_VALIDATED",
  "PREFLIGHT_COMPLETED",
  "SUBMISSION_REQUESTED",
  "PROOF_AVAILABLE",
  "CONSUMER_VERIFICATION_FAILED",
  "SAFE_CODEGEN_GENERATED",
  "BUNDLE_REPLAYED",
  "RUN_RESUMED",
] as const;

const CANONICAL_STEPS = [
  "COMPOSER_STARTED",
  "MANIFEST_VALIDATED",
  "PREFLIGHT_COMPLETED",
  "SUBMISSION_REQUESTED",
  "PROOF_AVAILABLE",
  "SAFE_CODEGEN_GENERATED",
  "BUNDLE_REPLAYED",
] as const;

const metadata = {
  COMPOSER_STARTED: { entryPoint: "runs" },
  MANIFEST_VALIDATED: { outcome: "accepted" },
  PREFLIGHT_COMPLETED: { outcome: "accepted" },
  SUBMISSION_REQUESTED: { mode: "replay" },
  PROOF_AVAILABLE: { source: "replay" },
  CONSUMER_VERIFICATION_FAILED: { category: "consumer-invariant" },
  SAFE_CODEGEN_GENERATED: { target: "solidity" },
  BUNDLE_REPLAYED: { outcome: "byte-identical" },
  RUN_RESUMED: { priorStatus: "failed" },
} as const;

type QueueStatus = "healthy" | "recovered" | "unavailable";
type CounterBlock = {
  observed: number;
  valid: number;
  invalid: number;
  completed: number;
  consumerFailed: number;
  resumed: number;
};
type QaReport = {
  version: "1";
  queue: { status: QueueStatus; retainedEventCount: number };
  sessions: CounterBlock;
  journeys: CounterBlock;
  steps: Array<{
    name: ProductEventNameV1;
    sessions: number;
    journeys: number;
  }>;
};
type ReduceQaReport = (
  events: readonly ProductEventV1[],
  queueStatus?: QueueStatus,
) => QaReport;
type SerializeQaReport = (report: QaReport) => string;
type QaAnalytics = ReturnType<typeof Domain.createLocalProductAnalytics> & {
  exportQaReport(): string;
};

const reduceQaReport = (Domain as unknown as Record<string, unknown>)
  .reduceProductQaReport as ReduceQaReport | undefined;
const serializeQaReport = (Domain as unknown as Record<string, unknown>)
  .canonicalSerializeProductQaReport as SerializeQaReport | undefined;

function sessionId(index: number): string {
  return `session_00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function event(
  name: ProductEventNameV1,
  session = sessionId(1),
  offsetMs = 0,
  eventMetadata: unknown = metadata[name],
): ProductEventV1 {
  return ProductEventV1Schema.parse({
    version: "1",
    sessionId: session,
    occurredAt: new Date(Date.UTC(2026, 7, 3) + offsetMs).toISOString(),
    name,
    metadata: eventMetadata,
  });
}

function completeJourney(session: string, offset = 0): ProductEventV1[] {
  return CANONICAL_STEPS.map((name, index) => event(name, session, offset + index));
}

function step(report: QaReport, name: ProductEventNameV1) {
  return report.steps.find((row) => row.name === name)!;
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

function qaAnalytics(storage: ReturnType<typeof memoryStorage>): QaAnalytics {
  return Domain.createLocalProductAnalytics({ storage }) as QaAnalytics;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

describe("Slice 021B public domain reporting API", () => {
  it("exports the deterministic ProductQaReport reducer", () => {
    expect(reduceQaReport, "reduceProductQaReport production export is missing")
      .toBeTypeOf("function");
  });

  it("exports the canonical ProductQaReport serializer", () => {
    expect(
      serializeQaReport,
      "canonicalSerializeProductQaReport production export is missing",
    ).toBeTypeOf("function");
  });

  it("adds non-throwing exportQaReport to LocalProductAnalytics", () => {
    const analytics = qaAnalytics(memoryStorage());
    expect(
      analytics.exportQaReport,
      "LocalProductAnalytics.exportQaReport production API is missing",
    ).toBeTypeOf("function");
  });
});

describe.runIf(reduceQaReport && serializeQaReport)(
  "retry- and repeated-journey-aware ProductQaReport reducer",
  () => {
    it("accepts rejected-to-accepted retries without erasing valid progress", () => {
      const session = sessionId(2);
      const events = [
        event("COMPOSER_STARTED", session, 0),
        event("MANIFEST_VALIDATED", session, 1, { outcome: "rejected" }),
        event("MANIFEST_VALIDATED", session, 2, { outcome: "accepted" }),
        event("PREFLIGHT_COMPLETED", session, 3, { outcome: "rejected" }),
        event("PREFLIGHT_COMPLETED", session, 4, { outcome: "accepted" }),
        event("SUBMISSION_REQUESTED", session, 5),
        event("PROOF_AVAILABLE", session, 6),
        event("CONSUMER_VERIFICATION_FAILED", session, 7),
        event("SAFE_CODEGEN_GENERATED", session, 8),
        event("BUNDLE_REPLAYED", session, 9, { outcome: "mismatch" }),
        event("BUNDLE_REPLAYED", session, 10, { outcome: "byte-identical" }),
      ];

      const report = reduceQaReport!(events, "healthy");
      expect(report.queue).toEqual({ status: "healthy", retainedEventCount: 11 });
      expect(report.sessions).toEqual({
        observed: 1,
        valid: 1,
        invalid: 0,
        completed: 1,
        consumerFailed: 1,
        resumed: 0,
      });
      expect(report.journeys).toEqual(report.sessions);
      expect(report.steps).toEqual(FUNNEL_STEPS.map((name) => ({
        name,
        sessions: name === "RUN_RESUMED" ? 0 : 1,
        journeys: name === "RUN_RESUMED" ? 0 : 1,
      })));
    });

    it("counts two completed journeys in one session while deduplicating step rows", () => {
      const session = sessionId(3);
      const report = reduceQaReport!([
        ...completeJourney(session, 0),
        ...completeJourney(session, 20),
      ]);

      expect(report.sessions).toEqual({
        observed: 1,
        valid: 1,
        invalid: 0,
        completed: 1,
        consumerFailed: 0,
        resumed: 0,
      });
      expect(report.journeys).toEqual({
        observed: 2,
        valid: 2,
        invalid: 0,
        completed: 2,
        consumerFailed: 0,
        resumed: 0,
      });
      for (const name of CANONICAL_STEPS) {
        expect(step(report, name)).toEqual({ name, sessions: 1, journeys: 2 });
      }
    });

    it("counts duplicate events once and continues after the consumer-failure branch", () => {
      const session = sessionId(4);
      const events = CANONICAL_STEPS.flatMap((name, index) => [
        event(name, session, index * 10),
        event(name, session, index * 10 + 1),
      ]);
      events.splice(10, 0, event("CONSUMER_VERIFICATION_FAILED", session, 45));
      const report = reduceQaReport!(events);

      expect(report.sessions.valid).toBe(1);
      expect(report.journeys.completed).toBe(1);
      expect(report.journeys.consumerFailed).toBe(1);
      expect(step(report, "CONSUMER_VERIFICATION_FAILED")).toEqual({
        name: "CONSUMER_VERIFICATION_FAILED",
        sessions: 1,
        journeys: 1,
      });
      expect(report.steps.every(({ sessions, journeys }) =>
        sessions <= 1 && journeys <= 1)).toBe(true);
    });

    it("treats a resume-only session as one valid, non-completed journey", () => {
      const report = reduceQaReport!([event("RUN_RESUMED", sessionId(5), 0)]);
      expect(report.sessions).toEqual({
        observed: 1,
        valid: 1,
        invalid: 0,
        completed: 0,
        consumerFailed: 0,
        resumed: 1,
      });
      expect(report.journeys).toEqual(report.sessions);
      expect(step(report, "RUN_RESUMED")).toEqual({
        name: "RUN_RESUMED",
        sessions: 1,
        journeys: 1,
      });
      expect(report.steps.filter(({ name }) => name !== "RUN_RESUMED")
        .every(({ sessions, journeys }) => sessions === 0 && journeys === 0))
        .toBe(true);
    });

    it.each([
      ["a second composer before completion", [
        event("COMPOSER_STARTED", sessionId(6), 0),
        event("MANIFEST_VALIDATED", sessionId(6), 1),
        event("COMPOSER_STARTED", sessionId(6), 2),
      ]],
      ["a backward timestamp", completeJourney(sessionId(7)).map((item, index) =>
        index === 5 ? { ...item, occurredAt: event(item.name, sessionId(7), 2).occurredAt } : item)],
    ])("counts %s as invalid structural evidence", (_label, events) => {
      const report = reduceQaReport!(events);
      expect(report.sessions).toEqual({
        observed: 1,
        valid: 0,
        invalid: 1,
        completed: 0,
        consumerFailed: 0,
        resumed: 0,
      });
      expect(report.journeys).toEqual(report.sessions);
      expect(report.steps.every(({ sessions, journeys }) =>
        sessions === 0 && journeys === 0)).toBe(true);
    });

    it("is stable when independent sessions are interleaved", () => {
      const left = completeJourney(sessionId(8), 0);
      const right = completeJourney(sessionId(9), 100);
      const interleaved = left.flatMap((item, index) => [item, right[index]]);
      const grouped = [...left, ...right];
      const first = reduceQaReport!(interleaved);
      const second = reduceQaReport!(grouped);

      expect(first).toEqual(second);
      expect(serializeQaReport!(first)).toBe(serializeQaReport!(second));
      expect(first.sessions.completed).toBe(2);
      expect(first.journeys.completed).toBe(2);
    });

    it("serializes byte-identically for cloned and cross-session regrouped evidence", () => {
      fc.assert(fc.property(fc.integer({ min: 1, max: 12 }), (sessionCount) => {
        const journeys = Array.from({ length: sessionCount }, (_, index) =>
          completeJourney(sessionId(100 + index), index * 20));
        const grouped = journeys.flat();
        const interleaved = CANONICAL_STEPS.flatMap((_name, stepIndex) =>
          journeys.map((journey) => journey[stepIndex]));
        const groupedBytes = serializeQaReport!(reduceQaReport!(grouped));
        const interleavedBytes = serializeQaReport!(reduceQaReport!(interleaved));

        expect(interleavedBytes).toBe(groupedBytes);
        expect(serializeQaReport!(structuredClone(reduceQaReport!(grouped))))
          .toBe(groupedBytes);
        expect(groupedBytes).toBe(canonicalJson(JSON.parse(groupedBytes)));
      }), { numRuns: 50 });
    });
  },
);

const probeAnalytics = qaAnalytics(memoryStorage());
describe.runIf(typeof probeAnalytics.exportQaReport === "function")(
  "LocalProductAnalytics queue health and aggregate-only export",
  () => {
    it.each([
      ["null state", null, 0],
      ["valid state", JSON.stringify({
        version: "1",
        events: [event("RUN_RESUMED", sessionId(10), 0)],
      }), 1],
    ])("exports a healthy report for %s", (_label, initial, count) => {
      const serialized = qaAnalytics(memoryStorage(initial)).exportQaReport();
      const report = JSON.parse(serialized) as QaReport;
      expect(report.queue).toEqual({ status: "healthy", retainedEventCount: count });
      expect(serialized).toBe(canonicalJson(report));
    });

    it("keeps recovered status for the adapter lifetime after corrupt storage", () => {
      const analytics = qaAnalytics(memoryStorage("not-json"));
      expect(JSON.parse(analytics.exportQaReport()).queue).toEqual({
        status: "recovered",
        retainedEventCount: 0,
      });
      analytics.emit(event("RUN_RESUMED", sessionId(11), 1));
      expect(JSON.parse(analytics.exportQaReport()).queue).toEqual({
        status: "recovered",
        retainedEventCount: 1,
      });
    });

    it("returns unavailable with zero retained events when storage is denied", () => {
      const storage = {
        getItem: vi.fn(() => {
          throw new DOMException("denied", "SecurityError");
        }),
        setItem: vi.fn(() => {
          throw new DOMException("denied", "SecurityError");
        }),
      };
      const analytics = Domain.createLocalProductAnalytics({ storage }) as QaAnalytics;
      expect(() => analytics.exportQaReport()).not.toThrow();
      expect(JSON.parse(analytics.exportQaReport()).queue).toEqual({
        status: "unavailable",
        retainedEventCount: 0,
      });
    });

    it("trims to the newest 500 events and exports no raw evidence", () => {
      const analytics = qaAnalytics(memoryStorage());
      for (let index = 0; index < 503; index += 1) {
        analytics.emit(event("RUN_RESUMED", sessionId(1_000 + index), index));
      }
      const serialized = analytics.exportQaReport();
      const report = JSON.parse(serialized) as QaReport;
      expect(report.queue).toEqual({ status: "healthy", retainedEventCount: 500 });
      expect(report.sessions).toMatchObject({ observed: 500, valid: 500, resumed: 500 });
      expect(report.journeys).toMatchObject({ observed: 500, valid: 500, resumed: 500 });
      expect(serialized).not.toMatch(/session_|occurredAt|timestamp|https?:|project_|share_/i);
      expect(serialized).not.toContain('"events"');
      expect(Object.keys(report)).toEqual(["journeys", "queue", "sessions", "steps", "version"]);
    });
  },
);
