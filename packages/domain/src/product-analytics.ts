import {
  ProductEventV1Schema,
  type ProductEventNameV1,
  type ProductEventV1,
} from "@proofline/contracts";

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
}

export interface ProductFunnelV1 {
  version: "1";
  sessions: number;
  completedSessions: number;
  failedSessions: number;
  resumedSessions: number;
  steps: Array<{ name: ProductEventNameV1; sessions: number }>;
}

function parsePersistedEvents(value: string | null): ProductEventV1[] {
  if (value === null) return [];

  try {
    const candidate = JSON.parse(value) as unknown;
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return [];
    }

    const record = candidate as Record<string, unknown>;
    if (
      record.version !== "1" ||
      Object.keys(record).some((key) => key !== "version" && key !== "events") ||
      !Array.isArray(record.events) ||
      record.events.length > MAX_QUEUE_EVENTS
    ) {
      return [];
    }

    const parsed = record.events.map((event) => ProductEventV1Schema.safeParse(event));
    return parsed.every((result) => result.success)
      ? parsed.map((result) => result.data)
      : [];
  } catch {
    return [];
  }
}

export function createLocalProductAnalytics({
  storage,
}: {
  storage: ProductAnalyticsStorage;
}): LocalProductAnalytics {
  let available = true;
  let events: ProductEventV1[] = [];

  try {
    events = parsePersistedEvents(storage.getItem(PRODUCT_ANALYTICS_QUEUE_KEY_V1));
  } catch {
    available = false;
  }

  return {
    emit(event) {
      if (!available) return;

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
        available = false;
        events = [];
      }
    },
    readEvents() {
      return available ? structuredClone(events) : [];
    },
  };
}

export function reduceProductFunnel(
  eventValues: readonly ProductEventV1[],
): ProductFunnelV1 {
  const events = eventValues.map((event) => ProductEventV1Schema.parse(event));
  const sessions = new Map<string, SessionFunnelState>();

  for (const event of events) {
    const state = sessions.get(event.sessionId) ?? {
      invalid: false,
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
      state.reached.add(event.name);
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
      (state) => state.currentStep === CANONICAL_HANDOFF_STEPS.length - 1,
    ).length,
    failedSessions: validSessions.filter((state) => state.consumerFailed).length,
    resumedSessions: validSessions.filter((state) => state.resumed).length,
    steps: FUNNEL_STEPS.map((name) => ({
      name,
      sessions: validSessions.filter((state) => state.reached.has(name)).length,
    })),
  };
}
