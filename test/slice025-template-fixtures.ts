import { canonicalJson } from "../packages/domain/src/canonical-json";

export const OPEN_METEO_MANIFEST_SHA256 =
  "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
export const ETH_USD_MANIFEST_SHA256 =
  "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
export const JSONPLACEHOLDER_TODO_MANIFEST_SHA256 =
  "sha256:c880b26572ba7d6a56ecea4a846126671c9310e3f02f5f6df04103817af1ed89";
export const SWAPI_C3PO_MANIFEST_SHA256 =
  "sha256:d49c140fe899a16587dff61000dd5a40405827ac09870b4d054e8247fb8f1d4b";

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

export const jsonPlaceholderTodoManifest = {
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
} as const;

export const swapiC3poManifest = {
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

export const jsonPlaceholderTodoTemplateSummary = {
  id: "jsonplaceholder-todo-1",
  revision: 1,
  title: "JSONPlaceholder todo",
  summary: "Verify the canonical first todo returned by JSONPlaceholder.",
  provider: "JSONPlaceholder",
  category: "reference",
  featured: false,
  manifestSha256: JSONPLACEHOLDER_TODO_MANIFEST_SHA256,
  detailPath: "/v1/templates/jsonplaceholder-todo-1",
} as const;

export const swapiC3poTemplateSummary = {
  id: "swapi-c3po",
  revision: 1,
  title: "SWAPI C-3PO profile",
  summary: "Verify C-3PO's stable public character record from SWAPI.",
  provider: "SWAPI",
  category: "reference",
  featured: false,
  manifestSha256: SWAPI_C3PO_MANIFEST_SHA256,
  detailPath: "/v1/templates/swapi-c3po",
} as const;

export const templateCatalog = {
  version: "1",
  kind: "web2json-template-catalog",
  catalogRevision: 2,
  templates: [
    openMeteoTemplateSummary,
    ethUsdTemplateSummary,
    jsonPlaceholderTodoTemplateSummary,
    swapiC3poTemplateSummary,
  ],
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

export const jsonPlaceholderTodoTemplateDetail = {
  version: "1",
  kind: "web2json-template-detail",
  template: jsonPlaceholderTodoTemplateSummary,
  manifest: jsonPlaceholderTodoManifest,
  manifestCanonicalJson: canonicalJson(jsonPlaceholderTodoManifest),
  provenance: {
    kind: "proofline-builtin",
    catalogRevision: 2,
    templateId: "jsonplaceholder-todo-1",
    templateRevision: 1,
    manifestSha256: JSONPLACEHOLDER_TODO_MANIFEST_SHA256,
  },
} as const;

export const swapiC3poTemplateDetail = {
  version: "1",
  kind: "web2json-template-detail",
  template: swapiC3poTemplateSummary,
  manifest: swapiC3poManifest,
  manifestCanonicalJson: canonicalJson(swapiC3poManifest),
  provenance: {
    kind: "proofline-builtin",
    catalogRevision: 2,
    templateId: "swapi-c3po",
    templateRevision: 1,
    manifestSha256: SWAPI_C3PO_MANIFEST_SHA256,
  },
} as const;
