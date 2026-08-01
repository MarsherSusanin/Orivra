// @vitest-environment node

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Web2JsonManifestDraftV1 } from "@proofline/contracts";
import { validComposerDraft } from "../../contracts/test/fixtures";
import * as Composer from "../src/manifest-composer";

type DecodeResult =
  | { state: "empty" }
  | { state: "restored"; draft: Web2JsonManifestDraftV1 }
  | {
      state: "rejected";
      reason: "corrupt" | "unsupported-version" | "oversized" | "invalid";
    };

const decode = (Composer as unknown as {
  decodeComposerDraftV1(raw: string | null): DecodeResult;
}).decodeComposerDraftV1;
const serialize = (Composer as unknown as {
  serializeComposerDraftV1(draft: Web2JsonManifestDraftV1): string;
}).serializeComposerDraftV1;

describe("strict Composer draft V1 codec", () => {
  it("round-trips one strict draft without changing its editing identity", () => {
    const draft = structuredClone(validComposerDraft) as Web2JsonManifestDraftV1;
    const serialized = serialize(draft);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      65_536,
    );
    expect(decode(serialized)).toEqual({ state: "restored", draft });
  });

  it("distinguishes missing, corrupt, unsupported, oversized and schema-invalid state", () => {
    expect(decode(null)).toEqual({ state: "empty" });
    expect(decode("{")).toEqual({ state: "rejected", reason: "corrupt" });
    expect(
      decode(JSON.stringify({ ...validComposerDraft, version: "0" })),
    ).toEqual({ state: "rejected", reason: "unsupported-version" });
    expect(decode(`"${"é".repeat(40_000)}"`)).toEqual({
      state: "rejected",
      reason: "oversized",
    });
    expect(decode(JSON.stringify({ ...validComposerDraft, step: "review" }))).toEqual({
      state: "rejected",
      reason: "invalid",
    });
  });

  it("rejects forbidden extension material instead of partially restoring it", () => {
    const raw = JSON.stringify({
      ...validComposerDraft,
      fields: {
        ...validComposerDraft.fields,
        sourceResponse: { token: "must-not-survive" },
      },
    });
    expect(decode(raw)).toEqual({ state: "rejected", reason: "invalid" });
  });

  it("refuses to serialize a schema-invalid draft", () => {
    expect(() => serialize({
      ...validComposerDraft,
      projectToken: `project_${"a".repeat(64)}`,
    } as unknown as Web2JsonManifestDraftV1)).toThrow();
  });

  it("property-round-trips bounded query and Transform text", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 80 }),
        fc.string({ maxLength: 80 }),
        fc.string({ maxLength: 200 }),
        (queryKeyText, queryValue, jqText) => {
          const queryKey = queryKeyText
            .replace(/[^A-Za-z0-9_-]/g, "_")
            .slice(0, 64) || "key";
          const draft = structuredClone(validComposerDraft) as Web2JsonManifestDraftV1;
          draft.fields.queryRows = [
            { id: "property-row", key: queryKey, value: queryValue },
          ];
          draft.fields.jq = jqText;

          const serialized = serialize(draft);
          expect(decode(serialized)).toEqual({ state: "restored", draft });
        },
      ),
      { numRuns: 80 },
    );
  });
});
