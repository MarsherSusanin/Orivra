// @vitest-environment node

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ComposerStepV1Schema,
  Web2JsonManifestDraftV1Schema,
} from "../src/index";
import { validComposerDraft, validManifest } from "./fixtures";

describe("Web2JsonManifestDraftV1Schema", () => {
  it("accepts one strict, incomplete and bounded local editing envelope", () => {
    const incomplete = {
      ...validComposerDraft,
      fields: {
        ...validComposerDraft.fields,
        sourceUrl: "",
        queryRows: [{ id: "new_query", key: "", value: "" }],
        jq: "",
        abiSignature: "",
        expectedHost: "",
        expectedPathPrefix: "",
        expectedQueryRows: [],
        feeCapWei: "",
      },
    };

    expect(Web2JsonManifestDraftV1Schema.parse(incomplete)).toEqual(incomplete);
    expect(ComposerStepV1Schema.options).toEqual([
      "source",
      "transform",
      "trust",
      "submit",
    ]);
  });

  it("carries every final manifest editing value without changing the final public schema", () => {
    const draft = Web2JsonManifestDraftV1Schema.parse(validComposerDraft);

    expect(draft.fields).toMatchObject({
      sourceUrl: validManifest.request.url,
      jq: validManifest.request.jq,
      abiSignature: validManifest.request.abiSignature,
      expectedScheme: validManifest.consumer.expectedScheme,
      expectedHost: validManifest.consumer.expectedHost,
      expectedPathPrefix: validManifest.consumer.expectedPathPrefix,
      submissionMode: validManifest.submission.mode,
      feeCapWei: validManifest.submission.feeCapWei,
    });
  });

  it.each([
    ["old versions", { ...validComposerDraft, version: "0" }],
    ["future versions", { ...validComposerDraft, version: "2" }],
    ["unknown steps", { ...validComposerDraft, step: "review" }],
    ["corrupt non-object values", "not-a-draft"],
    ["corrupt null values", null],
    ["extra envelope fields", { ...validComposerDraft, token: `project_${"a".repeat(64)}` }],
    [
      "extra editing fields",
      {
        ...validComposerDraft,
        fields: { ...validComposerDraft.fields, headers: { Authorization: "secret" } },
      },
    ],
    [
      "URL credentials",
      {
        ...validComposerDraft,
        fields: {
          ...validComposerDraft.fields,
          sourceUrl: "https://user:secret@api.example.com/prices/eth",
        },
      },
    ],
    [
      "non-normalized expected hosts",
      {
        ...validComposerDraft,
        fields: { ...validComposerDraft.fields, expectedHost: "API.Example.com" },
      },
    ],
    [
      "path prefixes without a leading slash",
      {
        ...validComposerDraft,
        fields: { ...validComposerDraft.fields, expectedPathPrefix: "prices/eth" },
      },
    ],
    [
      "non-canonical fee caps",
      {
        ...validComposerDraft,
        fields: { ...validComposerDraft.fields, feeCapWei: "01" },
      },
    ],
    [
      "overlong source URLs",
      {
        ...validComposerDraft,
        fields: { ...validComposerDraft.fields, sourceUrl: "x".repeat(2_049) },
      },
    ],
    [
      "too many query rows",
      {
        ...validComposerDraft,
        fields: {
          ...validComposerDraft.fields,
          queryRows: Array.from({ length: 51 }, (_, index) => ({
            id: `query_${index}`,
            key: `key_${index}`,
            value: "value",
          })),
        },
      },
    ],
    [
      "invalid create idempotency keys",
      { ...validComposerDraft, createIdempotencyKey: "project_secret" },
    ],
  ])("rejects %s", (_name, candidate) => {
    expect(Web2JsonManifestDraftV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("round-trips bounded incomplete drafts byte-for-byte through JSON", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("source", "transform", "trust", "submit"),
        fc.string({ maxLength: 100 }),
        fc.string({ maxLength: 100 }),
        fc.string({ maxLength: 100 }),
        (step, jq, abiSignature, feeDigits) => {
          const candidate = {
            ...validComposerDraft,
            step,
            fields: {
              ...validComposerDraft.fields,
              sourceUrl: "https://api.example.com/public",
              jq,
              abiSignature,
              feeCapWei: /^\d+$/.test(feeDigits) && !/^0\d/.test(feeDigits)
                ? feeDigits
                : "",
            },
          };
          const parsed = Web2JsonManifestDraftV1Schema.parse(candidate);
          const roundTripped = Web2JsonManifestDraftV1Schema.parse(
            JSON.parse(JSON.stringify(parsed)),
          );
          expect(roundTripped).toEqual(parsed);
        },
      ),
      { numRuns: 100 },
    );
  });

  it.each([
    "token",
    "projectToken",
    "shareToken",
    "headers",
    "body",
    "sourceResponse",
    "credentials",
    "verifierData",
    "transactionHash",
    "errorStack",
  ])("has no extension point for forbidden field %s", (field) => {
    const candidate = {
      ...validComposerDraft,
      fields: { ...validComposerDraft.fields, [field]: "must-not-persist" },
    };
    expect(Web2JsonManifestDraftV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("allows harmless malformed partial URL text while refusing embedded credentials", () => {
    expect(Web2JsonManifestDraftV1Schema.safeParse({
      ...validComposerDraft,
      fields: { ...validComposerDraft.fields, sourceUrl: "https://" },
    }).success).toBe(true);
    expect(Web2JsonManifestDraftV1Schema.safeParse({
      ...validComposerDraft,
      fields: { ...validComposerDraft.fields, sourceUrl: "" },
    }).success).toBe(true);
  });
});
