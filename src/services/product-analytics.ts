import { ProductAnalyticsSessionIdV1Schema } from "@proofline/contracts";
import {
  createLocalProductAnalytics,
  type ProductAnalyticsPort,
} from "../../packages/domain/src/product-analytics";

const ANALYTICS_SESSION_KEY = "proofline:analytics-session";

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionCrypto = Pick<Crypto, "randomUUID">;

export { createLocalProductAnalytics };
export type { ProductAnalyticsPort };

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
