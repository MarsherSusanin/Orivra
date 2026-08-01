// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  exactTrustManifest,
  validPreflightReport,
} from "../../contracts/test/fixtures";
import {
  assertManifestHasNoSecrets,
  runWeb2JsonPreflight,
} from "../src/preflight";
import { FDC_HUB, REQUEST_BYTES } from "./fixtures";

function harness(sampleFactory: (index: number) => unknown = () => ({ price: 2500.125 })) {
  let sample = 0;
  return {
    safeFetcher: {
      getJson: vi.fn(async () => sampleFactory(sample++)),
    },
    transformJq: vi.fn(async (value) => ({
      value: Math.floor((value as { price: number }).price * 1_000_000),
    })),
    abiEncode: vi.fn().mockReturnValue("0x1234"),
    verifier: {
      prepareRequest: vi.fn().mockResolvedValue({ requestBytes: REQUEST_BYTES }),
    },
    feeOracle: {
      quote: vi.fn().mockResolvedValue(12_345n),
    },
  };
}

function preflightInput(ports: ReturnType<typeof harness>) {
  return {
    runId: RUN_ID,
    manifest: exactTrustManifest,
    samples: 5,
    fdcHub: FDC_HUB,
    networkSnapshot: validPreflightReport.registrySnapshot,
    ...ports,
  } as any;
}

describe("safe Web2Json preflight", () => {
  it("runs five deterministic fetch/JQ/ABI samples before verifier preparation and fee quote", async () => {
    const ports = harness();
    await expect(
      runWeb2JsonPreflight(preflightInput(ports)),
    ).resolves.toMatchObject({
      kind: "accepted",
      report: {
        runId: RUN_ID,
        verdict: "ready",
        canonicalUrl: validPreflightReport.canonicalUrl,
        sampleFingerprints: expect.arrayContaining([
          validPreflightReport.sampleFingerprints[0],
        ]),
        registrySnapshot: validPreflightReport.registrySnapshot,
        fee: {
          quotedWei: "12345",
          capWei: exactTrustManifest.submission.feeCapWei,
          withinCap: true,
        },
      },
      submissionEvidence: {
        canonicalUrl: validPreflightReport.canonicalUrl,
        requestBytes: REQUEST_BYTES,
        quotedFeeWei: 12_345n,
      },
    });
    expect(ports.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(ports.transformJq).toHaveBeenCalledTimes(5);
    expect(ports.abiEncode).toHaveBeenCalledTimes(5);
    expect(ports.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(ports.feeOracle.quote).toHaveBeenCalledWith({
      fdcHub: FDC_HUB,
      requestBytes: REQUEST_BYTES,
    });
  });

  it("returns blocked evidence after verifier and fee when one transformed sample differs", async () => {
    const ports = harness((index) => ({ price: index === 4 ? 2501 : 2500 }));
    await expect(
      runWeb2JsonPreflight(preflightInput(ports)),
    ).resolves.toMatchObject({
      kind: "blocked",
      report: {
        runId: RUN_ID,
        verdict: "blocked",
        determinism: { passed: false, distinctFingerprints: 2 },
        blockers: ["PREFLIGHT_SOURCE_NONDETERMINISTIC"],
        diagnostics: [
          expect.objectContaining({ code: "PREFLIGHT_SOURCE_NONDETERMINISTIC" }),
        ],
        requestIdentitySha256: validPreflightReport.requestIdentitySha256,
        fee: expect.objectContaining({ quotedWei: "12345" }),
      },
    });
    expect(ports.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(ports.transformJq).toHaveBeenCalledTimes(5);
    expect(ports.abiEncode).toHaveBeenCalledTimes(5);
    expect(ports.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(ports.feeOracle.quote).toHaveBeenCalledOnce();
  });

  it("returns blocked evidence after five ABI attempts and real request/fee evidence", async () => {
    const ports = harness();
    ports.abiEncode.mockImplementation(() => {
      throw new Error("uint256 overflow");
    });
    await expect(
      runWeb2JsonPreflight(preflightInput(ports)),
    ).resolves.toMatchObject({
      kind: "blocked",
      report: {
        runId: RUN_ID,
        verdict: "blocked",
        abiCompatibility: { compatible: false, checkedSamples: 5 },
        blockers: ["PREFLIGHT_ABI_INCOMPATIBLE"],
        diagnostics: [
          expect.objectContaining({ code: "PREFLIGHT_ABI_INCOMPATIBLE" }),
        ],
        requestIdentitySha256: validPreflightReport.requestIdentitySha256,
        fee: expect.objectContaining({ quotedWei: "12345" }),
      },
    });
    expect(ports.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(ports.transformJq).toHaveBeenCalledTimes(5);
    expect(ports.abiEncode).toHaveBeenCalledTimes(5);
    expect(ports.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(ports.feeOracle.quote).toHaveBeenCalledOnce();
  });
});

describe("manifest secret rejection", () => {
  it.each([
    "https://api.example.com/data?api_key=top-secret",
    "https://api.example.com/data?token=top-secret",
    "https://api.example.com/data?authorization=Bearer%20secret",
    "https://user:secret@api.example.com/data",
  ])("rejects credential material in a public Web2 URL: %s", (url) => {
    expect(() =>
      assertManifestHasNoSecrets({
        ...exactTrustManifest,
        request: { ...exactTrustManifest.request, url },
      }),
    ).toThrow(/secret|credential|public/i);
  });

  it("allows ordinary public query names and values", () => {
    expect(() => assertManifestHasNoSecrets(exactTrustManifest)).not.toThrow();
  });
});
