// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { Web2JsonManifestDraftV1Schema, type Web2JsonManifestV1 } from "@proofline/contracts";
import {
  createEthUsdComposerDraft,
  deriveTrustFromSourceUrl,
  importWeb2JsonManifestDraft,
  validateComposerSourceUrl,
} from "../src/manifest-composer";

const updatedAt = "2026-08-02T03:00:00.000Z";
const createIdempotencyKey = "composer_123e4567-e89b-42d3-a456-426614174000";
const ethUsdAbiSignature =
  '{"components":[{"internalType":"string","name":"amount","type":"string"},{"internalType":"string","name":"currency","type":"string"}],"name":"data","type":"tuple"}';

const manifest: Web2JsonManifestV1 = {
  version: "1",
  attestationType: "Web2Json",
  network: "coston2",
  request: {
    method: "GET",
    url: "https://api.example.com/prices/eth?source=primary",
    query: { window: "1h", currency: "USD" },
    jq: ".data | {amount: .amount, currency: .currency}",
    abiSignature: ethUsdAbiSignature,
  },
  consumer: {
    expectedScheme: "https",
    expectedHost: "api.example.com",
    expectedPathPrefix: "/prices/eth",
    expectedQuery: { source: "primary", currency: "USD" },
  },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
};

describe("Slice 015A manifest Composer core", () => {
  it("creates the exact deterministic ETH/USD editing template", () => {
    const draft = createEthUsdComposerDraft({ updatedAt, createIdempotencyKey });

    expect(Web2JsonManifestDraftV1Schema.parse(draft)).toEqual(draft);
    expect(draft).toMatchObject({
      version: "1",
      step: "source",
      updatedAt,
      createIdempotencyKey,
      fields: {
        sourceUrl: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
        queryRows: [],
        jq: ".data | {amount: .amount, currency: .currency}",
        abiSignature: ethUsdAbiSignature,
        expectedScheme: "https",
        expectedHost: "api.coinbase.com",
        expectedPathPrefix: "/v2/prices/ETH-USD/spot",
        expectedQueryRows: [],
        submissionMode: "replay",
        feeCapWei: "20000000000000000",
      },
    });

    const abiDescriptor = JSON.parse(draft.fields.abiSignature);
    expect(abiDescriptor).toEqual({
      components: [
        { internalType: "string", name: "amount", type: "string" },
        { internalType: "string", name: "currency", type: "string" },
      ],
      name: "data",
      type: "tuple",
    });
    expect(JSON.stringify(abiDescriptor)).toBe(ethUsdAbiSignature);
  });

  it("strictly imports every manifest field into deterministic sorted editing rows", () => {
    const input = { manifest, updatedAt, createIdempotencyKey };
    const first = importWeb2JsonManifestDraft(input);
    const second = importWeb2JsonManifestDraft(input);

    expect(first).toEqual(second);
    expect(first.fields).toMatchObject({
      sourceUrl: manifest.request.url,
      queryRows: [
        { id: "source-query-0", key: "currency", value: "USD" },
        { id: "source-query-1", key: "window", value: "1h" },
      ],
      jq: manifest.request.jq,
      abiSignature: manifest.request.abiSignature,
      expectedScheme: "https",
      expectedHost: manifest.consumer.expectedHost,
      expectedPathPrefix: manifest.consumer.expectedPathPrefix,
      expectedQueryRows: [
        { id: "expected-query-0", key: "currency", value: "USD" },
        { id: "expected-query-1", key: "source", value: "primary" },
      ],
      submissionMode: "replay",
      feeCapWei: "20000000000000000",
    });
  });

  it("rejects a non-strict manifest atomically without mutating the input", () => {
    const unsafe = {
      ...manifest,
      request: { ...manifest.request, url: "http://api.example.com/prices/eth" },
      token: "project_private",
    };
    const before = structuredClone(unsafe);

    expect(() => importWeb2JsonManifestDraft({
      manifest: unsafe,
      updatedAt,
      createIdempotencyKey,
    })).toThrow(/manifest/i);
    expect(unsafe).toEqual(before);
  });

  it.each([
    [
      "http://api.example.com/public",
      "SOURCE_URL_HTTPS_REQUIRED",
      "Use HTTPS for the source URL.",
    ],
    [
      "https://api.example.com:8443/public",
      "SOURCE_URL_PORT_NOT_ALLOWED",
      "Source URLs must use port 443.",
    ],
    [
      "https://user:secret@api.example.com/public",
      "SOURCE_URL_CREDENTIALS_NOT_ALLOWED",
      "Remove credentials from the source URL.",
    ],
    [
      "https://api.example.com/public#private",
      "SOURCE_URL_FRAGMENT_NOT_ALLOWED",
      "Remove the URL fragment.",
    ],
  ])("returns a stable inline issue for %s", (url, code, message) => {
    expect(validateComposerSourceUrl(url)).toEqual({
      valid: false,
      issue: { field: "sourceUrl", code, message },
    });
  });

  it("derives normalized Trust fields from a safe URL without performing I/O", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no I/O"));

    expect(deriveTrustFromSourceUrl(
      "https://API.Example.COM:443/v2/prices/ETH?source=primary&asset=ETH",
    )).toEqual({
      expectedScheme: "https",
      expectedHost: "api.example.com",
      expectedPathPrefix: "/v2/prices/ETH",
      expectedQueryRows: [
        { id: "expected-query-0", key: "asset", value: "ETH" },
        { id: "expected-query-1", key: "source", value: "primary" },
      ],
    });
    expect(validateComposerSourceUrl("https://api.example.com/public")).toEqual({
      valid: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
