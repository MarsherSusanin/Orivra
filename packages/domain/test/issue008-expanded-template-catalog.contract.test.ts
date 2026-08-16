import { describe, expect, it } from "vitest";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import {
  getWeb2JsonTemplateCatalog,
  getWeb2JsonTemplateDetail,
  resolveWeb2JsonTemplate,
} from "../src/web2json-template-catalog";
import { canonicalJson } from "../src/canonical-json";
import { sha256Hex } from "../src/sha256";

const EXPECTED_TEMPLATES = [
  {
    id: "open-meteo-current-weather",
    featured: true,
    category: "weather",
    catalogRevision: 1,
  },
  {
    id: "eth-usd",
    featured: false,
    category: "finance",
    catalogRevision: 1,
  },
  {
    id: "jsonplaceholder-todo-1",
    featured: false,
    category: "reference",
    catalogRevision: 2,
  },
  {
    id: "swapi-c3po",
    featured: false,
    category: "reference",
    catalogRevision: 2,
  },
] as const;

function digest(value: unknown): string {
  const manifest = Web2JsonManifestV1Schema.parse(value);
  return `sha256:${sha256Hex(canonicalJson(manifest))}`;
}

describe("Issue #8 expanded immutable Web2Json template catalog", () => {
  it("publishes revision 2 in deterministic featured-then-ID order", () => {
    const catalog = getWeb2JsonTemplateCatalog();

    expect(catalog.catalogRevision).toBe(2);
    expect(catalog.templates.map(({ id, featured, category }) => ({
      id,
      featured,
      category,
    }))).toEqual(EXPECTED_TEMPLATES.map(({ catalogRevision: _ignored, ...summary }) => summary));
  });

  it.each(EXPECTED_TEMPLATES)(
    "cross-binds immutable detail $id to its manifest and introduction revision",
    ({ id, catalogRevision }) => {
      const detail = getWeb2JsonTemplateDetail(id);
      expect(detail).not.toBeNull();
      if (!detail) return;

      expect(detail.template.revision).toBe(1);
      expect(detail.provenance).toEqual({
        kind: "proofline-builtin",
        catalogRevision,
        templateId: id,
        templateRevision: 1,
        manifestSha256: digest(detail.manifest),
      });
      expect(detail.template.manifestSha256).toBe(digest(detail.manifest));
      expect(detail.manifestCanonicalJson).toBe(canonicalJson(detail.manifest));
      expect(resolveWeb2JsonTemplate({
        detail: structuredClone(detail),
        expectedId: id,
        expectedRevision: 1,
      })).toEqual(detail);
    },
  );

  it("binds the JSONPlaceholder todo example to an exact replay-only request", () => {
    const manifest = getWeb2JsonTemplateDetail("jsonplaceholder-todo-1")?.manifest;
    expect(manifest).toEqual({
      version: "1",
      attestationType: "Web2Json",
      network: "coston2",
      request: {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/todos/1",
        query: {},
        jq: ". | {userId: .userId, id: .id, title: .title, completed: .completed}",
        abiSignature: "{\"components\":[{\"internalType\":\"uint256\",\"name\":\"userId\",\"type\":\"uint256\"},{\"internalType\":\"uint256\",\"name\":\"id\",\"type\":\"uint256\"},{\"internalType\":\"string\",\"name\":\"title\",\"type\":\"string\"},{\"internalType\":\"bool\",\"name\":\"completed\",\"type\":\"bool\"}],\"name\":\"data\",\"type\":\"tuple\"}",
      },
      consumer: {
        expectedScheme: "https",
        expectedHost: "jsonplaceholder.typicode.com",
        expectedPathPrefix: "/todos/1",
        expectedQuery: {},
      },
      submission: { mode: "replay", feeCapWei: "20000000000000000" },
    });
  });

  it("binds the SWAPI C-3PO example to an exact replay-only request", () => {
    const manifest = getWeb2JsonTemplateDetail("swapi-c3po")?.manifest;
    expect(manifest).toEqual({
      version: "1",
      attestationType: "Web2Json",
      network: "coston2",
      request: {
        method: "GET",
        url: "https://swapi.info/api/people/3",
        query: {},
        jq: ". | {name: .name, height: .height, mass: .mass, numberOfFilms: (.films | length)}",
        abiSignature: "{\"components\":[{\"internalType\":\"string\",\"name\":\"name\",\"type\":\"string\"},{\"internalType\":\"string\",\"name\":\"height\",\"type\":\"string\"},{\"internalType\":\"string\",\"name\":\"mass\",\"type\":\"string\"},{\"internalType\":\"uint256\",\"name\":\"numberOfFilms\",\"type\":\"uint256\"}],\"name\":\"data\",\"type\":\"tuple\"}",
      },
      consumer: {
        expectedScheme: "https",
        expectedHost: "swapi.info",
        expectedPathPrefix: "/api/people/3",
        expectedQuery: {},
      },
      submission: { mode: "replay", feeCapWei: "20000000000000000" },
    });
  });
});
