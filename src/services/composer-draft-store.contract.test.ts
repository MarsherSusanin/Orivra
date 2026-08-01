import { describe, expect, it, vi } from "vitest";
import {
  Web2JsonManifestDraftV1Schema,
  type Web2JsonManifestDraftV1,
} from "../../packages/contracts/src";
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

type TrustStringField = "expectedHost" | "expectedPathPrefix";

const TRUST_STRING_FIELDS = {
  expectedHost: {
    ordinary: "api.example.com",
    embed: (value: string) => `${value}.example`,
  },
  expectedPathPrefix: {
    ordinary: "/prices/eth",
    embed: (value: string) => `/public/${value}`,
  },
} satisfies Record<
  TrustStringField,
  { ordinary: string; embed(value: string): string }
>;

const RECOGNIZED_PRIVATE_MATERIAL = [
  ["project token", `project_${"a".repeat(64)}`],
  ["share token", `share_${"b".repeat(64)}`],
  ["Bearer credential", "bearer super-secret-credential"],
  ["private key", `0x${"c".repeat(64)}`],
] as const;

function draftWithTrustString(
  field: TrustStringField,
  value: string,
): Web2JsonManifestDraftV1 {
  return {
    ...structuredClone(validComposerDraft),
    fields: {
      ...structuredClone(validComposerDraft.fields),
      [field]: value,
    },
  } as unknown as Web2JsonManifestDraftV1;
}

function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function draftWithExactSerializedBytes(targetBytes: number) {
  const draft = {
    ...structuredClone(validComposerDraft),
    fields: {
      ...structuredClone(validComposerDraft.fields),
      queryRows: Array.from({ length: 32 }, (_, index) => ({
        id: `bounded-row-${index}`,
        key: `field-${index}`,
        value: "",
      })),
    },
  };
  let remaining = targetBytes - serializedUtf8Bytes(draft);
  expect(remaining).toBeGreaterThanOrEqual(0);
  for (const row of draft.fields.queryRows) {
    const fill = Math.min(2_048, remaining);
    row.value = "x".repeat(fill);
    remaining -= fill;
  }
  expect(remaining).toBe(0);
  expect(serializedUtf8Bytes(draft)).toBe(targetBytes);
  return draft;
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

  it.each(
    (Object.keys(TRUST_STRING_FIELDS) as TrustStringField[]).flatMap((field) =>
      RECOGNIZED_PRIVATE_MATERIAL.map(([label, material]) => [
        field,
        label,
        TRUST_STRING_FIELDS[field].embed(material),
      ] as const),
    ),
  )("refuses %s containing recognized %s material on save", (field, _label, value) => {
    const draft = draftWithTrustString(field, value);
    expect(
      Web2JsonManifestDraftV1Schema.safeParse(draft).success,
      "The fixture must remain field-schema-valid so the draft-store privacy boundary is exercised",
    ).toBe(true);
    const memory = memoryStorage();

    expect(createComposerDraftStore(memory.storage).save(draft)).toEqual({
      state: "rejected",
      reason: "sensitive-data",
    });
    expect(memory.storage.setItem).not.toHaveBeenCalled();
    expect(memory.values.size).toBe(0);
  });

  it.each(
    (Object.keys(TRUST_STRING_FIELDS) as TrustStringField[]).flatMap((field) =>
      RECOGNIZED_PRIVATE_MATERIAL.map(([label, material]) => [
        field,
        label,
        TRUST_STRING_FIELDS[field].embed(material),
      ] as const),
    ),
  )("purges %s containing recognized %s material on load", (field, _label, value) => {
    const draft = draftWithTrustString(field, value);
    expect(Web2JsonManifestDraftV1Schema.safeParse(draft).success).toBe(true);
    const memory = memoryStorage(JSON.stringify(draft));

    expect(createComposerDraftStore(memory.storage).load()).toMatchObject({
      state: "rejected",
    });
    expect(memory.values.has(COMPOSER_DRAFT_STORAGE_KEY_V1)).toBe(false);
    expect(memory.storage.removeItem).toHaveBeenCalledWith(
      COMPOSER_DRAFT_STORAGE_KEY_V1,
    );
  });

  it("does not reject ordinary values in every persisted Trust string field", () => {
    const draft = structuredClone(
      validComposerDraft,
    ) as unknown as Web2JsonManifestDraftV1;
    for (const field of Object.keys(TRUST_STRING_FIELDS) as TrustStringField[]) {
      draft.fields[field] = TRUST_STRING_FIELDS[field].ordinary;
    }
    const memory = memoryStorage();
    const store = createComposerDraftStore(memory.storage);

    expect(store.save(draft)).toEqual({ state: "stored" });
    expect(store.load()).toEqual({ state: "restored", draft });
  });

  it("classifies aggregate UTF-8 overflow before schema serialization at the exact boundary", () => {
    const boundary = draftWithExactSerializedBytes(65_536);
    const oversized = draftWithExactSerializedBytes(65_537);
    expect(Web2JsonManifestDraftV1Schema.safeParse(boundary).success).toBe(true);
    expect(Web2JsonManifestDraftV1Schema.safeParse(oversized).success).toBe(false);

    const boundaryMemory = memoryStorage();
    expect(createComposerDraftStore(boundaryMemory.storage).save(boundary)).toEqual({
      state: "stored",
    });
    expect(
      new TextEncoder().encode(
        boundaryMemory.values.get(COMPOSER_DRAFT_STORAGE_KEY_V1),
      ).byteLength,
    ).toBe(65_536);

    const oversizedMemory = memoryStorage();
    expect(createComposerDraftStore(oversizedMemory.storage).save(oversized)).toEqual({
      state: "rejected",
      reason: "oversized",
    });
    expect(oversizedMemory.storage.setItem).not.toHaveBeenCalled();
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
