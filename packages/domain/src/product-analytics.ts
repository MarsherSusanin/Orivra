import {
  ProductEventV1Schema,
  ProductQaReportV1Schema,
  type ProductEventNameV1,
  type ProductEventV1,
  type ProductQaReportV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";

export const PRODUCT_ANALYTICS_QUEUE_KEY_V1 = "proofline:product-analytics:v1";

const MAX_QUEUE_EVENTS = 500;

const FUNNEL_STEPS: readonly ProductEventNameV1[] = [
  "COMPOSER_STARTED",
  "MANIFEST_VALIDATED",
  "PREFLIGHT_COMPLETED",
  "SUBMISSION_REQUESTED",
  "PROOF_AVAILABLE",
  "CONSUMER_VERIFICATION_FAILED",
  "SAFE_CODEGEN_GENERATED",
  "BUNDLE_REPLAYED",
  "RUN_RESUMED",
];

const CANONICAL_HANDOFF_STEPS: readonly ProductEventNameV1[] = [
  "COMPOSER_STARTED",
  "MANIFEST_VALIDATED",
  "PREFLIGHT_COMPLETED",
  "SUBMISSION_REQUESTED",
  "PROOF_AVAILABLE",
  "SAFE_CODEGEN_GENERATED",
  "BUNDLE_REPLAYED",
];

type SessionFunnelState = {
  invalid: boolean;
  halted: boolean;
  lastOccurredAt: number;
  currentStep: number;
  reached: Set<ProductEventNameV1>;
  consumerFailed: boolean;
  resumed: boolean;
};

interface ProductAnalyticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProductAnalyticsPort {
  emit(event: ProductEventV1): void;
}

export interface LocalProductAnalytics extends ProductAnalyticsPort {
  readEvents(): ProductEventV1[];
  exportQaReport(): string;
}

export interface ProductFunnelV1 {
  version: "1";
  sessions: number;
  completedSessions: number;
  failedSessions: number;
  resumedSessions: number;
  steps: Array<{ name: ProductEventNameV1; sessions: number }>;
}

type ProductQaQueueStatus = ProductQaReportV1["queue"]["status"];

function parsePersistedEvents(value: string | null): {
  events: ProductEventV1[];
  recovered: boolean;
} {
  if (value === null) return { events: [], recovered: false };

  try {
    const candidate = JSON.parse(value) as unknown;
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return { events: [], recovered: true };
    }

    const record = candidate as Record<string, unknown>;
    if (
      record.version !== "1" ||
      Object.keys(record).some((key) => key !== "version" && key !== "events") ||
      !Array.isArray(record.events) ||
      record.events.length > MAX_QUEUE_EVENTS
    ) {
      return { events: [], recovered: true };
    }

    const parsed = record.events.map((event) => ProductEventV1Schema.safeParse(event));
    return parsed.every((result) => result.success)
      ? { events: parsed.map((result) => result.data), recovered: false }
      : { events: [], recovered: true };
  } catch {
    return { events: [], recovered: true };
  }
}

export function createLocalProductAnalytics({
  storage,
}: {
  storage: ProductAnalyticsStorage;
}): LocalProductAnalytics {
  let queueStatus: ProductQaQueueStatus = "healthy";
  let events: ProductEventV1[] = [];

  try {
    const restored = parsePersistedEvents(
      storage.getItem(PRODUCT_ANALYTICS_QUEUE_KEY_V1),
    );
    events = restored.events;
    if (restored.recovered) queueStatus = "recovered";
  } catch {
    queueStatus = "unavailable";
  }

  return {
    emit(event) {
      if (queueStatus === "unavailable") return;

      const parsed = ProductEventV1Schema.safeParse(event);
      if (!parsed.success) return;

      const nextEvents = [...events, parsed.data].slice(-MAX_QUEUE_EVENTS);
      try {
        storage.setItem(
          PRODUCT_ANALYTICS_QUEUE_KEY_V1,
          JSON.stringify({ version: "1", events: nextEvents }),
        );
        events = nextEvents;
      } catch {
        queueStatus = "unavailable";
        events = [];
      }
    },
    readEvents() {
      return queueStatus === "unavailable" ? [] : structuredClone(events);
    },
    exportQaReport() {
      return canonicalSerializeProductQaReport(
        reduceProductQaReport(events, queueStatus),
      );
    },
  };
}

type QaJourneyState = {
  currentStep: number;
  completed: boolean;
  consumerFailed: boolean;
  resumed: boolean;
  reached: Set<ProductEventNameV1>;
};

type QaSessionState = {
  invalid: boolean;
  lastOccurredAt: number;
  journeys: QaJourneyState[];
};

function createQaJourney(): QaJourneyState {
  return {
    currentStep: -1,
    completed: false,
    consumerFailed: false,
    resumed: false,
    reached: new Set<ProductEventNameV1>(),
  };
}

function acceptedProductOutcome(event: ProductEventV1): boolean {
  if (event.name === "MANIFEST_VALIDATED" || event.name === "PREFLIGHT_COMPLETED") {
    return event.metadata.outcome === "accepted";
  }
  if (event.name === "BUNDLE_REPLAYED") {
    return event.metadata.outcome === "byte-identical";
  }
  return true;
}

function emptyCounter(): ProductQaReportV1["sessions"] {
  return {
    observed: 0,
    valid: 0,
    invalid: 0,
    completed: 0,
    consumerFailed: 0,
    resumed: 0,
  };
}

export function reduceProductQaReport(
  eventValues: readonly ProductEventV1[],
  queueStatus: ProductQaQueueStatus = "healthy",
): ProductQaReportV1 {
  const events = queueStatus === "unavailable"
    ? []
    : eventValues.map((event) => ProductEventV1Schema.parse(event));
  const sessions = new Map<string, QaSessionState>();

  for (const event of events) {
    const state = sessions.get(event.sessionId) ?? {
      invalid: false,
      lastOccurredAt: Number.NEGATIVE_INFINITY,
      journeys: [createQaJourney()],
    };
    sessions.set(event.sessionId, state);

    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt < state.lastOccurredAt) state.invalid = true;
    state.lastOccurredAt = Math.max(state.lastOccurredAt, occurredAt);
    if (state.invalid) continue;

    let journey = state.journeys.at(-1)!;

    if (event.name === "RUN_RESUMED") {
      journey.resumed = true;
      journey.reached.add(event.name);
      continue;
    }

    if (event.name === "CONSUMER_VERIFICATION_FAILED") {
      if (journey.currentStep < 4) {
        state.invalid = true;
      } else {
        journey.consumerFailed = true;
        journey.reached.add(event.name);
      }
      continue;
    }

    if (event.name === "COMPOSER_STARTED") {
      if (journey.completed) {
        journey = createQaJourney();
        state.journeys.push(journey);
      } else if (journey.currentStep > 0) {
        state.invalid = true;
        continue;
      }
      journey.currentStep = 0;
      journey.reached.add(event.name);
      continue;
    }

    const step = CANONICAL_HANDOFF_STEPS.indexOf(event.name);
    if (step === journey.currentStep) continue;
    if (step !== journey.currentStep + 1) {
      state.invalid = true;
      continue;
    }
    if (!acceptedProductOutcome(event)) continue;

    journey.currentStep = step;
    journey.reached.add(event.name);
    if (event.name === "BUNDLE_REPLAYED") journey.completed = true;
  }

  const sessionValues = [...sessions.values()];
  const validSessions = sessionValues.filter((session) => !session.invalid);
  const validJourneys = validSessions.flatMap((session) => session.journeys);
  const invalidJourneyCount = sessionValues
    .filter((session) => session.invalid)
    .reduce((count, session) => count + session.journeys.length, 0);

  const sessionCounters = emptyCounter();
  sessionCounters.observed = sessionValues.length;
  sessionCounters.valid = validSessions.length;
  sessionCounters.invalid = sessionValues.length - validSessions.length;
  sessionCounters.completed = validSessions.filter((session) =>
    session.journeys.some((journey) => journey.completed)).length;
  sessionCounters.consumerFailed = validSessions.filter((session) =>
    session.journeys.some((journey) => journey.consumerFailed)).length;
  sessionCounters.resumed = validSessions.filter((session) =>
    session.journeys.some((journey) => journey.resumed)).length;

  const journeyCounters = emptyCounter();
  journeyCounters.observed = validJourneys.length + invalidJourneyCount;
  journeyCounters.valid = validJourneys.length;
  journeyCounters.invalid = invalidJourneyCount;
  journeyCounters.completed = validJourneys.filter((journey) => journey.completed).length;
  journeyCounters.consumerFailed = validJourneys.filter(
    (journey) => journey.consumerFailed,
  ).length;
  journeyCounters.resumed = validJourneys.filter((journey) => journey.resumed).length;

  return ProductQaReportV1Schema.parse({
    version: "1",
    queue: {
      status: queueStatus,
      retainedEventCount: events.length,
    },
    sessions: sessionCounters,
    journeys: journeyCounters,
    steps: FUNNEL_STEPS.map((name) => ({
      name,
      sessions: validSessions.filter((session) =>
        session.journeys.some((journey) => journey.reached.has(name))).length,
      journeys: validJourneys.filter((journey) => journey.reached.has(name)).length,
    })),
  });
}

export function canonicalSerializeProductQaReport(
  reportValue: ProductQaReportV1,
): string {
  return canonicalJson(ProductQaReportV1Schema.parse(reportValue));
}

export function reduceProductFunnel(
  eventValues: readonly ProductEventV1[],
): ProductFunnelV1 {
  const events = eventValues.map((event) => ProductEventV1Schema.parse(event));
  const sessions = new Map<string, SessionFunnelState>();

  for (const event of events) {
    const state = sessions.get(event.sessionId) ?? {
      invalid: false,
      halted: false,
      lastOccurredAt: Number.NEGATIVE_INFINITY,
      currentStep: -1,
      reached: new Set<ProductEventNameV1>(),
      consumerFailed: false,
      resumed: false,
    };
    sessions.set(event.sessionId, state);

    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt < state.lastOccurredAt) state.invalid = true;
    state.lastOccurredAt = Math.max(state.lastOccurredAt, occurredAt);

    if (state.halted) continue;

    if (event.name === "RUN_RESUMED") {
      state.resumed = true;
      state.reached.add(event.name);
      continue;
    }

    if (event.name === "CONSUMER_VERIFICATION_FAILED") {
      if (state.currentStep !== 4) state.invalid = true;
      state.consumerFailed = true;
      state.reached.add(event.name);
      continue;
    }

    const step = CANONICAL_HANDOFF_STEPS.indexOf(event.name);
    if (step === state.currentStep + 1) {
      state.currentStep = step;
      const successfulOutcome =
        (event.name !== "MANIFEST_VALIDATED" || event.metadata.outcome === "accepted") &&
        (event.name !== "PREFLIGHT_COMPLETED" || event.metadata.outcome === "accepted") &&
        (event.name !== "BUNDLE_REPLAYED" || event.metadata.outcome === "byte-identical");
      if (event.name !== "BUNDLE_REPLAYED" || successfulOutcome) {
        state.reached.add(event.name);
      }
      if (!successfulOutcome) state.halted = true;
    } else if (step !== state.currentStep) {
      state.invalid = true;
    }
  }

  const validSessions = Array.from(sessions.values()).filter(
    (state) => !state.invalid,
  );

  return {
    version: "1",
    sessions: sessions.size,
    completedSessions: validSessions.filter(
      (state) =>
        !state.halted &&
        state.currentStep === CANONICAL_HANDOFF_STEPS.length - 1,
    ).length,
    failedSessions: validSessions.filter((state) => state.consumerFailed).length,
    resumedSessions: validSessions.filter((state) => state.resumed).length,
    steps: FUNNEL_STEPS.map((name) => ({
      name,
      sessions: validSessions.filter((state) => state.reached.has(name)).length,
    })),
  };
}
