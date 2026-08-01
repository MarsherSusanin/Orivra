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
  const sessions = new Set(events.map((event) => event.sessionId));

  const sessionsFor = (name: ProductEventNameV1) =>
    new Set(
      events
        .filter((event) => event.name === name)
        .map((event) => event.sessionId),
    );

  return {
    version: "1",
    sessions: sessions.size,
    completedSessions: sessionsFor("BUNDLE_REPLAYED").size,
    failedSessions: sessionsFor("CONSUMER_VERIFICATION_FAILED").size,
    resumedSessions: sessionsFor("RUN_RESUMED").size,
    steps: FUNNEL_STEPS.map((name) => ({
      name,
      sessions: sessionsFor(name).size,
    })),
  };
}
