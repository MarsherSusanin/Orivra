import { canonicalJson } from "../packages/domain/src/canonical-json";

export const OPEN_METEO_MANIFEST_SHA256 =
  "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
export const ETH_USD_MANIFEST_SHA256 =
  "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";

export const openMeteoManifest = {
  version: "1",
  attestationType: "Web2Json",
  network: "coston2",
  request: {
    method: "GET",
    url: "https://api.open-meteo.com/v1/forecast",
    query: {
      current: "temperature_2m",
      forecast_days: "1",
      latitude: "52.52",
      longitude: "13.41",
      temperature_unit: "celsius",
      timezone: "UTC",
    },
    jq: ".current | {temperatureTenthsCelsius: (.temperature_2m * 10), observedAt: .time}",
    abiSignature:
      '{"components":[{"internalType":"int256","name":"temperatureTenthsCelsius","type":"int256"},{"internalType":"string","name":"observedAt","type":"string"}],"name":"data","type":"tuple"}',
  },
  consumer: {
    expectedScheme: "https",
    expectedHost: "api.open-meteo.com",
    expectedPathPrefix: "/v1/forecast",
    expectedQuery: {
      current: "temperature_2m",
      forecast_days: "1",
      latitude: "52.52",
      longitude: "13.41",
      temperature_unit: "celsius",
      timezone: "UTC",
    },
  },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
} as const;

export const ethUsdManifest = {
  version: "1",
  attestationType: "Web2Json",
  network: "coston2",
  request: {
    method: "GET",
    url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    query: {},
    jq: ".data | {amount: .amount, currency: .currency}",
    abiSignature:
      '{"components":[{"internalType":"string","name":"amount","type":"string"},{"internalType":"string","name":"currency","type":"string"}],"name":"data","type":"tuple"}',
  },
  consumer: {
    expectedScheme: "https",
    expectedHost: "api.coinbase.com",
    expectedPathPrefix: "/v2/prices/ETH-USD/spot",
    expectedQuery: {},
  },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
} as const;

export const openMeteoTemplateSummary = {
  id: "open-meteo-current-weather",
  revision: 1,
  title: "Berlin current temperature",
  summary: "Verify the current temperature reported by Open-Meteo for Berlin.",
  provider: "Open-Meteo",
  category: "weather",
  featured: true,
  manifestSha256: OPEN_METEO_MANIFEST_SHA256,
  detailPath: "/v1/templates/open-meteo-current-weather",
} as const;

export const ethUsdTemplateSummary = {
  id: "eth-usd",
  revision: 1,
  title: "ETH/USD spot price",
  summary: "Verify Coinbase's ETH/USD spot price response.",
  provider: "Coinbase",
  category: "finance",
  featured: false,
  manifestSha256: ETH_USD_MANIFEST_SHA256,
  detailPath: "/v1/templates/eth-usd",
} as const;

export const templateCatalog = {
  version: "1",
  kind: "web2json-template-catalog",
  catalogRevision: 1,
  templates: [openMeteoTemplateSummary, ethUsdTemplateSummary],
} as const;

export const openMeteoTemplateDetail = {
  version: "1",
  kind: "web2json-template-detail",
  template: openMeteoTemplateSummary,
  manifest: openMeteoManifest,
  manifestCanonicalJson: canonicalJson(openMeteoManifest),
  provenance: {
    kind: "proofline-builtin",
    catalogRevision: 1,
    templateId: "open-meteo-current-weather",
    templateRevision: 1,
    manifestSha256: OPEN_METEO_MANIFEST_SHA256,
  },
} as const;

export const ethUsdTemplateDetail = {
  version: "1",
  kind: "web2json-template-detail",
  template: ethUsdTemplateSummary,
  manifest: ethUsdManifest,
  manifestCanonicalJson: canonicalJson(ethUsdManifest),
  provenance: {
    kind: "proofline-builtin",
    catalogRevision: 1,
    templateId: "eth-usd",
    templateRevision: 1,
    manifestSha256: ETH_USD_MANIFEST_SHA256,
  },
} as const;
