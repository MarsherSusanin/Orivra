import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as domain from "../src/index";

const productionDomain = domain as Record<string, (...args: any[]) => any>;
const canonicalJson = productionDomain.canonicalJson!;
const getWeb2JsonTemplateDetail = productionDomain.getWeb2JsonTemplateDetail!;
const getProductionRelayerManifest = productionDomain.getProductionRelayerManifest!;
const verifyProductionRelayerReplayAlias = productionDomain.verifyProductionRelayerReplayAlias!;

const OPEN_REPLAY = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const ETH_REPLAY = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const OPEN_RELAYER = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_RELAYER = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const consumerIdentity = Object.freeze({
  generatedSourceSha256: `sha256:${"a".repeat(64)}`,
  creationBytecodeSha256: `sha256:${"b".repeat(64)}`,
  runtimeCodeSha256: `sha256:${"c".repeat(64)}`,
});

describe("029D production relayer manifests", () => {
  it("preserves public replay bytes and derives two exact submission-only relayer identities", () => {
    for (const [id, replaySha, relayerSha] of [
      ["open-meteo-current-weather", OPEN_REPLAY, OPEN_RELAYER],
      ["eth-usd", ETH_REPLAY, ETH_RELAYER],
    ] as const) {
      const publicDetail = getWeb2JsonTemplateDetail(id)!;
      const relayer = getProductionRelayerManifest(id);
      expect(publicDetail.manifest.submission.mode).toBe("replay");
      expect(sha(publicDetail.manifestCanonicalJson)).toBe(replaySha);
      expect(relayer.manifest.submission.mode).toBe("relayer");
      expect(relayer.manifestSha256).toBe(relayerSha);
      expect(Object.fromEntries(Object.entries(relayer.manifest).filter(([key]) => key !== "submission")))
        .toEqual(Object.fromEntries(Object.entries(publicDetail.manifest).filter(([key]) => key !== "submission")));
      expect(relayer.manifest.submission.feeCapWei).toBe(publicDetail.manifest.submission.feeCapWei);
    }
  });

  it("rebinds a verified terminal Open-Meteo relayer result to replay bytes only through the strict promotion seam", () => {
    const live = getProductionRelayerManifest("open-meteo-current-weather");
    const replay = getWeb2JsonTemplateDetail("open-meteo-current-weather")!;
    const promoted = verifyProductionRelayerReplayAlias({
      run: {
        runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", stage: "completed", proofVerified: true,
        manifestSha256: OPEN_RELAYER, request: live.manifest.request, consumer: live.manifest.consumer,
      },
      relayerManifest: live.manifest,
      relayerManifestSha256: OPEN_RELAYER,
      replayManifest: replay.manifest,
      replayManifestSha256: OPEN_REPLAY,
      relayerConsumerIdentity: consumerIdentity,
      replayConsumerIdentity: consumerIdentity,
      rawRelayerBundle: { manifestSha256: OPEN_RELAYER, runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4" },
      rawRelayerPreflight: { manifestSha256: OPEN_RELAYER, runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4" },
    });
    expect(promoted).toEqual(expect.objectContaining({
      sourceRunId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      sourceLiveManifestSha256: OPEN_RELAYER,
      replayManifestSha256: OPEN_REPLAY,
    }));
    expect(canonicalJson(promoted.bundle)).toContain(OPEN_RELAYER);
    expect(canonicalJson(promoted.preflightReport)).toContain(OPEN_RELAYER);
    expect(promoted.replayManifest.submission.mode).toBe("replay");
  });

  it("rejects raw relayer evidence and any request or consumer cross-source mismatch", () => {
    const live = getProductionRelayerManifest("open-meteo-current-weather");
    const replay = getWeb2JsonTemplateDetail("open-meteo-current-weather")!;
    const base = {
      run: { runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", stage: "completed", proofVerified: true, manifestSha256: OPEN_RELAYER, request: live.manifest.request, consumer: live.manifest.consumer },
      relayerManifest: live.manifest, relayerManifestSha256: OPEN_RELAYER,
      replayManifest: replay.manifest, replayManifestSha256: OPEN_REPLAY,
      relayerConsumerIdentity: consumerIdentity,
      replayConsumerIdentity: consumerIdentity,
      rawRelayerBundle: { manifestSha256: OPEN_RELAYER, runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4" },
      rawRelayerPreflight: { manifestSha256: OPEN_RELAYER, runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4" },
    };
    for (const invalid of [
      { ...base, replayManifest: { ...replay.manifest, request: { ...replay.manifest.request, url: "https://example.invalid" } } },
      { ...base, replayManifest: { ...replay.manifest, consumer: { ...replay.manifest.consumer, expectedHost: "example.invalid" } } },
      { ...base, run: { ...base.run, proofVerified: false } },
      { ...base, run: { ...base.run, manifestSha256: ETH_RELAYER } },
      { ...base, replayManifestSha256: ETH_REPLAY },
      { ...base, replayConsumerIdentity: { ...consumerIdentity, runtimeCodeSha256: `sha256:${"d".repeat(64)}` } },
    ]) expect(() => verifyProductionRelayerReplayAlias(invalid)).toThrow(/PRODUCTION_REPLAY_ALIAS_INVALID/);
  });
});
