import {
  Coston2Web2JsonManifestV1Schema,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";
import { generateSafeWeb2JsonConsumer } from "./codegen";
import { sha256Hex } from "./sha256";

const OPEN_METEO_REPLAY_MANIFEST = Object.freeze({
  version: "1", attestationType: "Web2Json", network: "coston2",
  request: {
    method: "GET", url: "https://api.open-meteo.com/v1/forecast",
    query: { current: "temperature_2m", forecast_days: "1", latitude: "52.52", longitude: "13.41", temperature_unit: "celsius", timezone: "UTC" },
    jq: ".current | {temperatureTenthsCelsius: (.temperature_2m * 10), observedAt: .time}",
    abiSignature: '{"components":[{"internalType":"int256","name":"temperatureTenthsCelsius","type":"int256"},{"internalType":"string","name":"observedAt","type":"string"}],"name":"data","type":"tuple"}',
  },
  consumer: {
    expectedScheme: "https", expectedHost: "api.open-meteo.com", expectedPathPrefix: "/v1/forecast",
    expectedQuery: { current: "temperature_2m", forecast_days: "1", latitude: "52.52", longitude: "13.41", temperature_unit: "celsius", timezone: "UTC" },
  },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
});

const ETH_USD_REPLAY_MANIFEST = Object.freeze({
  version: "1", attestationType: "Web2Json", network: "coston2",
  request: {
    method: "GET", url: "https://api.coinbase.com/v2/prices/ETH-USD/spot", query: {},
    jq: ".data | {amount: .amount, currency: .currency}",
    abiSignature: '{"components":[{"internalType":"string","name":"amount","type":"string"},{"internalType":"string","name":"currency","type":"string"}],"name":"data","type":"tuple"}',
  },
  consumer: { expectedScheme: "https", expectedHost: "api.coinbase.com", expectedPathPrefix: "/v2/prices/ETH-USD/spot", expectedQuery: {} },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
});

const LIVE_IDENTITIES = Object.freeze({
  "open-meteo-current-weather": Object.freeze({
    relayer: "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6",
    replay: "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898",
    replayManifest: OPEN_METEO_REPLAY_MANIFEST,
  }),
  "eth-usd": Object.freeze({
    relayer: "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f",
    replay: "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db",
    replayManifest: ETH_USD_REPLAY_MANIFEST,
  }),
});

type ProductionTemplateId = keyof typeof LIVE_IDENTITIES;

function invalid(cause?: unknown): never {
  throw Object.assign(new Error("PRODUCTION_REPLAY_ALIAS_INVALID: Production replay alias is invalid"), {
    code: "PRODUCTION_REPLAY_ALIAS_INVALID",
    cause,
  });
}

function sha256(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

function comparable(manifest: Web2JsonManifestV1): Web2JsonManifestV1 {
  return Coston2Web2JsonManifestV1Schema.parse({
    ...manifest,
    submission: { ...manifest.submission, mode: "replay" },
  });
}

export function getProductionRelayerManifest(id: ProductionTemplateId) {
  const identity = LIVE_IDENTITIES[id];
  if (!identity) invalid();
  const manifest = Coston2Web2JsonManifestV1Schema.parse({
    ...identity.replayManifest,
    submission: { ...identity.replayManifest.submission, mode: "relayer" },
  });
  const manifestCanonicalJson = canonicalJson(manifest);
  if (sha256(manifestCanonicalJson) !== identity.relayer) invalid();
  return Object.freeze({
    id,
    manifest: Object.freeze(manifest),
    manifestCanonicalJson,
    manifestSha256: identity.relayer,
    replayManifestSha256: identity.replay,
  });
}

export function resolveProductionRelayerReplayAlias(input: {
  relayerManifest: unknown;
  relayerManifestSha256: string;
}) {
  try {
    const relayer = Coston2Web2JsonManifestV1Schema.parse(input.relayerManifest);
    if (relayer.submission.mode !== "relayer") invalid();
    for (const id of Object.keys(LIVE_IDENTITIES) as ProductionTemplateId[]) {
      const authority = getProductionRelayerManifest(id);
      if (authority.manifestSha256 !== input.relayerManifestSha256) continue;
      if (
        sha256(canonicalJson(relayer)) !== input.relayerManifestSha256 ||
        canonicalJson(authority.manifest) !== canonicalJson(relayer)
      ) invalid();
      return Object.freeze({
        id,
        sourceLiveManifestSha256: authority.manifestSha256,
        replayManifestSha256: authority.replayManifestSha256,
      });
    }
    invalid();
  } catch (cause) {
    if ((cause as { code?: string })?.code === "PRODUCTION_REPLAY_ALIAS_INVALID") throw cause;
    invalid(cause);
  }
}

export function verifyProductionRelayerReplayAlias(input: Record<string, any>) {
  try {
    const relayer = Coston2Web2JsonManifestV1Schema.parse(input.relayerManifest);
    const replay = Coston2Web2JsonManifestV1Schema.parse(input.replayManifest);
    const alias = resolveProductionRelayerReplayAlias({
      relayerManifest: relayer,
      relayerManifestSha256: input.relayerManifestSha256,
    });
    if (
      replay.submission.mode !== "replay" ||
      sha256(canonicalJson(replay)) !== input.replayManifestSha256 ||
      alias.replayManifestSha256 !== input.replayManifestSha256 ||
      canonicalJson(comparable(relayer)) !== canonicalJson(comparable(replay)) ||
      generateSafeWeb2JsonConsumer(relayer, { contractName: "ProoflineSafeWeb2JsonConsumer" }) !==
        generateSafeWeb2JsonConsumer(replay, { contractName: "ProoflineSafeWeb2JsonConsumer" }) ||
      !input.relayerConsumerIdentity ||
      canonicalJson(input.relayerConsumerIdentity) !== canonicalJson(input.replayConsumerIdentity) ||
      !["generatedSourceSha256", "creationBytecodeSha256", "runtimeCodeSha256"].every(
        (key) => /^sha256:[a-f0-9]{64}$/.test(input.relayerConsumerIdentity[key] ?? ""),
      ) ||
      input.run?.stage !== "completed" || input.run?.proofVerified !== true ||
      input.run?.manifestSha256 !== input.relayerManifestSha256 ||
      !/^run_[0-9A-Z]{26}$/.test(input.run?.runId ?? "") ||
      canonicalJson(input.run?.request) !== canonicalJson(relayer.request) ||
      canonicalJson(input.run?.consumer) !== canonicalJson(relayer.consumer) ||
      input.rawRelayerBundle?.runId !== input.run.runId ||
      input.rawRelayerBundle?.manifestSha256 !== input.relayerManifestSha256 ||
      input.rawRelayerPreflight?.runId !== input.run.runId ||
      input.rawRelayerPreflight?.manifestSha256 !== input.relayerManifestSha256
    ) invalid();
    return Object.freeze({
      sourceRunId: input.run.runId,
      sourceLiveManifestSha256: input.relayerManifestSha256,
      replayManifestSha256: input.replayManifestSha256,
      replayManifest: replay,
      consumerIdentity: Object.freeze({ ...input.relayerConsumerIdentity }),
      bundle: Object.freeze({ ...input.rawRelayerBundle }),
      preflightReport: Object.freeze({ ...input.rawRelayerPreflight }),
    });
  } catch (cause) {
    if ((cause as { code?: string })?.code === "PRODUCTION_REPLAY_ALIAS_INVALID") throw cause;
    invalid(cause);
  }
}
