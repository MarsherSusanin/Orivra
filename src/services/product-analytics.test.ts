import { describe, expect, it, vi } from "vitest";
import { getOrCreateAnalyticsSessionId } from "./product-analytics";

const sessionId = "session_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
  };
}

describe("Web analytics session adapter", () => {
  it("reuses a valid session and replaces invalid persisted material", () => {
    const existing = storage(sessionId);
    expect(getOrCreateAnalyticsSessionId({
      storage: existing,
      crypto: { randomUUID: vi.fn() },
    })).toBe(sessionId);
    expect(existing.removeItem).not.toHaveBeenCalled();

    const invalid = storage("project_secret");
    expect(getOrCreateAnalyticsSessionId({
      storage: invalid,
      crypto: { randomUUID: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    })).toBe("session_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(invalid.removeItem).toHaveBeenCalledOnce();
  });

  it("generates without storage and fails closed without secure randomness", () => {
    expect(getOrCreateAnalyticsSessionId({
      storage: undefined,
      crypto: { randomUUID: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    })).toBe("session_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(getOrCreateAnalyticsSessionId({ storage: undefined, crypto: undefined })).toBeNull();
  });

  it("fails closed when storage or generated values are invalid", () => {
    expect(getOrCreateAnalyticsSessionId({
      storage: {
        getItem: () => { throw new DOMException("denied", "SecurityError"); },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      crypto: { randomUUID: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    })).toBeNull();
    expect(getOrCreateAnalyticsSessionId({
      storage: storage(),
      crypto: { randomUUID: () => "bad-bad-bad-bad-bad" },
    })).toBeNull();
  });
});
