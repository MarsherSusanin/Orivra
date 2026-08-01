// @vitest-environment node

import { ProductEventV1Schema } from "@proofline/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_ANALYTICS_QUEUE_KEY_V1,
  createLocalProductAnalytics,
} from "../src/product-analytics";

const resumed = ProductEventV1Schema.parse({
  version: "1",
  sessionId: "session_88888888-8888-4888-8888-888888888888",
  occurredAt: "2026-08-02T02:00:00.000Z",
  name: "RUN_RESUMED",
  metadata: { priorStatus: "active" },
});

describe("local product analytics defensive storage", () => {
  it("restores a valid versioned queue", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ version: "1", events: [resumed] })),
      setItem: vi.fn(),
    };

    expect(createLocalProductAnalytics({ storage }).readEvents()).toEqual([resumed]);
  });

  it("treats non-object JSON as corrupt state", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify(null)),
      setItem: vi.fn(),
    };

    expect(createLocalProductAnalytics({ storage }).readEvents()).toEqual([]);
  });

  it("disables collection if a storage write is denied", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    };
    const analytics = createLocalProductAnalytics({ storage });

    expect(() => analytics.emit(resumed)).not.toThrow();
    expect(analytics.readEvents()).toEqual([]);
    expect(storage.setItem).toHaveBeenCalledWith(
      PRODUCT_ANALYTICS_QUEUE_KEY_V1,
      expect.any(String),
    );
  });

  it("drops invalid event payloads without touching storage", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const analytics = createLocalProductAnalytics({ storage });

    analytics.emit({ ...resumed, token: "project_secret" } as never);

    expect(analytics.readEvents()).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
