// @vitest-environment node

import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical-json";
import {
  appendRunEvents,
  canonicalizeManifestUrl,
  canonicalSerializeProofBundle,
  createProofBundle,
  diagnoseConsumerRequest,
  generateSafeWeb2JsonConsumer,
  projectRun,
  replayProofBundle,
  verifyProofBundleChecksum,
} from "../src/index";
import { sha256Hex } from "../src/sha256";
import {
  makeBundleInput,
  makeRunEvents,
  validManifest,
} from "../../contracts/test/fixtures";

describe("canonical JSON defensive branches", () => {
  it.each([
    [null, "null"],
    [true, "true"],
    ["proofline", '"proofline"'],
    [42, "42"],
    [[3, "two", false], '[3,"two",false]'],
    [{ z: 1, a: { b: 2 } }, '{"a":{"b":2},"z":1}'],
  ])("serializes %j canonically", (value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite number %s",
    (value) => {
      expect(() => canonicalJson(value)).toThrow(/non-finite/i);
    },
  );

  it("rejects undefined object fields and unsupported primitive kinds", () => {
    expect(() => canonicalJson({ unsafe: undefined })).toThrow(/undefined/i);
    expect(() => canonicalJson(1n)).toThrow(/bigint/i);
    expect(() => canonicalJson(Symbol("unsafe"))).toThrow(/symbol/i);
  });

  it("matches standard SHA-256 vectors across one and multiple blocks", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("a".repeat(100))).toBe(
      "2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e",
    );
  });
});

describe("journal and projection defensive branches", () => {
  it("rejects an empty projection and invalid existing journals", () => {
    expect(() => projectRun([])).toThrow(/requires RUN_CREATED/i);
    const events = makeRunEvents();
    expect(() =>
      appendRunEvents(
        [{ ...events[0] }, { ...events[0], sequence: 2 }],
        [],
      ),
    ).toThrow(/transition|duplicate/i);
  });

  it("rejects a conflicting command already present in the stored journal", () => {
    const events = makeRunEvents();
    expect(() =>
      appendRunEvents(
        [
          events[0],
          {
            ...events[1],
            commandId: events[0].commandId,
          },
        ],
        [],
      ),
    ).toThrow(/command.*conflict/i);
  });

  it("rejects cross-run projections and allows a terminal failed consumer result", () => {
    const events = makeRunEvents();
    expect(() => projectRun([{ ...events[0], sequence: 2 }])).toThrow(
      /expected sequence 1/i,
    );
    expect(() =>
      projectRun([events[0], { ...events[1], runId: "run_other" }]),
    ).toThrow(/run id/i);

    const failed = [
      ...events.slice(0, -1),
      {
        ...events.at(-1)!,
        payload: {
          passed: false,
          diagnostics: [
            {
              version: "1" as const,
              code: "CONSUMER_HOST_MISMATCH",
              severity: "error" as const,
              confidence: "high" as const,
              summary: "Host mismatch",
              evidence: {},
              remediation: "Enforce the host.",
            },
          ],
        },
      },
    ];
    expect(projectRun(failed).stages.consumer).toBe("failed");
  });
});

describe("diagnostic and bundle defensive branches", () => {
  it("handles root and trailing-slash prefixes and malformed consumer URLs", () => {
    const rootManifest = {
      ...validManifest,
      consumer: {
        ...validManifest.consumer,
        expectedPathPrefix: "/",
        expectedQuery: {},
      },
    };
    expect(
      diagnoseConsumerRequest(rootManifest, "https://api.example.com/anything"),
    ).toEqual([]);

    const slashManifest = {
      ...rootManifest,
      consumer: { ...rootManifest.consumer, expectedPathPrefix: "/prices/" },
    };
    expect(
      diagnoseConsumerRequest(slashManifest, "https://api.example.com/prices/eth"),
    ).toEqual([]);
    const segmentManifest = {
      ...rootManifest,
      consumer: { ...rootManifest.consumer, expectedPathPrefix: "/prices" },
    };
    expect(
      diagnoseConsumerRequest(segmentManifest, "https://api.example.com/prices"),
    ).toEqual([]);
    expect(
      diagnoseConsumerRequest(segmentManifest, "https://api.example.com/prices/eth"),
    ).toEqual([]);
    expect(
      diagnoseConsumerRequest(segmentManifest, "https://api.example.com/prices-evil"),
    ).toMatchObject([{ code: "CONSUMER_PATH_MISMATCH" }]);
    expect(diagnoseConsumerRequest(validManifest, "%%%")).toMatchObject([
      { code: "CONSUMER_URL_INVALID" },
    ]);
  });

  it("omits the canonical query marker when a manifest has no source or request query", () => {
    expect(
      canonicalizeManifestUrl({
        ...validManifest,
        request: {
          ...validManifest.request,
          url: "https://api.example.com/prices/eth",
          query: {},
        },
      }),
    ).toBe("https://api.example.com/prices/eth");
  });

  it("fails checksum checks closed for non-objects, bad checksums, and undefined values", () => {
    expect(verifyProofBundleChecksum(null)).toBe(false);
    expect(verifyProofBundleChecksum([])).toBe(false);
    expect(verifyProofBundleChecksum({})).toBe(false);
    expect(verifyProofBundleChecksum({ checksum: "md5:unsafe" })).toBe(false);
    expect(
      verifyProofBundleChecksum({
        checksum: `sha256:${"a".repeat(64)}`,
        invalid: undefined,
      }),
    ).toBe(false);
  });

  it("distinguishes malformed JSON, checksum failure, and a checksummed schema failure", () => {
    expect(() => replayProofBundle("{")).toThrow(/valid JSON/i);
    expect(() =>
      replayProofBundle(JSON.stringify({ checksum: `sha256:${"0".repeat(64)}` })),
    ).toThrow(/checksum mismatch/i);

    const invalidContent = { version: "1", unexpected: true };
    const invalidBundle = {
      ...invalidContent,
      checksum: `sha256:${sha256Hex(canonicalJson(invalidContent))}`,
    };
    expect(() => replayProofBundle(canonicalJson(invalidBundle))).toThrow();
  });

  it("rejects malformed canonical serialization and emits no query checks for an empty invariant map", () => {
    expect(() =>
      canonicalSerializeProofBundle({
        ...createProofBundle(makeBundleInput()),
        checksum: "unsafe",
      }),
    ).toThrow();

    const generated = generateSafeWeb2JsonConsumer(
      {
        ...validManifest,
        consumer: { ...validManifest.consumer, expectedQuery: {} },
      },
      { contractName: "_SafeConsumer2" },
    );
    expect(generated).not.toContain("requireQueryValue");
  });
});
