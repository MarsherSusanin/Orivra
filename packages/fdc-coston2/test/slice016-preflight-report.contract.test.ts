// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  blockedPreflightReport,
  exactTrustManifest,
  validPreflightReport,
} from "../../contracts/test/fixtures";
import { runWeb2JsonPreflight } from "../src/preflight";

const NETWORK_SNAPSHOT = validPreflightReport.registrySnapshot;

function ports(samples: unknown[] = Array.from({ length: 5 }, () => ({ price: 2500.125 }))) {
  let sample = 0;
  return {
    safeFetcher: {
      getJson: vi.fn(async () => samples[sample++] ?? samples.at(-1)),
    },
    transformJq: vi.fn(async (value: unknown) => ({
      value: Math.floor((value as { price: number }).price * 1_000_000),
    })),
    abiEncode: vi.fn(() => "0x1234"),
    verifier: {
      prepareRequest: vi.fn(async () => ({ requestBytes: "0x1234abcd" })),
    },
    feeOracle: {
      quote: vi.fn(async () => 12_345_000_000_000_000n),
    },
  };
}

function input(adapterPorts: ReturnType<typeof ports>, manifest: unknown = exactTrustManifest) {
  return {
    runId: RUN_ID,
    manifest,
    samples: 5,
    fdcHub: NETWORK_SNAPSHOT.resolvedContracts.FdcHub,
    networkSnapshot: NETWORK_SNAPSHOT,
    ...adapterPorts,
  } as any;
}

describe("Slice 016A FDC preflight public evidence outcomes", () => {
  it("returns an accepted public report after exactly five canonical transformed fingerprints", async () => {
    const adapterPorts = ports();
    const outcome = await runWeb2JsonPreflight(input(adapterPorts));

    expect(outcome).toMatchObject({
      kind: "accepted",
      report: validPreflightReport,
      submissionEvidence: {
        canonicalUrl: validPreflightReport.canonicalUrl,
        requestBytes: "0x1234abcd",
        quotedFeeWei: 12_345_000_000_000_000n,
      },
    });
    expect(adapterPorts.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(adapterPorts.transformJq).toHaveBeenCalledTimes(5);
    expect(adapterPorts.abiEncode).toHaveBeenCalledTimes(5);
    expect(adapterPorts.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(adapterPorts.feeOracle.quote).toHaveBeenCalledOnce();
    expect(JSON.stringify((outcome as any).report)).not.toMatch(
      /requestBytes|calldata|authorization|93\.184\.216\.34|private.?key|stack/i,
    );
  });

  it("returns a blocked report only after all five real samples prove nondeterminism", async () => {
    const adapterPorts = ports([
      { price: 2500.125 },
      { price: 2500.125 },
      { price: 2500.125 },
      { price: 2500.125 },
      { price: 2501 },
    ]);

    const outcome = await runWeb2JsonPreflight(input(adapterPorts));

    expect(outcome).toMatchObject({
      kind: "blocked",
      report: {
        ...blockedPreflightReport,
        diagnostics: [
          expect.objectContaining({
            code: "PREFLIGHT_SOURCE_NONDETERMINISTIC",
            severity: "error",
          }),
        ],
      },
    });
    expect(adapterPorts.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(adapterPorts.transformJq).toHaveBeenCalledTimes(5);
    expect(adapterPorts.abiEncode).toHaveBeenCalledTimes(5);
    expect(adapterPorts.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(adapterPorts.feeOracle.quote).toHaveBeenCalledOnce();
  });

  it("collects five real samples before publishing an ABI-incompatible blocked report", async () => {
    const adapterPorts = ports();
    adapterPorts.abiEncode.mockImplementation(() => {
      throw new Error("uint256 overflow");
    });

    const outcome = await runWeb2JsonPreflight(input(adapterPorts));

    expect(outcome).toMatchObject({
      kind: "blocked",
      report: {
        verdict: "blocked",
        abiCompatibility: { compatible: false, checkedSamples: 5 },
        blockers: ["PREFLIGHT_ABI_INCOMPATIBLE"],
        diagnostics: [
          expect.objectContaining({ code: "PREFLIGHT_ABI_INCOMPATIBLE" }),
        ],
      },
    });
    expect(adapterPorts.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(adapterPorts.transformJq).toHaveBeenCalledTimes(5);
    expect(adapterPorts.abiEncode).toHaveBeenCalledTimes(5);
    expect(adapterPorts.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(adapterPorts.feeOracle.quote).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "host",
      {
        ...exactTrustManifest,
        consumer: { ...exactTrustManifest.consumer, expectedHost: "mirror.example.net" },
      },
      "PREFLIGHT_TRUST_HOST_MISMATCH",
    ],
    [
      "path",
      {
        ...exactTrustManifest,
        consumer: { ...exactTrustManifest.consumer, expectedPathPrefix: "/other/" },
      },
      "PREFLIGHT_TRUST_PATH_MISMATCH",
    ],
    [
      "query",
      {
        ...exactTrustManifest,
        consumer: {
          ...exactTrustManifest.consumer,
          expectedQuery: { ...exactTrustManifest.consumer.expectedQuery, source: "backup" },
        },
      },
      "PREFLIGHT_TRUST_QUERY_MISMATCH",
    ],
  ])("publishes a blocked report for an exact Trust %s mismatch", async (_label, manifest, code) => {
    const adapterPorts = ports();
    const outcome = await runWeb2JsonPreflight(input(adapterPorts, manifest));

    expect(outcome).toMatchObject({
      kind: "blocked",
      report: {
        verdict: "blocked",
        blockers: [code],
        diagnostics: [expect.objectContaining({ code })],
      },
    });
    expect(adapterPorts.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(adapterPorts.transformJq).toHaveBeenCalledTimes(5);
    expect(adapterPorts.abiEncode).toHaveBeenCalledTimes(5);
    expect(adapterPorts.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(adapterPorts.feeOracle.quote).toHaveBeenCalledOnce();
  });

  it("publishes fee-cap evidence as blocked instead of losing the five samples", async () => {
    const adapterPorts = ports();
    adapterPorts.feeOracle.quote.mockResolvedValueOnce(
      BigInt(exactTrustManifest.submission.feeCapWei) + 1n,
    );

    const outcome = await runWeb2JsonPreflight(input(adapterPorts));

    expect(outcome).toMatchObject({
      kind: "blocked",
      report: {
        verdict: "blocked",
        fee: {
          quotedWei: (BigInt(exactTrustManifest.submission.feeCapWei) + 1n).toString(),
          capWei: exactTrustManifest.submission.feeCapWei,
          withinCap: false,
        },
        blockers: ["PREFLIGHT_FEE_CAP_EXCEEDED"],
        diagnostics: [
          expect.objectContaining({ code: "PREFLIGHT_FEE_CAP_EXCEEDED" }),
        ],
      },
    });
    expect(adapterPorts.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(adapterPorts.transformJq).toHaveBeenCalledTimes(5);
    expect(adapterPorts.abiEncode).toHaveBeenCalledTimes(5);
    expect(adapterPorts.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(adapterPorts.feeOracle.quote).toHaveBeenCalledOnce();
  });

  it.each([
    "https://api.example.com/prices/eth?token=private",
    "https://user:private@api.example.com/prices/eth",
  ])("rejects a secret-bearing manifest before any source or chain I/O: %s", async (url) => {
    const adapterPorts = ports();
    await expect(
      runWeb2JsonPreflight(
        input(adapterPorts, {
          ...exactTrustManifest,
          request: { ...exactTrustManifest.request, url },
        }),
      ),
    ).rejects.toThrow(/secret|credential|public/i);
    expect(adapterPorts.safeFetcher.getJson).not.toHaveBeenCalled();
    expect(adapterPorts.verifier.prepareRequest).not.toHaveBeenCalled();
    expect(adapterPorts.feeOracle.quote).not.toHaveBeenCalled();
  });

  it("does not manufacture a public report from SSRF, verifier, or RPC transport failure", async () => {
    const ssrfPorts = ports();
    ssrfPorts.safeFetcher.getJson.mockRejectedValueOnce(new Error("SSRF denied"));
    await expect(runWeb2JsonPreflight(input(ssrfPorts))).rejects.toThrow(/SSRF/i);
    expect(ssrfPorts.verifier.prepareRequest).not.toHaveBeenCalled();
    expect(ssrfPorts.feeOracle.quote).not.toHaveBeenCalled();

    const verifierPorts = ports();
    verifierPorts.verifier.prepareRequest.mockRejectedValueOnce(
      new Error("verifier transport unavailable"),
    );
    await expect(runWeb2JsonPreflight(input(verifierPorts))).rejects.toThrow(
      /verifier|transport/i,
    );
    expect(verifierPorts.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(verifierPorts.feeOracle.quote).not.toHaveBeenCalled();

    const rpcPorts = ports();
    rpcPorts.feeOracle.quote.mockRejectedValueOnce(
      new Error("registry RPC transport unavailable"),
    );
    await expect(runWeb2JsonPreflight(input(rpcPorts))).rejects.toThrow(
      /RPC|transport/i,
    );
    expect(rpcPorts.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(rpcPorts.verifier.prepareRequest).toHaveBeenCalledOnce();
  });
});
