import {
  Web2JsonTemplateCatalogV1Schema,
  Web2JsonTemplateDetailV1Schema,
  type Web2JsonTemplateCatalogV1,
  type Web2JsonTemplateDetailV1,
} from "@proofline/contracts/templates";
import { Web2JsonManifestV1Schema } from "@proofline/contracts/manifest";
import { canonicalJson } from "./canonical-json";
import { sha256Hex } from "./sha256";

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

const jsonPlaceholderTodoManifest = {
  version: "1",
  attestationType: "Web2Json",
  network: "coston2",
  request: {
    method: "GET",
    url: "https://jsonplaceholder.typicode.com/todos/1",
    query: {},
    jq: ". | {userId: .userId, id: .id, title: .title, completed: .completed}",
    abiSignature:
      '{"components":[{"internalType":"uint256","name":"userId","type":"uint256"},{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"string","name":"title","type":"string"},{"internalType":"bool","name":"completed","type":"bool"}],"name":"data","type":"tuple"}',
  },
  consumer: {
    expectedScheme: "https",
    expectedHost: "jsonplaceholder.typicode.com",
    expectedPathPrefix: "/todos/1",
    expectedQuery: {},
  },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
};

const swapiC3poManifest = {
  version: "1",
  attestationType: "Web2Json",
  network: "coston2",
  request: {
    method: "GET",
    url: "https://swapi.info/api/people/3",
    query: {},
    jq: ". | {name: .name, height: .height, mass: .mass, numberOfFilms: (.films | length)}",
    abiSignature:
      '{"components":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"height","type":"string"},{"internalType":"string","name":"mass","type":"string"},{"internalType":"uint256","name":"numberOfFilms","type":"uint256"}],"name":"data","type":"tuple"}',
  },
  consumer: {
    expectedScheme: "https",
    expectedHost: "swapi.info",
    expectedPathPrefix: "/api/people/3",
    expectedQuery: {},
  },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
};

function createDetail(input: {
  id: "open-meteo-current-weather" | "eth-usd" | "jsonplaceholder-todo-1" | "swapi-c3po";
  title: string;
  summary: string;
  provider: string;
  category: "finance" | "reference" | "weather";
  featured: boolean;
  catalogRevision: number;
  manifest: unknown;
}): Web2JsonTemplateDetailV1 {
  const manifest = Web2JsonManifestV1Schema.parse(input.manifest);
  const manifestCanonicalJson = canonicalJson(manifest);
  const digest = manifestSha256(manifestCanonicalJson);
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
      manifestSha256: digest,
      detailPath: `/v1/templates/${input.id}`,
    },
    manifest,
    manifestCanonicalJson,
    provenance: {
      kind: "proofline-builtin",
      catalogRevision: input.catalogRevision,
      templateId: input.id,
      templateRevision: 1,
      manifestSha256: digest,
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
  catalogRevision: 1,
  manifest: openMeteoManifest,
});

const ethUsdDetail = createDetail({
  id: "eth-usd",
  title: "ETH/USD spot price",
  summary: "Verify Coinbase's ETH/USD spot price response.",
  provider: "Coinbase",
  category: "finance",
  featured: false,
  catalogRevision: 1,
  manifest: ethUsdManifest,
});

const jsonPlaceholderTodoDetail = createDetail({
  id: "jsonplaceholder-todo-1",
  title: "JSONPlaceholder todo",
  summary: "Verify the canonical first todo returned by JSONPlaceholder.",
  provider: "JSONPlaceholder",
  category: "reference",
  featured: false,
  catalogRevision: 2,
  manifest: jsonPlaceholderTodoManifest,
});

const swapiC3poDetail = createDetail({
  id: "swapi-c3po",
  title: "SWAPI C-3PO profile",
  summary: "Verify C-3PO's stable public character record from SWAPI.",
  provider: "SWAPI",
  category: "reference",
  featured: false,
  catalogRevision: 2,
  manifest: swapiC3poManifest,
});

const catalog = deepFreeze(Web2JsonTemplateCatalogV1Schema.parse({
  version: "1",
  kind: "web2json-template-catalog",
  catalogRevision: 2,
  templates: [
    openMeteoDetail.template,
    ethUsdDetail.template,
    jsonPlaceholderTodoDetail.template,
    swapiC3poDetail.template,
  ],
}));
const details = new Map<string, Web2JsonTemplateDetailV1>([
  [openMeteoDetail.template.id, deepFreeze(openMeteoDetail)],
  [ethUsdDetail.template.id, deepFreeze(ethUsdDetail)],
  [jsonPlaceholderTodoDetail.template.id, deepFreeze(jsonPlaceholderTodoDetail)],
  [swapiC3poDetail.template.id, deepFreeze(swapiC3poDetail)],
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
