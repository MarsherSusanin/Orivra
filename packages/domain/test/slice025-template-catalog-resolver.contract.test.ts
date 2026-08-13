import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import * as Domain from "../src/index";
import { sha256Hex } from "../src/sha256";
import { canonicalJson } from "../src/canonical-json";

type Catalog = {
  version: "1";
  kind: "web2json-template-catalog";
  catalogRevision: 1;
  templates: Array<Record<string, unknown>>;
};

type Detail = {
  version: "1";
  kind: "web2json-template-detail";
  template: Record<string, unknown>;
  manifest: unknown;
  manifestCanonicalJson: string;
  provenance: Record<string, unknown>;
};

const api = Domain as unknown as {
  getWeb2JsonTemplateCatalog?: () => Catalog;
  getWeb2JsonTemplateDetail?: (id: string) => Detail | null;
  resolveWeb2JsonTemplate?: (input: {
    detail: unknown;
    expectedId: string;
    expectedRevision: number;
  }) => Detail;
};

function requireFunction<T extends (...args: never[]) => unknown>(
  value: T | undefined,
): T | undefined {
  expect(value).toBeTypeOf("function");
  return value;
}

function exactDigest(manifest: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(Web2JsonManifestV1Schema.parse(manifest)))}`;
}

function exportedFunctionBody(source: string, name: string): string {
  const declaration = `export function ${name}`;
  const start = source.indexOf(declaration);
  expect(
    start,
    `${name} must remain a named compatibility export`,
  ).toBeGreaterThanOrEqual(0);
  if (start < 0) return "";
  const openingBrace = source.indexOf("{", start);
  expect(openingBrace).toBeGreaterThan(start);
  if (openingBrace < 0) return "";

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to isolate ${name} source body.`);
}

describe("Slice 025A static template catalog and resolver", () => {
  it("publishes the exact ordered catalog with Open-Meteo featured first", () => {
    const getCatalog = requireFunction(api.getWeb2JsonTemplateCatalog);
    if (!getCatalog) return;
    const catalog = getCatalog();
    expect(catalog).toMatchObject({
      version: "1",
      kind: "web2json-template-catalog",
      catalogRevision: 1,
    });
    expect(catalog.templates.map(({ id, revision, featured }) => ({ id, revision, featured }))).toEqual([
      { id: "open-meteo-current-weather", revision: 1, featured: true },
      { id: "eth-usd", revision: 1, featured: false },
    ]);
  });

  it("binds the exact Berlin current-temperature manifest, canonical bytes and digest", () => {
    const getDetail = requireFunction(api.getWeb2JsonTemplateDetail);
    if (!getDetail) return;
    const detail = getDetail("open-meteo-current-weather");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const manifest = Web2JsonManifestV1Schema.parse(detail.manifest);
    expect(manifest).toEqual({
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
    });
    expect(detail.manifestCanonicalJson).toBe(canonicalJson(manifest));
    expect(exactDigest(manifest)).toBe("sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898");
    expect(detail.template.manifestSha256).toBe(exactDigest(manifest));
    expect(detail.provenance).toEqual({
      kind: "proofline-builtin",
      catalogRevision: 1,
      templateId: "open-meteo-current-weather",
      templateRevision: 1,
      manifestSha256: exactDigest(manifest),
    });
  });

  it("preserves the exact Slice 015 ETH/USD template under the canonical stable ID", () => {
    const getDetail = requireFunction(api.getWeb2JsonTemplateDetail);
    if (!getDetail) return;
    const detail = getDetail("eth-usd");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const caller = {
      updatedAt: "2026-08-10T00:00:00.000Z",
      createIdempotencyKey: "composer_00000000-0000-4000-8000-000000000000",
    };
    const expectedDraft = Domain.createEthUsdComposerDraft(caller);
    const finalized = Domain.finalizeWeb2JsonManifestDraft(expectedDraft);
    expect(finalized.valid).toBe(true);
    if (!finalized.valid) return;
    expect(detail.manifest).toEqual(finalized.manifest);
    expect(detail.manifestCanonicalJson).toBe(finalized.canonicalJson);
    expect(exactDigest(detail.manifest)).toBe("sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db");
    expect(expectedDraft).toEqual(
      Domain.importWeb2JsonManifestDraft({ ...caller, manifest: detail.manifest }),
    );
    expect(expectedDraft.updatedAt).toBe(caller.updatedAt);
    expect(expectedDraft.createIdempotencyKey).toBe(
      caller.createIdempotencyKey,
    );
    const freshCaller = {
      updatedAt: "2026-08-10T00:00:01.000Z",
      createIdempotencyKey:
        "composer_11111111-1111-4111-8111-111111111111",
    };
    const freshDraft = Domain.createEthUsdComposerDraft(freshCaller);
    expect(freshDraft.fields).toEqual(expectedDraft.fields);
    expect(freshDraft.updatedAt).toBe(freshCaller.updatedAt);
    expect(freshDraft.createIdempotencyKey).toBe(
      freshCaller.createIdempotencyKey,
    );
  });

  it("delegates the ETH/USD compatibility helper without embedding a second manifest", () => {
    const source = readFileSync(
      new URL("../src/manifest-composer.ts", import.meta.url),
      "utf8",
    );
    const body = exportedFunctionBody(source, "createEthUsdComposerDraft");

    expect(body).toMatch(/getWeb2JsonTemplateDetail\(\s*["']eth-usd["']\s*\)/);
    expect(body).toMatch(/resolveWeb2JsonTemplate\s*\(/);
    expect(source).not.toMatch(
      /api\.coinbase\.com|ETH-USD|\.data\s*\|\s*\{amount|internalType["']:\s*["']string["'],["']name["']:\s*["']amount/,
    );
    expect(body).not.toMatch(
      /attestationType|request\s*:|consumer\s*:|submission\s*:|url\s*:|jq\s*:|abiSignature\s*:|expectedHost|expectedPathPrefix|feeCapWei/,
    );
  });

  it.each(["", "Open-Meteo", "../eth-usd", "a".repeat(65), "missing"])(
    "returns no detail and no fallback for invalid or unknown ID %j",
    (id) => {
      const getDetail = requireFunction(api.getWeb2JsonTemplateDetail);
      if (!getDetail) return;
      expect(getDetail(id)).toBeNull();
    },
  );

  it("reparses canonical material and accepts an exact independently cloned detail", () => {
    const getDetail = requireFunction(api.getWeb2JsonTemplateDetail);
    const resolve = requireFunction(api.resolveWeb2JsonTemplate);
    if (!getDetail || !resolve) return;
    const raw = structuredClone(getDetail("open-meteo-current-weather"));
    expect(resolve({ detail: raw, expectedId: "open-meteo-current-weather", expectedRevision: 1 })).toEqual(raw);
  });

  it.each([
    ["summary ID", (value: Detail) => { value.template.id = "eth-usd"; }],
    ["summary revision", (value: Detail) => { value.template.revision = 2; }],
    ["summary digest", (value: Detail) => { value.template.manifestSha256 = "sha256:" + "0".repeat(64); }],
    ["detail path", (value: Detail) => { value.template.detailPath = "/v1/templates/eth-usd"; }],
    ["provenance ID", (value: Detail) => { value.provenance.templateId = "eth-usd"; }],
    ["provenance revision", (value: Detail) => { value.provenance.templateRevision = 2; }],
    ["provenance digest", (value: Detail) => { value.provenance.manifestSha256 = "sha256:" + "f".repeat(64); }],
    ["canonical manifest bytes", (value: Detail) => { value.manifestCanonicalJson += " "; }],
    ["manifest", (value: Detail) => {
      const manifest = value.manifest as { request: { query: Record<string, string> } };
      manifest.request.query.latitude = "48.85";
    }],
  ])("rejects mix-and-match %s", (_name, mutate) => {
    const getDetail = requireFunction(api.getWeb2JsonTemplateDetail);
    const resolve = requireFunction(api.resolveWeb2JsonTemplate);
    if (!getDetail || !resolve) return;
    const value = structuredClone(getDetail("open-meteo-current-weather")) as Detail;
    mutate(value);
    expect(() => resolve({ detail: value, expectedId: "open-meteo-current-weather", expectedRevision: 1 })).toThrow(/template|manifest|provenance|digest|canonical|invalid|mismatch/i);
  });

  it("rejects a mismatched requested revision instead of selecting latest", () => {
    const getDetail = requireFunction(api.getWeb2JsonTemplateDetail);
    const resolve = requireFunction(api.resolveWeb2JsonTemplate);
    if (!getDetail || !resolve) return;
    expect(() => resolve({
      detail: getDetail("open-meteo-current-weather"),
      expectedId: "open-meteo-current-weather",
      expectedRevision: 2,
    })).toThrow(/revision|template|mismatch/i);
  });

  it("returns defensive immutable snapshots", () => {
    const getCatalog = requireFunction(api.getWeb2JsonTemplateCatalog);
    const getDetail = requireFunction(api.getWeb2JsonTemplateDetail);
    if (!getCatalog || !getDetail) return;
    const catalog = getCatalog();
    const detail = getDetail("open-meteo-current-weather");
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.templates)).toBe(true);
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail?.manifest)).toBe(true);
    expect(getWeb2JsonTemplateCatalogAgain(getCatalog)).toEqual(catalog);
  });

  it("keeps the catalog module pure and free of persistence or network composition", () => {
    const source = readFileSync(new URL("../src/web2json-template-catalog.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:fs|node:http|node:https|fetch\s*\(|postgres|redis|process\.|Date\s*\(|Math\.random/i);
  });
});

function getWeb2JsonTemplateCatalogAgain(getCatalog: () => Catalog): Catalog {
  return getCatalog();
}
// @vitest-environment node
