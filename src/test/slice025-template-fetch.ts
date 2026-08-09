import { vi } from "vitest";
import {
  ethUsdTemplateDetail,
  openMeteoTemplateDetail,
  templateCatalog,
} from "../../test/slice025-template-fixtures";

export function installTemplateCatalogFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (target: RequestInfo | URL) => {
      const url = new URL(String(target), globalThis.location?.origin ?? "http://localhost");
      if (url.pathname === "/api/v1/templates") return Response.json(templateCatalog);
      if (url.pathname === "/api/v1/templates/eth-usd") {
        return Response.json(ethUsdTemplateDetail);
      }
      if (url.pathname === "/api/v1/templates/open-meteo-current-weather") {
        return Response.json(openMeteoTemplateDetail);
      }
      throw new Error(`Unexpected browser request ${url.pathname}`);
    },
  );
}

export function expectOnlyTemplateCatalogFetches(
  fetch: ReturnType<typeof installTemplateCatalogFetch>,
): void {
  for (const [target, init] of fetch.mock.calls) {
    const url = new URL(String(target), globalThis.location?.origin ?? "http://localhost");
    expect(url.origin).toBe(globalThis.location?.origin ?? "http://localhost");
    expect(url.pathname.startsWith("/api/v1/templates")).toBe(true);
    expect(url.hostname).not.toBe("api.coinbase.com");
    expect(url.hostname).not.toBe("api.open-meteo.com");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  }
}
