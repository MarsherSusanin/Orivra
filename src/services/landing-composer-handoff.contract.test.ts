import { describe, expect, it, vi } from "vitest";
import {
  LANDING_COMPOSER_HANDOFF_STORAGE_KEY_V1,
  consumeLandingComposerHandoff,
  createLandingComposerDraft,
  previewLandingSourceUrl,
  stageLandingComposerHandoff,
} from "./landing-composer-handoff";

const id = "composer_11111111-1111-4111-8111-111111111111";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

describe("Slice 027E landing Composer handoff", () => {
  it("derives an exact local trust preview and strict source-step draft", () => {
    const sourceUrl = "https://API.Example.org/prices/eth?currency=USD&source=primary";
    expect(previewLandingSourceUrl(sourceUrl)).toEqual({
      valid: true,
      trust: {
        expectedScheme: "https",
        expectedHost: "api.example.org",
        expectedPathPrefix: "/prices/eth",
        expectedQueryRows: [
          { id: "expected-query-0", key: "currency", value: "USD" },
          { id: "expected-query-1", key: "source", value: "primary" },
        ],
      },
    });

    expect(createLandingComposerDraft({
      sourceUrl,
      updatedAt: "2026-08-11T12:00:00.000Z",
      createIdempotencyKey: id,
    })).toEqual({
      valid: true,
      draft: {
        version: "1",
        step: "source",
        updatedAt: "2026-08-11T12:00:00.000Z",
        createIdempotencyKey: id,
        fields: {
          sourceUrl,
          queryRows: [],
          jq: "",
          abiSignature: "",
          expectedScheme: "https",
          expectedHost: "api.example.org",
          expectedPathPrefix: "/prices/eth",
          expectedQueryRows: [
            { id: "expected-query-0", key: "currency", value: "USD" },
            { id: "expected-query-1", key: "source", value: "primary" },
          ],
          submissionMode: "replay",
          feeCapWei: "",
        },
      },
    });
  });

  it.each([
    "not a URL",
    "http://api.example.org/data",
    "https://api.example.org:8443/data",
    "https://user:secret@api.example.org/data",
    "https://api.example.org/data#fragment",
    "https://api.example.org/data?api_key=secret",
    "https://api.example.org/data?token=project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "https://api.example.org/data?currency=USD&currency=EUR",
  ])("rejects unsafe public input without a partial preview: %s", (sourceUrl) => {
    expect(previewLandingSourceUrl(sourceUrl).valid).toBe(false);
    expect(createLandingComposerDraft({
      sourceUrl,
      updatedAt: "2026-08-11T12:00:00.000Z",
      createIdempotencyKey: id,
    }).valid).toBe(false);
  });

  it("stages and consumes once while rejecting a corrupt envelope", () => {
    const storage = memoryStorage();
    const result = createLandingComposerDraft({
      sourceUrl: "https://api.example.org/data",
      updatedAt: "2026-08-11T12:00:00.000Z",
      createIdempotencyKey: id,
    });
    if (!result.valid) throw new Error("fixture rejected");

    expect(stageLandingComposerHandoff(storage, result.draft)).toEqual({ state: "stored" });
    expect(storage.setItem).toHaveBeenCalledWith(
      LANDING_COMPOSER_HANDOFF_STORAGE_KEY_V1,
      expect.stringContaining("https://api.example.org/data"),
    );
    expect(consumeLandingComposerHandoff(storage)).toEqual({ state: "restored", draft: result.draft });
    expect(consumeLandingComposerHandoff(storage)).toEqual({ state: "empty" });

    storage.setItem(LANDING_COMPOSER_HANDOFF_STORAGE_KEY_V1, '{"version":"2"}');
    expect(consumeLandingComposerHandoff(storage)).toEqual({ state: "rejected" });
  });
});
