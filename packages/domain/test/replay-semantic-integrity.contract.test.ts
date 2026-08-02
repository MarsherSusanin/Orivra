// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  UINT256_MAX,
  makeBundleInput,
} from "../../contracts/test/fixtures";
import {
  canonicalizeManifestUrl,
  canonicalSerializeProofBundle,
  createProofBundle,
  diagnoseConsumerRequest,
  replayProofBundle,
} from "../src/index";

type BundleInput = ReturnType<typeof makeBundleInput>;

function createdEvent(content: BundleInput) {
  const created = content.events.find((event) => event.type === "RUN_CREATED");
  if (created?.type !== "RUN_CREATED") throw new Error("Fixture has no RUN_CREATED");
  return created;
}

function acceptedEvent(content: BundleInput) {
  const accepted = content.events.find(
    (event) => event.type === "PREFLIGHT_ACCEPTED",
  );
  if (accepted?.type !== "PREFLIGHT_ACCEPTED") {
    throw new Error("Fixture has no PREFLIGHT_ACCEPTED");
  }
  return accepted;
}

function bindManifest(content: BundleInput, manifest: BundleInput["manifest"]) {
  content.manifest = manifest;
  createdEvent(content).payload.manifest = manifest;
}

function rechecksummedBundle(
  mutate: (content: ReturnType<typeof makeBundleInput>) => void,
): string {
  const content = structuredClone(makeBundleInput());
  mutate(content);
  return canonicalSerializeProofBundle(createProofBundle(content));
}

describe("ProofBundleV1 semantic replay integrity", () => {
  it("rejects a checksum-valid manifest query drift hidden behind the old accepted URL", () => {
    const content = structuredClone(makeBundleInput());
    const oldAcceptedUrl = acceptedEvent(content).payload.canonicalUrl;
    const manifest = {
      ...content.manifest,
      request: {
        ...content.manifest.request,
        query: { ...content.manifest.request.query, window: "4h" },
      },
      consumer: {
        ...content.manifest.consumer,
        expectedQuery: {
          ...content.manifest.consumer.expectedQuery,
          window: "4h",
        },
      },
    };
    bindManifest(content, manifest);
    expect(canonicalizeManifestUrl(manifest)).not.toBe(oldAcceptedUrl);
    expect(
      diagnoseConsumerRequest(manifest, canonicalizeManifestUrl(manifest)),
    ).toEqual([]);

    const serialized = canonicalSerializeProofBundle(
      createProofBundle(content),
    );
    expect(() => replayProofBundle(serialized)).toThrow(
      /canonical|preflight|manifest.*url/i,
    );
  });

  it("rejects a checksum-valid accepted fee quote above the manifest cap", () => {
    const serialized = rechecksummedBundle((content) => {
      acceptedEvent(content).payload.quotedFeeWei = (
        BigInt(content.manifest.submission.feeCapWei) + 1n
      ).toString();
    });

    expect(() => replayProofBundle(serialized)).toThrow(/fee|cap|preflight/i);
  });

  it.each([
    [
      "host",
      { expectedHost: "mirror.example.net" },
      "CONSUMER_HOST_MISMATCH",
    ],
    [
      "path",
      { expectedPathPrefix: "/trusted/" },
      "CONSUMER_PATH_MISMATCH",
    ],
    [
      "query",
      { expectedQuery: { currency: "USD", source: "backup" } },
      "CONSUMER_QUERY_MISMATCH",
    ],
  ] as const)(
    "rejects a checksum-valid accepted bundle with a consumer Trust %s mismatch",
    (_label, consumerOverride, diagnosticCode) => {
      const content = structuredClone(makeBundleInput());
      const manifest = {
        ...content.manifest,
        consumer: { ...content.manifest.consumer, ...consumerOverride },
      };
      bindManifest(content, manifest);
      const acceptedUrl = acceptedEvent(content).payload.canonicalUrl;
      expect(
        diagnoseConsumerRequest(manifest, acceptedUrl).map(({ code }) => code),
      ).toContain(diagnosticCode);

      const serialized = canonicalSerializeProofBundle(
        createProofBundle(content),
      );
      expect(() => replayProofBundle(serialized)).toThrow(
        /consumer|trust|host|path|query/i,
      );
    },
  );

  it("keeps normal and uint256-max accepted fee evidence replayable", () => {
    const normal = canonicalSerializeProofBundle(
      createProofBundle(makeBundleInput()),
    );
    expect(replayProofBundle(normal)).toEqual(JSON.parse(normal));

    const content = structuredClone(makeBundleInput());
    const manifest = {
      ...content.manifest,
      submission: {
        ...content.manifest.submission,
        feeCapWei: UINT256_MAX,
      },
    };
    bindManifest(content, manifest);
    acceptedEvent(content).payload.quotedFeeWei = UINT256_MAX;
    const atMax = canonicalSerializeProofBundle(createProofBundle(content));
    expect(replayProofBundle(atMax)).toEqual(JSON.parse(atMax));
  });

  it.each([
    [
      "ordered lifecycle",
      (content: ReturnType<typeof makeBundleInput>) => {
        [content.events[1], content.events[2]] = [content.events[2], content.events[1]];
      },
      /sequence|lifecycle|transition/i,
    ],
    [
      "top-level run identity",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.events[4] = { ...content.events[4], runId: "run_different" };
      },
      /run.?id|identity/i,
    ],
    [
      "manifest identity",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.manifest = {
          ...content.manifest,
          consumer: { ...content.manifest.consumer, expectedHost: "mirror.example.net" },
        };
      },
      /manifest/i,
    ],
    [
      "prepared request bytes",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.requestBytes = "0x0102";
      },
      /request.*bytes|preflight/i,
    ],
    [
      "voting round",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.proof.votingRound += 1;
      },
      /voting.*round|round/i,
    ],
    [
      "verification contract snapshot",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.network.resolvedContracts.FdcVerification =
          "0x9999999999999999999999999999999999999999";
      },
      /verification.*contract|network.*snapshot/i,
    ],
    [
      "proof verification result",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.verification.proofVerified = false;
      },
      /proof.*verif/i,
    ],
    [
      "consumer verification result",
      (content: ReturnType<typeof makeBundleInput>) => {
        content.verification.consumerVerified = false;
      },
      /consumer.*verif/i,
    ],
  ])("rejects a checksum-valid bundle with inconsistent %s", (_label, mutate, message) => {
    const serialized = rechecksummedBundle(mutate);

    expect(() => replayProofBundle(serialized)).toThrow(message);
  });
});
