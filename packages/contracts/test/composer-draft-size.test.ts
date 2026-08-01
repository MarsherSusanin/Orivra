// @vitest-environment node

import { describe, expect, it } from "vitest";
import { Web2JsonManifestDraftV1Schema } from "../src/index";
import { validComposerDraft } from "./fixtures";

const MAX_DRAFT_UTF8_BYTES = 65_536;

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function exactBoundaryDraft() {
  const draft = {
    ...validComposerDraft,
    fields: {
      ...validComposerDraft.fields,
      queryRows: Array.from({ length: 50 }, (_, index) => ({
        id: `boundary_${index}`,
        key: `key_${index}`,
        value: "",
      })),
    },
  };

  let remaining = MAX_DRAFT_UTF8_BYTES - serializedBytes(draft);
  for (const row of draft.fields.queryRows) {
    const added = Math.min(2_048, remaining);
    row.value = "a".repeat(added);
    remaining -= added;
  }
  if (remaining !== 0) throw new Error("Could not construct exact boundary draft");
  return draft;
}

describe("Composer draft aggregate byte boundary", () => {
  it("accepts exactly 65536 bytes and rejects the next byte", () => {
    const exact = exactBoundaryDraft();
    expect(serializedBytes(exact)).toBe(MAX_DRAFT_UTF8_BYTES);
    expect(Web2JsonManifestDraftV1Schema.safeParse(exact).success).toBe(true);

    const over = structuredClone(exact);
    const row = over.fields.queryRows.find(({ value }) => value.length < 2_048)!;
    row.value += "a";
    expect(serializedBytes(over)).toBe(MAX_DRAFT_UTF8_BYTES + 1);
    expect(Web2JsonManifestDraftV1Schema.safeParse(over).success).toBe(false);
  });
});
