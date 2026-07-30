// @vitest-environment node

import { describe, expect, it } from "vitest";
import { canonicalizeManifestUrl, diagnoseConsumerRequest } from "../src/index";
import {
  expectedCanonicalUrl,
  validManifest,
} from "../../contracts/test/fixtures";

describe("manifest URL canonicalization", () => {
  it("normalizes scheme and host, removes :443, merges query, and sorts query keys", () => {
    expect(canonicalizeManifestUrl(validManifest)).toBe(expectedCanonicalUrl);
  });

  it("lets explicit manifest query values replace URL query values", () => {
    const manifest = {
      ...validManifest,
      request: {
        ...validManifest.request,
        url: "https://api.example.com/prices/eth?currency=EUR&z=last",
      },
    };
    expect(canonicalizeManifestUrl(manifest)).toBe(
      "https://api.example.com/prices/eth?currency=USD&window=1h&z=last",
    );
  });
});

describe("consumer request diagnostics", () => {
  it("returns no findings for the exact normalized scheme, host, path prefix, and query", () => {
    expect(diagnoseConsumerRequest(validManifest, expectedCanonicalUrl)).toEqual([]);
    expect(
      diagnoseConsumerRequest(
        validManifest,
        "https://API.EXAMPLE.COM./prices/eth?window=1h&source=primary&currency=USD",
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "scheme",
      "http://api.example.com/prices/eth?currency=USD&source=primary",
      "CONSUMER_SCHEME_MISMATCH",
    ],
    [
      "host",
      "https://mirror.example.net/prices/eth?currency=USD&source=primary",
      "CONSUMER_HOST_MISMATCH",
    ],
    [
      "path prefix",
      "https://api.example.com/assets/eth?currency=USD&source=primary",
      "CONSUMER_PATH_MISMATCH",
    ],
    [
      "query value",
      "https://api.example.com/prices/eth?currency=EUR&source=primary",
      "CONSUMER_QUERY_MISMATCH",
    ],
  ])("emits stable evidence for a %s mismatch", (_name, url, expectedCode) => {
    const diagnostics = diagnoseConsumerRequest(validManifest, url);
    expect(diagnostics.map(({ code }) => code)).toContain(expectedCode);
    expect(diagnostics.find(({ code }) => code === expectedCode)).toMatchObject({
      version: "1",
      severity: "error",
      confidence: "high",
      evidence: { requestUrl: url },
    });
  });

  it("does not accept a path-prefix lookalike or a missing expected query", () => {
    const diagnostics = diagnoseConsumerRequest(
      validManifest,
      "https://api.example.com/prices-evil/eth?currency=USD",
    );
    expect(diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["CONSUMER_PATH_MISMATCH", "CONSUMER_QUERY_MISMATCH"]),
    );
  });
});
