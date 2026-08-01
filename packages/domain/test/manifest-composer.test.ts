// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  deriveTrustFromSourceUrl,
  validateComposerSourceUrl,
} from "../src/manifest-composer";

describe("manifest Composer defensive behavior", () => {
  it("rejects a malformed absolute URL with a stable issue", () => {
    expect(validateComposerSourceUrl("not a URL")).toEqual({
      valid: false,
      issue: {
        field: "sourceUrl",
        code: "SOURCE_URL_INVALID",
        message: "Enter a valid absolute source URL.",
      },
    });
  });

  it("fails trust derivation closed for an unsafe source URL", () => {
    expect(() => deriveTrustFromSourceUrl("http://api.example.com/value")).toThrow(
      /invalid Composer source URL/i,
    );
  });

  it("uses the first value for duplicate query keys to match URL canonicalization", () => {
    expect(
      deriveTrustFromSourceUrl(
        "https://api.example.com/value?asset=ETH&asset=BTC&currency=USD",
      ).expectedQueryRows,
    ).toEqual([
      { id: "expected-query-0", key: "asset", value: "ETH" },
      { id: "expected-query-1", key: "currency", value: "USD" },
    ]);
  });
});
