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
const HOSTILE_ORIGIN = "https://proofline.example.evil.test";
const CACHE = "public, max-age=300, must-revalidate";

function etag(bytes: string): string {
  return `"sha256:${createHash("sha256").update(bytes).digest("hex")}"`;
}

function request(path: string, input: {
  origin?: string;
  ifNoneMatch?: string;
} = {}): Request {
  const headers = new Headers({
    accept: "application/json",
    authorization: "Bearer deliberately-invalid",
  });
  if (input.origin) headers.set("origin", input.origin);
  if (input.ifNoneMatch) headers.set("if-none-match", input.ifNoneMatch);
  return new Request(`https://api.proofline.test${path}`, { headers });
}

function harness(configureWebOrigin = true) {
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
    api: createProoflineApi({
      service,
      authenticate,
      ...(configureWebOrigin ? { publicWebOrigin: WEB_ORIGIN } : {}),
    }),
  };
}

function expectNoPorts(value: ReturnType<typeof harness>): void {
  expect(value.authenticate).not.toHaveBeenCalled();
  for (const port of Object.values(value.service)) {
    expect(port).not.toHaveBeenCalled();
  }
}

function varyTokens(response: Response): string[] {
  return (response.headers.get("vary") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

const representations = [
  ["catalog", "/v1/templates", templateCatalog],
  ["detail", "/v1/templates/open-meteo-current-weather", openMeteoTemplateDetail],
] as const;

const origins = [
  ["absent", undefined, null],
  ["configured", WEB_ORIGIN, WEB_ORIGIN],
  ["hostile", HOSTILE_ORIGIN, null],
] as const;

const variants = ["200", "304"] as const;

describe("Slice 026 template cache variants", () => {
  it.each(
    representations.flatMap(([representation, path, value]) =>
      variants.flatMap((status) =>
        origins.map(([originName, origin, allowedOrigin]) => [
          representation,
          status,
          originName,
          path,
          value,
          origin,
          allowedOrigin,
        ] as const),
      ),
    ),
  )(
    "varies the %s %s response for %s Origin",
    async (_representation, status, _originName, path, value, origin, allowedOrigin) => {
      const fixture = harness();
      const expectedBytes = canonicalJson(value);
      const expectedEtag = etag(expectedBytes);
      const response = await fixture.api.fetch(request(path, {
        origin,
        ifNoneMatch: status === "304" ? expectedEtag : undefined,
      }));

      expect(response.status).toBe(Number(status));
      expect(response.headers.get("cache-control")).toBe(CACHE);
      expect(response.headers.get("etag")).toBe(expectedEtag);
      expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
      expect(varyTokens(response).filter((token) => token === "origin")).toEqual(["origin"]);

      if (status === "200") {
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        expect(await response.text()).toBe(expectedBytes);
      } else {
        expect(await response.text()).toBe("");
      }
      expectNoPorts(fixture);
    },
  );

  it("does not invent CORS authority or mandatory variation when no Web origin is configured", async () => {
    const fixture = harness(false);
    const response = await fixture.api.fetch(request("/v1/templates", {
      origin: WEB_ORIGIN,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(varyTokens(response)).not.toContain("origin");
    expect(await response.text()).toBe(canonicalJson(templateCatalog));
    expectNoPorts(fixture);
  });
});
