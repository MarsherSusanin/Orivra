import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_JOURNEY_STORAGE_KEY,
  startComposerJourneyFromRuns,
  startDirectComposerJourney,
} from "./composer-journey";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
    read: () => value,
  };
}

describe("Composer journey session marker", () => {
  it("stores only the versioned enumerated attribution and suppresses direct continuation", () => {
    const storage = memoryStorage();

    startComposerJourneyFromRuns(storage);

    expect(JSON.parse(storage.read()!)).toEqual({
      version: "1",
      status: "started",
      entryPoint: "runs",
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      COMPOSER_JOURNEY_STORAGE_KEY,
      expect.any(String),
    );
    expect(startDirectComposerJourney(storage)).toBe(false);
  });

  it("replaces corrupt state with a direct marker and starts a new explicit runs journey", () => {
    const storage = memoryStorage('{"version":"1","status":"started","url":"secret"}');

    expect(startDirectComposerJourney(storage)).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith(COMPOSER_JOURNEY_STORAGE_KEY);
    expect(JSON.parse(storage.read()!)).toEqual({
      version: "1",
      status: "started",
      entryPoint: "direct",
    });

    startComposerJourneyFromRuns(storage);
    expect(JSON.parse(storage.read()!)).toEqual({
      version: "1",
      status: "started",
      entryPoint: "runs",
    });
  });

  it("fails open when every storage operation is denied", () => {
    const denied = {
      getItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
      setItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
      removeItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
    };

    expect(startDirectComposerJourney(denied)).toBe(true);
    expect(() => startComposerJourneyFromRuns(denied)).not.toThrow();
  });
});
