import {
  Web2JsonTemplateCatalogV1Schema,
  Web2JsonTemplateDetailV1Schema,
  type Web2JsonTemplateCatalogV1,
  type Web2JsonTemplateDetailV1,
} from "@proofline/contracts/templates";
import { Web2JsonManifestV1Schema } from "@proofline/contracts/manifest";
import { canonicalJson } from "./canonical-json";
import { sha256Hex } from "./sha256";

const OPEN_METEO_MANIFEST_SHA256 =
  "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const ETH_USD_MANIFEST_SHA256 =
  "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function manifestSha256(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

const openMeteoManifest = {
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
};

const ethUsdManifest = {
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
};

function createDetail(input: {
  id: "open-meteo-current-weather" | "eth-usd";
  title: string;
  summary: string;
  provider: string;
  category: "finance" | "weather";
  featured: boolean;
  manifestSha256: string;
  manifest: unknown;
}): Web2JsonTemplateDetailV1 {
  const manifest = Web2JsonManifestV1Schema.parse(input.manifest);
  const manifestCanonicalJson = canonicalJson(manifest);
  return Web2JsonTemplateDetailV1Schema.parse({
    version: "1",
    kind: "web2json-template-detail",
    template: {
      id: input.id,
      revision: 1,
      title: input.title,
      summary: input.summary,
      provider: input.provider,
      category: input.category,
      featured: input.featured,
      manifestSha256: input.manifestSha256,
      detailPath: `/v1/templates/${input.id}`,
    },
    manifest,
    manifestCanonicalJson,
    provenance: {
      kind: "proofline-builtin",
      catalogRevision: 1,
      templateId: input.id,
      templateRevision: 1,
      manifestSha256: input.manifestSha256,
    },
  });
}

const openMeteoDetail = createDetail({
  id: "open-meteo-current-weather",
  title: "Berlin current temperature",
  summary: "Verify the current temperature reported by Open-Meteo for Berlin.",
  provider: "Open-Meteo",
  category: "weather",
  featured: true,
  manifestSha256: OPEN_METEO_MANIFEST_SHA256,
  manifest: openMeteoManifest,
});

const ethUsdDetail = createDetail({
  id: "eth-usd",
  title: "ETH/USD spot price",
  summary: "Verify Coinbase's ETH/USD spot price response.",
  provider: "Coinbase",
  category: "finance",
  featured: false,
  manifestSha256: ETH_USD_MANIFEST_SHA256,
  manifest: ethUsdManifest,
});

const catalog = deepFreeze(Web2JsonTemplateCatalogV1Schema.parse({
  version: "1",
  kind: "web2json-template-catalog",
  catalogRevision: 1,
  templates: [openMeteoDetail.template, ethUsdDetail.template],
}));
const details = new Map<string, Web2JsonTemplateDetailV1>([
  [openMeteoDetail.template.id, deepFreeze(openMeteoDetail)],
  [ethUsdDetail.template.id, deepFreeze(ethUsdDetail)],
]);

export function getWeb2JsonTemplateCatalog(): Web2JsonTemplateCatalogV1 {
  return catalog;
}

export function getWeb2JsonTemplateDetail(
  id: string,
): Web2JsonTemplateDetailV1 | null {
  return details.get(id) ?? null;
}

export function resolveWeb2JsonTemplate(input: {
  detail: unknown;
  expectedId: string;
  expectedRevision: number;
}): Web2JsonTemplateDetailV1 {
  const expected = details.get(input.expectedId);
  if (!expected || input.expectedRevision !== expected.template.revision) {
    throw new Error("Template identity or revision mismatch");
  }
  const detail = Web2JsonTemplateDetailV1Schema.parse(input.detail);
  const manifest = Web2JsonManifestV1Schema.parse(detail.manifest);
  const manifestCanonicalJson = canonicalJson(manifest);
  const digest = manifestSha256(manifestCanonicalJson);
  if (
    detail.template.id !== input.expectedId ||
    detail.template.revision !== input.expectedRevision ||
    detail.manifestCanonicalJson !== manifestCanonicalJson ||
    detail.template.manifestSha256 !== digest ||
    detail.provenance.manifestSha256 !== digest ||
    canonicalJson(detail) !== canonicalJson(expected)
  ) {
    throw new Error("Template manifest, provenance, or digest mismatch");
  }
  return deepFreeze(Web2JsonTemplateDetailV1Schema.parse({
    ...detail,
    manifest,
    manifestCanonicalJson,
  }));
}
