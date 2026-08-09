// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@proofline/domain";
import {
  openMeteoTemplateDetail,
  templateCatalog,
} from "../../../test/slice025-template-fixtures";
import { createProoflineApi } from "../src/app";

const WEB_ORIGIN = "https://proofline.example";
const CACHE = "public, max-age=300, must-revalidate";

function etag(bytes: string): string {
  return `"sha256:${createHash("sha256").update(bytes).digest("hex")}"`;
}

function request(path: string, input: {
  method?: string;
  origin?: string;
  authorization?: string;
  ifNoneMatch?: string;
} = {}): Request {
  const headers = new Headers({ accept: "application/json" });
  if (input.origin) headers.set("origin", input.origin);
  if (input.authorization) headers.set("authorization", input.authorization);
  if (input.ifNoneMatch) headers.set("if-none-match", input.ifNoneMatch);
  return new Request(`https://api.proofline.test${path}`, {
    method: input.method ?? "GET",
    headers,
  });
}

function harness() {
  const service = {
    listNetworks: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    createRun: vi.fn(),
    fetchSource: vi.fn(),
    query: vi.fn(),
  };
  const authenticate = vi.fn(async () => null);
  return {
    service,
    authenticate,
    api: createProoflineApi({ service, authenticate, publicWebOrigin: WEB_ORIGIN }),
  };
}

function expectNoPorts(value: ReturnType<typeof harness>): void {
  expect(value.authenticate).not.toHaveBeenCalled();
  for (const port of Object.values(value.service)) {
    expect(port).not.toHaveBeenCalled();
  }
}

describe("Slice 025B anonymous static template API", () => {
  it.each([
    ["catalog", "/v1/templates", templateCatalog],
    ["detail", "/v1/templates/open-meteo-current-weather", openMeteoTemplateDetail],
  ] as const)("serves canonical %s bytes before bearer parsing", async (_name, path, value) => {
    const fixture = harness();
    const response = await fixture.api.fetch(request(path, {
      authorization: "Bearer not-a-valid-token",
    }));
    const expectedBytes = canonicalJson(value);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expectedBytes);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe(CACHE);
    expect(response.headers.get("etag")).toBe(etag(expectedBytes));
    expect(response.headers.get("content-location")).toBeNull();
    expectNoPorts(fixture);
  });

  it("uses a representation digest rather than the embedded manifest digest", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request("/v1/templates/open-meteo-current-weather"));
    expect(response.headers.get("etag")).toBe(etag(canonicalJson(openMeteoTemplateDetail)));
    expect(response.headers.get("etag")).not.toBe(`"${openMeteoTemplateDetail.template.manifestSha256}"`);
  });

  it.each([
    ["catalog", "/v1/templates", templateCatalog],
    ["detail", "/v1/templates/eth-usd", null],
  ] as const)("returns exact 304 for the %s representation", async (_name, path, explicitValue) => {
    const fixture = harness();
    const first = await fixture.api.fetch(request(path));
    expect(first.status).toBe(200);
    const firstBytes = await first.text();
    if (explicitValue) expect(firstBytes).toBe(canonicalJson(explicitValue));
    const firstEtag = first.headers.get("etag");
    expect(firstEtag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    const response = await fixture.api.fetch(request(path, { ifNoneMatch: firstEtag ?? "" }));
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe(firstEtag);
    expect(response.headers.get("cache-control")).toBe(CACHE);
    expectNoPorts(fixture);
  });

  it("does not treat weak, wildcard or wrong representation validators as exact", async () => {
    for (const validator of ["*", 'W/"sha256:' + "0".repeat(64) + '"', '"sha256:' + "0".repeat(64) + '"']) {
      const fixture = harness();
      const response = await fixture.api.fetch(request("/v1/templates", { ifNoneMatch: validator }));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(canonicalJson(templateCatalog));
      expectNoPorts(fixture);
    }
  });

  it.each([
    "/v1/templates?category=weather",
    "/v1/templates/open-meteo-current-weather?revision=1",
  ])("rejects query selection before auth or I/O: %s", async (path) => {
    const fixture = harness();
    const response = await fixture.api.fetch(request(path));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      version: "1",
      error: { code: "INVALID_TEMPLATE_QUERY", message: "Template queries are not allowed" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    expectNoPorts(fixture);
  });

  it.each([
    "/v1/templates/missing",
    "/v1/templates/",
    "/v1/templates/Open-Meteo",
    "/v1/templates/%2e%2e%2feth-usd",
    "/v1/templates/" + "a".repeat(65),
    "/v1/templates/eth-usd/revisions/1",
    "/v1/templates/eth-usd/",
  ])("returns one uniform bounded 404 without fallback for %s", async (path) => {
    const fixture = harness();
    const response = await fixture.api.fetch(request(path));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      version: "1",
      error: { code: "TEMPLATE_NOT_FOUND", message: "Template not found" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    expectNoPorts(fixture);
  });

  it.each(["HEAD", "POST", "PUT", "DELETE", "PATCH"])(
    "rejects %s before bearer parsing with deterministic Allow",
    async (method) => {
      const fixture = harness();
      const response = await fixture.api.fetch(request("/v1/templates/eth-usd", { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        version: "1",
        error: { code: "METHOD_NOT_ALLOWED", message: "Request rejected" },
      });
      expectNoPorts(fixture);
    },
  );

  it("grants only the exact configured Web origin on 200 and 304", async () => {
    const fixture = harness();
    const first = await fixture.api.fetch(request("/v1/templates", { origin: WEB_ORIGIN }));
    expect(first.status).toBe(200);
    expect(first.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(first.headers.get("vary")).toContain("Origin");
    const second = await fixture.api.fetch(request("/v1/templates", {
      origin: WEB_ORIGIN,
      ifNoneMatch: first.headers.get("etag") ?? "",
    }));
    expect(second.status).toBe(304);
    expect(second.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  });

  it.each([undefined, "https://proofline.example.evil.test"])(
    "keeps no CORS authority for Origin %j",
    async (origin) => {
      const fixture = harness();
      const response = await fixture.api.fetch(request("/v1/templates", { origin }));
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expectNoPorts(fixture);
    },
  );

  it("applies exact configured-origin CORS to bounded errors only", async () => {
    const allowed = harness();
    const response = await allowed.api.fetch(request("/v1/templates/missing", {
      origin: WEB_ORIGIN,
    }));
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectNoPorts(allowed);

    const hostile = harness();
    const denied = await hostile.api.fetch(request("/v1/templates/missing", {
      origin: "https://proofline.example.evil.test",
    }));
    expect(denied.status).toBe(404);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    expectNoPorts(hostile);
  });

  it("uses the existing exact-origin GET preflight boundary without dispatch", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(new Request(
      "https://api.proofline.test/v1/templates",
      {
        method: "OPTIONS",
        headers: {
          origin: WEB_ORIGIN,
          "access-control-request-method": "GET",
        },
      },
    ));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expectNoPorts(fixture);
  });
});
