// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  openMeteoTemplateDetail,
  templateCatalog,
} from "../../test/slice025-template-fixtures";

async function clientModule(): Promise<Record<string, any>> {
  const modulePath = "./template-catalog-client.ts";
  try {
    return await import(/* @vite-ignore */ modulePath) as Record<string, any>;
  } catch {
    return {};
  }
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("Slice 025C strict same-origin template catalog client", () => {
  it("loads the strict catalog with one anonymous same-origin GET", async () => {
    const module = await clientModule();
    expect(module.createTemplateCatalogClient).toBeTypeOf("function");
    const fetch = vi.fn(async (
      _target: RequestInfo | URL,
      _init?: RequestInit,
    ) => response(templateCatalog));
    const client = module.createTemplateCatalogClient({ fetch });
    await expect(client.listTemplates()).resolves.toEqual(templateCatalog);
    expect(fetch).toHaveBeenCalledOnce();
    const [target, init] = fetch.mock.calls[0];
    expect(new URL(String(target)).toString()).toBe("http://localhost/api/v1/templates");
    expect(init).toMatchObject({ method: "GET", credentials: "omit" });
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(init?.body).toBeUndefined();
  });

  it("validates catalog detailPath before loading and resolving exact detail", async () => {
    const module = await clientModule();
    expect(module.createTemplateCatalogClient).toBeTypeOf("function");
    const fetch = vi.fn<(target: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(templateCatalog))
      .mockResolvedValueOnce(response(openMeteoTemplateDetail));
    const client = module.createTemplateCatalogClient({ fetch });
    await expect(client.getTemplate({
      id: "open-meteo-current-weather",
      revision: 1,
    })).resolves.toEqual(openMeteoTemplateDetail);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetch.mock.calls[1][0])).toString()).toBe(
      "http://localhost/api/v1/templates/open-meteo-current-weather",
    );
    for (const call of fetch.mock.calls) {
      const target = new URL(String(call[0]));
      expect(target.origin).toBe("http://localhost");
      expect(target.pathname.startsWith("/api/v1/templates")).toBe(true);
      expect(new Headers(call[1]?.headers).has("authorization")).toBe(false);
    }
  });

  it("invokes an injected browser fetch with the global receiver", async () => {
    const module = await clientModule();
    expect(module.createTemplateCatalogClient).toBeTypeOf("function");
    const replies = [templateCatalog, openMeteoTemplateDetail];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    async function brandedFetch(
      this: unknown,
      target: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      calls.push([target, init]);
      return response(replies[calls.length - 1]);
    }
    const client = module.createTemplateCatalogClient({ fetch: brandedFetch });
    await expect(client.getTemplate({ id: "open-meteo-current-weather", revision: 1 }))
      .resolves.toEqual(openMeteoTemplateDetail);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["invalid ID", { id: "../eth-usd", revision: 1 }],
    ["wrong case", { id: "ETH-USD", revision: 1 }],
    ["zero revision", { id: "eth-usd", revision: 0 }],
    ["unsafe revision", { id: "eth-usd", revision: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s before any request", async (_name, input) => {
    const module = await clientModule();
    expect(module.createTemplateCatalogClient).toBeTypeOf("function");
    const fetch = vi.fn<(_target: RequestInfo | URL, _init?: RequestInit) => Promise<Response>>();
    const client = module.createTemplateCatalogClient({ fetch });
    await expect(client.getTemplate(input)).rejects.toMatchObject({
      code: "TEMPLATE_UNAVAILABLE",
      message: "Template unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["catalog extra field", { ...templateCatalog, sourceUrl: "https://api.open-meteo.com" }, openMeteoTemplateDetail],
    ["catalog path mismatch", { ...templateCatalog, templates: [{ ...templateCatalog.templates[0], detailPath: "https://api.open-meteo.com/v1/forecast" }, templateCatalog.templates[1]] }, openMeteoTemplateDetail],
    ["detail revision mismatch", templateCatalog, { ...openMeteoTemplateDetail, template: { ...openMeteoTemplateDetail.template, revision: 2 } }],
    ["detail digest mismatch", templateCatalog, { ...openMeteoTemplateDetail, provenance: { ...openMeteoTemplateDetail.provenance, manifestSha256: "sha256:" + "0".repeat(64) } }],
  ])("fails closed for %s without source-host fetch", async (_name, catalog, detail) => {
    const module = await clientModule();
    expect(module.createTemplateCatalogClient).toBeTypeOf("function");
    const fetch = vi.fn<(target: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(catalog))
      .mockResolvedValueOnce(response(detail));
    const client = module.createTemplateCatalogClient({ fetch });
    await expect(client.getTemplate({ id: "open-meteo-current-weather", revision: 1 }))
      .rejects.toMatchObject({ code: "TEMPLATE_UNAVAILABLE", message: "Template unavailable" });
    expect(fetch.mock.calls.every(([target]) => {
      const host = new URL(String(target)).hostname;
      return host !== "api.open-meteo.com" && host !== "api.coinbase.com";
    })).toBe(true);
  });

  it.each([404, 500, 503])("normalizes HTTP %s without reflecting server detail", async (status) => {
    const module = await clientModule();
    expect(module.createTemplateCatalogClient).toBeTypeOf("function");
    const client = module.createTemplateCatalogClient({
      fetch: vi.fn(async (_target: RequestInfo | URL, _init?: RequestInit) =>
        new Response("private source failure", { status })),
    });
    const error = await client.listTemplates().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "TEMPLATE_UNAVAILABLE", message: "Template unavailable" });
    expect(String(error)).not.toMatch(/private source failure/i);
  });

  it("normalizes transport failure without reflecting a source URL", async () => {
    const module = await clientModule();
    expect(module.createTemplateCatalogClient).toBeTypeOf("function");
    const client = module.createTemplateCatalogClient({
      fetch: vi.fn(async (_target: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error("fetch https://api.open-meteo.com failed");
      }),
    });
    const error = await client.listTemplates().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "TEMPLATE_UNAVAILABLE", message: "Template unavailable" });
    expect(String(error)).not.toMatch(/open-meteo/i);
  });
});
