import { describe, expect, it, vi } from "vitest";
import type { Web2JsonManifestDraftV1 } from "../../packages/contracts/src";
import { validComposerDraft } from "../../packages/contracts/test/fixtures";
import {
  COMPOSER_DRAFT_STORAGE_KEY_V1,
  createComposerDraftStore,
} from "./composer-draft-store";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(COMPOSER_DRAFT_STORAGE_KEY_V1, initial);
  }
  return {
    values,
    storage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    },
  };
}

function draftWithQuery(key: string, value: string): Web2JsonManifestDraftV1 {
  return {
    ...structuredClone(validComposerDraft),
    fields: {
      ...structuredClone(validComposerDraft.fields),
      queryRows: [{ id: "sensitive-row", key, value }],
    },
  } as unknown as Web2JsonManifestDraftV1;
}

describe("bounded local Composer draft store", () => {
  it("uses one namespaced V1 key and restores exact valid bytes", () => {
    expect(COMPOSER_DRAFT_STORAGE_KEY_V1).toBe("proofline:composer-draft:v1");
    const memory = memoryStorage();
    const store = createComposerDraftStore(memory.storage);

    expect(store.save(validComposerDraft)).toEqual({ state: "stored" });
    expect(memory.storage.setItem).toHaveBeenCalledOnce();
    const [key, bytes] = memory.storage.setItem.mock.calls[0];
    expect(key).toBe(COMPOSER_DRAFT_STORAGE_KEY_V1);
    expect(new TextEncoder().encode(bytes).byteLength).toBeLessThanOrEqual(65_536);
    expect(store.load()).toEqual({
      state: "restored",
      draft: validComposerDraft,
    });
  });

  it.each([
    ["corrupt JSON", "{", "corrupt"],
    ["unsupported version", JSON.stringify({ ...validComposerDraft, version: "0" }), "unsupported-version"],
    ["schema-invalid value", JSON.stringify({ ...validComposerDraft, step: "review" }), "invalid"],
    ["oversized UTF-8", `"${"é".repeat(40_000)}"`, "oversized"],
  ])("rejects and removes %s atomically", (_label, raw, reason) => {
    const memory = memoryStorage(raw);
    const result = createComposerDraftStore(memory.storage).load();
    expect(result).toEqual({ state: "rejected", reason });
    expect(memory.values.has(COMPOSER_DRAFT_STORAGE_KEY_V1)).toBe(false);
    expect(memory.storage.removeItem).toHaveBeenCalledWith(
      COMPOSER_DRAFT_STORAGE_KEY_V1,
    );
  });

  it.each([
    ["Proofline project token", "project", `project_${"a".repeat(64)}`],
    ["Proofline share token", "project", `share_${"b".repeat(64)}`],
    ["Bearer credential", "project", "Bearer super-secret-credential"],
    ["private key shape", "project", `0x${"c".repeat(64)}`],
    ["authorization query key", "Authorization", "credential"],
    ["API key query key", "api_key", "credential"],
    ["token query key", "access-token", "credential"],
    ["password query key", "password", "credential"],
    ["private-key query key", "private_key", "credential"],
  ])("refuses recognized %s material", (_label, key, value) => {
    const memory = memoryStorage();
    const result = createComposerDraftStore(memory.storage).save(
      draftWithQuery(key, value),
    );
    expect(result).toEqual({ state: "rejected", reason: "sensitive-data" });
    expect(memory.storage.setItem).not.toHaveBeenCalled();
    expect(memory.values.size).toBe(0);
  });

  it("refuses URL credentials and forbidden response/error extension fields", () => {
    const memory = memoryStorage();
    const store = createComposerDraftStore(memory.storage);
    expect(store.save({
      ...validComposerDraft,
      fields: {
        ...validComposerDraft.fields,
        sourceUrl: "https://user:password@api.example.com/public",
      },
    } as unknown as Web2JsonManifestDraftV1)).toEqual({
      state: "rejected",
      reason: "sensitive-data",
    });
    expect(store.save({
      ...validComposerDraft,
      sourceResponse: { body: "private" },
      errorStack: "private stack",
    } as unknown as Web2JsonManifestDraftV1)).toEqual({
      state: "rejected",
      reason: "invalid",
    });
    expect(memory.storage.setItem).not.toHaveBeenCalled();
  });

  it("clears only the Composer key for an explicit fresh start", () => {
    const memory = memoryStorage(JSON.stringify(validComposerDraft));
    memory.values.set("proofline:project-token", "unrelated");
    const store = createComposerDraftStore(memory.storage);
    expect(store.clear()).toEqual({ state: "cleared" });
    expect(memory.values.has(COMPOSER_DRAFT_STORAGE_KEY_V1)).toBe(false);
    expect(memory.values.get("proofline:project-token")).toBe("unrelated");
  });

  it("fails open when get, set or remove is denied", () => {
    const denied = {
      getItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("quota", "QuotaExceededError");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    };
    const store = createComposerDraftStore(denied);
    expect(store.load()).toEqual({ state: "unavailable" });
    expect(store.save(validComposerDraft)).toEqual({ state: "unavailable" });
    expect(store.clear()).toEqual({ state: "unavailable" });
  });
});
