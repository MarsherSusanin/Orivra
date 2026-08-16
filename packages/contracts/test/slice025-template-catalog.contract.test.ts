import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";

type Schema = {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean; data?: unknown };
};

const schemas = Contracts as unknown as {
  Web2JsonTemplateProvenanceV1Schema?: Schema;
  Web2JsonTemplateSummaryV1Schema?: Schema;
  Web2JsonTemplateCatalogV1Schema?: Schema;
  Web2JsonTemplateDetailV1Schema?: Schema;
};

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
} as const;

const manifestSha256 =
  "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";

const summary = {
  id: "open-meteo-current-weather",
  revision: 1,
  title: "Berlin current temperature",
  summary: "Verify the current temperature reported by Open-Meteo for Berlin.",
  provider: "Open-Meteo",
  category: "weather",
  featured: true,
  manifestSha256,
  detailPath: "/v1/templates/open-meteo-current-weather",
} as const;

const provenance = {
  kind: "proofline-builtin",
  catalogRevision: 1,
  templateId: summary.id,
  templateRevision: 1,
  manifestSha256,
} as const;

const detail = {
  version: "1",
  kind: "web2json-template-detail",
  template: summary,
  manifest: openMeteoManifest,
  manifestCanonicalJson: JSON.stringify(openMeteoManifest),
  provenance,
} as const;

function requireSchema(value: Schema | undefined): Schema | undefined {
  expect(value).toBeDefined();
  return value;
}

describe("Slice 025A public template contracts", () => {
  it("accepts only the bounded exact built-in provenance shape", () => {
    const schema = requireSchema(schemas.Web2JsonTemplateProvenanceV1Schema);
    if (!schema) return;
    expect(schema.parse(provenance)).toEqual(provenance);
    expect(schema.safeParse({ ...provenance, sourceResponse: "secret" }).success).toBe(false);
    expect(schema.safeParse({ ...provenance, kind: "remote" }).success).toBe(false);
  });

  it("accepts the exact featured Open-Meteo summary", () => {
    const schema = requireSchema(schemas.Web2JsonTemplateSummaryV1Schema);
    if (!schema) return;
    expect(schema.parse(summary)).toEqual(summary);
  });

  it("accepts additive reference templates and positive catalog revisions", () => {
    const summarySchema = requireSchema(schemas.Web2JsonTemplateSummaryV1Schema);
    const provenanceSchema = requireSchema(schemas.Web2JsonTemplateProvenanceV1Schema);
    if (!summarySchema || !provenanceSchema) return;
    const reference = {
      ...summary,
      id: "swapi-c3po",
      title: "SWAPI C-3PO profile",
      provider: "SWAPI",
      category: "reference",
      featured: false,
      detailPath: "/v1/templates/swapi-c3po",
    };
    expect(summarySchema.parse(reference)).toEqual(reference);
    expect(provenanceSchema.parse({
      ...provenance,
      catalogRevision: 2,
      templateId: reference.id,
    })).toEqual({
      ...provenance,
      catalogRevision: 2,
      templateId: reference.id,
    });
  });

  it.each([
    ["extra fields", { ...summary, responseBody: "{}" }],
    ["uppercase ID", { ...summary, id: "Open-Meteo" }],
    ["oversize ID", { ...summary, id: "a".repeat(65) }],
    ["zero revision", { ...summary, revision: 0 }],
    ["unknown category", { ...summary, category: "other" }],
    ["wrong digest case", { ...summary, manifestSha256: manifestSha256.toUpperCase() }],
    ["mismatched detail path", { ...summary, detailPath: "/v1/templates/eth-usd" }],
    ["oversize provider", { ...summary, provider: "x".repeat(81) }],
  ])("rejects summary %s", (_name, value) => {
    const schema = requireSchema(schemas.Web2JsonTemplateSummaryV1Schema);
    if (!schema) return;
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("accepts a strict detail containing the strict manifest", () => {
    const schema = requireSchema(schemas.Web2JsonTemplateDetailV1Schema);
    if (!schema) return;
    expect(schema.parse(detail)).toEqual(detail);
  });

  it.each([
    ["unknown detail field", { ...detail, rawSource: "{}" }],
    ["manifest credentials", {
      ...detail,
      manifest: {
        ...openMeteoManifest,
        request: { ...openMeteoManifest.request, url: "https://token@api.open-meteo.com/v1/forecast" },
      },
    }],
    ["provenance revision mismatch", {
      ...detail,
      provenance: { ...provenance, templateRevision: 2 },
    }],
  ])("rejects %s", (_name, value) => {
    const schema = requireSchema(schemas.Web2JsonTemplateDetailV1Schema);
    if (!schema) return;
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("accepts the ordered one-featured catalog envelope", () => {
    const schema = requireSchema(schemas.Web2JsonTemplateCatalogV1Schema);
    if (!schema) return;
    const value = {
      version: "1",
      kind: "web2json-template-catalog",
      catalogRevision: 1,
      templates: [summary, { ...summary, id: "eth-usd", title: "ETH/USD spot price", summary: "Verify Coinbase's ETH/USD spot price response.", provider: "Coinbase", category: "finance", featured: false, manifestSha256: "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db", detailPath: "/v1/templates/eth-usd" }],
    };
    expect(schema.parse(value)).toEqual(value);
  });

  it.each([
    ["duplicate IDs", [summary, { ...summary, featured: false }]],
    ["two featured items", [summary, { ...summary, id: "eth-usd", detailPath: "/v1/templates/eth-usd" }]],
    ["no featured item", [{ ...summary, featured: false }]],
    ["wrong featured order", [{ ...summary, featured: false }, { ...summary, id: "eth-usd", detailPath: "/v1/templates/eth-usd", featured: true }]],
  ])("rejects catalog with %s", (_name, templates) => {
    const schema = requireSchema(schemas.Web2JsonTemplateCatalogV1Schema);
    if (!schema) return;
    expect(schema.safeParse({ version: "1", kind: "web2json-template-catalog", catalogRevision: 1, templates }).success).toBe(false);
  });

  it("rejects non-featured templates outside canonical ID order", () => {
    const schema = requireSchema(schemas.Web2JsonTemplateCatalogV1Schema);
    if (!schema) return;
    const later = { ...summary, id: "swapi-c3po", detailPath: "/v1/templates/swapi-c3po", featured: false };
    const earlier = { ...summary, id: "eth-usd", detailPath: "/v1/templates/eth-usd", featured: false };
    expect(schema.safeParse({
      version: "1",
      kind: "web2json-template-catalog",
      catalogRevision: 2,
      templates: [summary, later, earlier],
    }).success).toBe(false);
  });

  it("rejects duplicate non-featured IDs while exercising equality ordering", () => {
    const schema = requireSchema(schemas.Web2JsonTemplateCatalogV1Schema);
    if (!schema) return;
    const duplicate = {
      ...summary,
      id: "eth-usd",
      detailPath: "/v1/templates/eth-usd",
      featured: false,
    };
    expect(schema.safeParse({
      version: "1",
      kind: "web2json-template-catalog",
      catalogRevision: 2,
      templates: [summary, duplicate, { ...duplicate }],
    }).success).toBe(false);
  });

  it("rejects oversized public representations rather than arbitrary metadata", () => {
    const schema = requireSchema(schemas.Web2JsonTemplateSummaryV1Schema);
    if (!schema) return;
    expect(schema.safeParse({ ...summary, summary: "x".repeat(241) }).success).toBe(false);
    expect(schema.safeParse({ ...summary, title: "x".repeat(81) }).success).toBe(false);

    const detailSchema = requireSchema(schemas.Web2JsonTemplateDetailV1Schema);
    if (!detailSchema) return;
    expect(detailSchema.safeParse({
      ...detail,
      manifestCanonicalJson: "x".repeat(65_537),
    }).success).toBe(false);
  });
});
