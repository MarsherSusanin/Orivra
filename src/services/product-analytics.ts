import {
  ProductAnalyticsSessionIdV1Schema,
  type ProductEventV1,
} from "@proofline/contracts";
import {
  createLocalProductAnalytics,
  type ProductAnalyticsPort,
} from "../../packages/domain/src/product-analytics";

const ANALYTICS_SESSION_KEY = "proofline:analytics-session";

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionCrypto = Pick<Crypto, "randomUUID">;

export { createLocalProductAnalytics };
export type { ProductAnalyticsPort };

export type ProductEventInputV1 = ProductEventV1 extends infer TEvent
  ? TEvent extends ProductEventV1
    ? Pick<TEvent, "name" | "metadata">
    : never
  : never;

export function getOrCreateAnalyticsSessionId({
  storage,
  crypto,
}: {
  storage: SessionStorage | undefined;
  crypto: SessionCrypto | undefined;
}): string | null {
  try {
    const stored = storage?.getItem(ANALYTICS_SESSION_KEY);
    const parsed = ProductAnalyticsSessionIdV1Schema.safeParse(stored);
    if (parsed.success) return parsed.data;
    if (stored !== null && stored !== undefined) {
      storage?.removeItem(ANALYTICS_SESSION_KEY);
    }

    if (!crypto?.randomUUID) return null;
    const created = ProductAnalyticsSessionIdV1Schema.parse(
      `session_${crypto.randomUUID()}`,
    );
    storage?.setItem(ANALYTICS_SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export function createProductEventEmitter({
  analytics,
  storage,
  crypto,
  now = () => new Date().toISOString(),
}: {
  analytics: ProductAnalyticsPort;
  storage: SessionStorage | undefined;
  crypto: SessionCrypto | undefined;
  now?: () => string;
}) {
  let sessionId: string | null | undefined;

  return (event: ProductEventInputV1): void => {
    try {
      sessionId ??= getOrCreateAnalyticsSessionId({ storage, crypto });
      if (!sessionId) return;
      analytics.emit({
        version: "1",
        sessionId,
        occurredAt: now(),
        ...event,
      } as ProductEventV1);
    } catch {
      // Product analytics is deliberately fail-open for the primary journey.
    }
  };
}
