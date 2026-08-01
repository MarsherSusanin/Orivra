// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Web2JsonDraftQueryRowV1 } from "@proofline/contracts";
import * as composer from "../src/index";

type TrustFields = {
  expectedScheme: "https";
  expectedHost: string;
  expectedPathPrefix: string;
  expectedQueryRows: Web2JsonDraftQueryRowV1[];
};

type TrustIssue = {
  field: string;
  code: string;
  message: string;
};

const validateComposerTrustFields = (composer as unknown as {
  validateComposerTrustFields(fields: TrustFields):
    | { valid: true }
    | { valid: false; issues: TrustIssue[] };
}).validateComposerTrustFields;

const validTrust: TrustFields = {
  expectedScheme: "https",
  expectedHost: "api.example.com",
  expectedPathPrefix: "/v2/prices",
  expectedQueryRows: [
    { id: "expected_asset", key: "asset", value: "" },
    { id: "expected_currency", key: "currency", value: "USD" },
  ],
};

describe("Slice 015A Trust validation core", () => {
  it.each([
    [
      { ...validTrust, expectedHost: "   " },
      {
        field: "expectedHost",
        code: "TRUST_HOST_REQUIRED",
        message: "Enter the expected source host.",
      },
    ],
    [
      { ...validTrust, expectedHost: "https://api.example.com/path" },
      {
        field: "expectedHost",
        code: "TRUST_HOST_INVALID",
        message: "Enter a valid hostname without a scheme, path, port, or credentials.",
      },
    ],
    [
      { ...validTrust, expectedHost: "API.Example.com" },
      {
        field: "expectedHost",
        code: "TRUST_HOST_NOT_NORMALIZED",
        message: "Use the lowercase normalized host.",
      },
    ],
    [
      { ...validTrust, expectedPathPrefix: "v2/prices" },
      {
        field: "expectedPathPrefix",
        code: "TRUST_PATH_PREFIX_INVALID",
        message: "Expected path prefix must start with /.",
      },
    ],
    [
      {
        ...validTrust,
        expectedQueryRows: [{ id: "blank", key: "   ", value: "" }],
      },
      {
        field: "expectedQueryRows.0.key",
        code: "TRUST_QUERY_KEY_REQUIRED",
        message: "Expected query keys cannot be blank.",
      },
    ],
    [
      {
        ...validTrust,
        expectedQueryRows: [
          { id: "first", key: "asset", value: "ETH" },
          { id: "second", key: " asset ", value: "BTC" },
        ],
      },
      {
        field: "expectedQueryRows.1.key",
        code: "TRUST_QUERY_KEY_DUPLICATE",
        message: "Expected query keys must be unique.",
      },
    ],
  ])("returns the stable issue %#", (candidate, issue) => {
    expect(validateComposerTrustFields(candidate)).toEqual({
      valid: false,
      issues: [issue],
    });
  });

  it("accepts normalized host/path/query fields and permits empty query values", () => {
    expect(validateComposerTrustFields(validTrust)).toEqual({ valid: true });
  });
});
