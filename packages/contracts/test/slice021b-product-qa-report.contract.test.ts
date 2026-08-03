// @vitest-environment node

import * as Contracts from "../src";
import { describe, expect, it } from "vitest";

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

type ParseResult = { success: boolean };
type ReportSchema = {
  parse(value: unknown): unknown;
  safeParse(value: unknown): ParseResult;
};

const reportSchema = (Contracts as unknown as Record<string, unknown>)
  .ProductQaReportV1Schema as ReportSchema | undefined;

const validReport = {
  version: "1",
  queue: { status: "healthy", retainedEventCount: 9 },
  sessions: {
    observed: 1,
    valid: 1,
    invalid: 0,
    completed: 1,
    consumerFailed: 1,
    resumed: 1,
  },
  journeys: {
    observed: 1,
    valid: 1,
    invalid: 0,
    completed: 1,
    consumerFailed: 1,
    resumed: 1,
  },
  steps: FUNNEL_STEPS.map((name) => ({ name, sessions: 1, journeys: 1 })),
} as const;

describe("ProductQaReportV1 aggregate-only public contract", () => {
  it("exports ProductQaReportV1Schema from the public contracts package", () => {
    expect(reportSchema, "ProductQaReportV1Schema production export is missing")
      .toBeDefined();
  });

  describe.runIf(reportSchema)("strict aggregate and arithmetic refinements", () => {
  it("accepts the strict fixed-order aggregate and preserves exact values", () => {
    expect(reportSchema!.parse(validReport)).toEqual(validReport);
  });

  it.each([
    ["top-level fields", { ...validReport, generatedAt: "2026-08-03T00:00:00.000Z" }],
    ["raw events", { ...validReport, events: [] }],
    ["session identifiers", { ...validReport, sessionIds: ["session_private"] }],
    ["queue fields", { ...validReport, queue: { ...validReport.queue, raw: [] } }],
    ["session fields", { ...validReport, sessions: { ...validReport.sessions, timestamps: [] } }],
    ["journey fields", { ...validReport, journeys: { ...validReport.journeys, runIds: [] } }],
    ["step fields", {
      ...validReport,
      steps: validReport.steps.map((step, index) =>
        index === 0 ? { ...step, sessionId: "session_private" } : step),
    }],
  ])("rejects extra aggregate-privacy data in %s", (_label, candidate) => {
    expect(reportSchema!.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ["unknown status", { ...validReport.queue, status: "corrupt" }],
    ["negative count", { ...validReport.queue, retainedEventCount: -1 }],
    ["fractional count", { ...validReport.queue, retainedEventCount: 1.5 }],
    ["over-cap count", { ...validReport.queue, retainedEventCount: 501 }],
    ["unavailable retained data", { status: "unavailable", retainedEventCount: 1 }],
  ])("rejects invalid queue arithmetic: %s", (_label, queue) => {
    expect(reportSchema!.safeParse({ ...validReport, queue }).success).toBe(false);
  });

  it.each([
    ["sessions observed != valid + invalid", {
      ...validReport.sessions,
      observed: 2,
    }],
    ["sessions completed > valid", {
      ...validReport.sessions,
      completed: 2,
    }],
    ["sessions failure > valid", {
      ...validReport.sessions,
      consumerFailed: 2,
    }],
    ["sessions resumed > valid", {
      ...validReport.sessions,
      resumed: 2,
    }],
  ])("rejects invalid session arithmetic: %s", (_label, sessions) => {
    expect(reportSchema!.safeParse({ ...validReport, sessions }).success).toBe(false);
  });

  it.each([
    ["journeys observed != valid + invalid", {
      ...validReport.journeys,
      observed: 2,
    }],
    ["journeys completed > valid", {
      ...validReport.journeys,
      completed: 2,
    }],
    ["journeys failure > valid", {
      ...validReport.journeys,
      consumerFailed: 2,
    }],
    ["journeys resumed > valid", {
      ...validReport.journeys,
      resumed: 2,
    }],
  ])("rejects invalid journey arithmetic: %s", (_label, journeys) => {
    expect(reportSchema!.safeParse({ ...validReport, journeys }).success).toBe(false);
  });

  it("requires journey aggregates to cover their session aggregates", () => {
    const candidate = {
      ...validReport,
      sessions: { ...validReport.sessions, observed: 2, valid: 2, completed: 2 },
    };
    expect(reportSchema!.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ["missing row", validReport.steps.slice(1)],
    ["extra row", [...validReport.steps, validReport.steps[0]]],
    ["wrong order", [validReport.steps[1], validReport.steps[0], ...validReport.steps.slice(2)]],
    ["unknown row", validReport.steps.map((step, index) =>
      index === 0 ? { ...step, name: "PAGE_VIEWED" } : step)],
    ["step sessions exceed valid sessions", validReport.steps.map((step, index) =>
      index === 0 ? { ...step, sessions: 2 } : step)],
    ["step journeys exceed valid journeys", validReport.steps.map((step, index) =>
      index === 0 ? { ...step, journeys: 2 } : step)],
    ["step sessions exceed step journeys", validReport.steps.map((step, index) =>
      index === 0 ? { ...step, sessions: 1, journeys: 0 } : step)],
  ])("rejects invalid fixed funnel rows: %s", (_label, steps) => {
    expect(reportSchema!.safeParse({ ...validReport, steps }).success).toBe(false);
  });
  });
});
