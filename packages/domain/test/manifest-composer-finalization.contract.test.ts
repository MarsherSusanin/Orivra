// @vitest-environment node

import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type {
  Web2JsonManifestDraftV1,
  Web2JsonManifestV1,
} from "@proofline/contracts";
import {
  VALID_ABI_SIGNATURE,
  validComposerDraft,
} from "../../contracts/test/fixtures";
import { canonicalizeManifestUrl } from "../src/diagnostics";
import * as Composer from "../src/manifest-composer";

type FinalizationIssue = {
  field: string;
  code: string;
  message: string;
};

type Finalization =
  | {
      valid: true;
      manifest: Web2JsonManifestV1;
      canonicalJson: string;
    }
  | { valid: false; issues: FinalizationIssue[] };

type TransformValidation =
  | { valid: true; canonicalAbiSignature: string }
  | { valid: false; issues: FinalizationIssue[] };

const finalize = (Composer as unknown as {
  finalizeWeb2JsonManifestDraft(
    draft: Web2JsonManifestDraftV1,
  ): Finalization;
}).finalizeWeb2JsonManifestDraft;

const validateTransform = (Composer as unknown as {
  validateComposerTransformFields(fields: {
    jq: string;
    abiSignature: string;
  }): TransformValidation;
}).validateComposerTransformFields;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function draft(
  fields: Partial<Web2JsonManifestDraftV1["fields"]> = {},
): Web2JsonManifestDraftV1 {
  const expectedQueryRows = [
    ...validComposerDraft.fields.expectedQueryRows,
    { id: "expected_window", key: "window", value: "1h" },
  ];
  return structuredClone({
    ...validComposerDraft,
    step: "submit",
    fields: { ...validComposerDraft.fields, expectedQueryRows, ...fields },
  }) as Web2JsonManifestDraftV1;
}

function expectIssue(result: Finalization, field: string, code: string) {
  expect(result).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ field, code, message: expect.any(String) }),
    ]),
  });
}

describe("Slice 015B Transform validation", () => {
  it("normalizes official ABI object whitespace and key order without reordering components", () => {
    const first = validateTransform({
      jq: ".price | {value: .}",
      abiSignature:
        '{ "type": "tuple", "components": [{"type":"uint256","name":"value","internalType":"uint256"},{"name":"currency","type":"string"}], "name": "data" }',
    });
    expect(first).toEqual({
      valid: true,
      canonicalAbiSignature:
        '{"components":[{"internalType":"uint256","name":"value","type":"uint256"},{"name":"currency","type":"string"}],"name":"data","type":"tuple"}',
    });
  });

  it.each([
    ["jq", "TRANSFORM_JQ_REQUIRED", { jq: "   ", abiSignature: VALID_ABI_SIGNATURE }],
    ["abiSignature", "TRANSFORM_ABI_JSON_INVALID", { jq: ".data", abiSignature: "{" }],
    [
      "abiSignature",
      "TRANSFORM_ABI_DESCRIPTOR_INVALID",
      { jq: ".data", abiSignature: '{"name":"data","type":"tuple"}' },
    ],
  ])("returns a stable %s issue", (field, code, fields) => {
    const result = validateTransform(fields);
    expect(result).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ field, code })]),
    });
  });
});

describe("Slice 015B pure manifest finalization", () => {
  it("returns the exact strict manifest and canonical local-only preview", () => {
    const input = draft();
    const result = finalize(input);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.manifest).toEqual({
      version: "1",
      attestationType: "Web2Json",
      network: "coston2",
      request: {
        method: "GET",
        url: validComposerDraft.fields.sourceUrl,
        query: { currency: "USD", window: "1h" },
        jq: validComposerDraft.fields.jq,
        abiSignature: VALID_ABI_SIGNATURE,
      },
      consumer: {
        expectedScheme: "https",
        expectedHost: "api.example.com",
        expectedPathPrefix: validComposerDraft.fields.expectedPathPrefix,
        expectedQuery: { currency: "USD", source: "primary", window: "1h" },
      },
      submission: { mode: "wallet", feeCapWei: "20000000000000000" },
    });
    expect(result.canonicalJson).toBe(canonicalJson(result.manifest));
    expect(JSON.parse(result.canonicalJson)).toEqual(result.manifest);
    expect(result.canonicalJson).not.toMatch(
      /createIdempotencyKey|updatedAt|composer_|"step"|sourceResponse|projectToken|errorStack/,
    );
  });

  it("uses explicit query rows over URL values and rejects duplicate URL keys", () => {
    const overridden = finalize(
      draft({
        sourceUrl:
          "https://api.example.com/prices/eth?source=primary&currency=EUR",
      }),
    );
    expect(overridden.valid).toBe(true);
    if (overridden.valid) {
      expect(overridden.manifest.request.query.currency).toBe("USD");
      expect(canonicalizeManifestUrl(overridden.manifest)).toBe(
        "https://api.example.com/prices/eth?currency=USD&source=primary&window=1h",
      );
    }

    expectIssue(
      finalize(
        draft({
          sourceUrl:
            "https://api.example.com/prices/eth?source=first&source=second",
        }),
      ),
      "sourceUrl",
      "SOURCE_URL_QUERY_DUPLICATE",
    );
  });

  it("rejects ambiguous editor query rows instead of silently overwriting them", () => {
    expectIssue(
      finalize(
        draft({
          queryRows: [
            { id: "one", key: "currency", value: "USD" },
            { id: "two", key: "currency", value: "EUR" },
          ],
        }),
      ),
      "queryRows.1.key",
      "SOURCE_QUERY_KEY_DUPLICATE",
    );
    expectIssue(
      finalize(
        draft({
          queryRows: [{ id: "blank", key: "   ", value: "USD" }],
        }),
      ),
      "queryRows.0.key",
      "SOURCE_QUERY_KEY_REQUIRED",
    );
  });

  it("requires Trust to cover the effective host, path segment and complete query", () => {
    expectIssue(
      finalize(draft({ expectedHost: "mirror.example.com" })),
      "expectedHost",
      "TRUST_HOST_MISMATCH",
    );
    expectIssue(
      finalize(draft({ expectedPathPrefix: "/prices/e" })),
      "expectedPathPrefix",
      "TRUST_PATH_NOT_COVERED",
    );
    expectIssue(
      finalize({
        ...draft(),
        fields: {
          ...draft().fields,
          expectedQueryRows: draft().fields.expectedQueryRows.filter(
            ({ key }) => key !== "window",
          ),
        },
      }),
      "expectedQueryRows",
      "TRUST_QUERY_MISMATCH",
    );
  });

  it("constructs query maps without prototype mutation", () => {
    const result = finalize(
      draft({
        sourceUrl: "https://api.example.com/prices/eth",
        queryRows: [{ id: "prototype", key: "__proto__", value: "safe-value" }],
        expectedQueryRows: [
          { id: "expected-prototype", key: "__proto__", value: "safe-value" },
        ],
      }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(Object.hasOwn(result.manifest.request.query, "__proto__")).toBe(true);
    expect(result.manifest.request.query.__proto__).toBe("safe-value");
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("does not mutate the draft or perform browser/network I/O", () => {
    const input = draft();
    const before = structuredClone(input);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("No remote transform preview is allowed"),
    );
    finalize(input);
    expect(input).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [draft({ jq: "" }), "jq", "TRANSFORM_JQ_REQUIRED"],
    [draft({ abiSignature: "{uint256 value}" }), "abiSignature", "TRANSFORM_ABI_JSON_INVALID"],
    [draft({ feeCapWei: "" }), "feeCapWei", "SUBMISSION_FEE_CAP_REQUIRED"],
  ])("rejects an incomplete final manifest", (input, field, code) => {
    expectIssue(finalize(input), field, code);
  });

  it("is byte-deterministic across row order and ABI object formatting", () => {
    const baseline = finalize(draft());
    expect(baseline.valid).toBe(true);
    if (!baseline.valid) return;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        (rotation, prettyAbi) => {
          const input = draft();
          const rotate = <T,>(values: readonly T[]) => {
            const index = rotation % values.length;
            return [...values.slice(index), ...values.slice(0, index)];
          };
          input.fields.queryRows = rotate(input.fields.queryRows);
          input.fields.expectedQueryRows = rotate(input.fields.expectedQueryRows);
          if (prettyAbi) {
            input.fields.abiSignature = JSON.stringify(
              JSON.parse(input.fields.abiSignature),
              null,
              2,
            );
          }

          const result = finalize(input);
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.canonicalJson).toBe(baseline.canonicalJson);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
