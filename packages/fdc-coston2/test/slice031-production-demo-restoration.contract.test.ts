// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);

describe("Slice 031 production canonical URL demo restoration", () => {
  it("binds the checked-in safe consumer to the exact Open-Meteo template authority", async () => {
    const source = await readFile(
      new URL("contracts/CanonicalSafeWeb2JsonConsumer.sol", root),
      "utf8",
    );

    expect(source).toContain('requireHost(requestUrl, "api.open-meteo.com")');
    expect(source).toContain('requirePathPrefix(requestUrl, "/v1/forecast")');
    for (const [key, value] of [
      ["current", "temperature_2m"],
      ["forecast_days", "1"],
      ["latitude", "52.52"],
      ["longitude", "13.41"],
      ["temperature_unit", "celsius"],
      ["timezone", "UTC"],
    ]) {
      expect(source).toContain(`requireQueryValue(requestUrl, "${key}", "${value}")`);
    }
    expect(source).not.toMatch(/api\.example\.com|\/prices\/|currency|primary/);
  });

  it("ships one deterministic static attack response compatible with the Open-Meteo transform", async () => {
    const bytes = await readFile(
      new URL("examples/canonical-url-attack/attack-response.json", root),
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text);

    expect(text).toBe(`${JSON.stringify(value)}\n`);
    expect(value).toEqual({
      current: {
        temperature_2m: 21.5,
        time: "2026-08-15T05:00",
      },
    });
    expect(bytes.byteLength).toBeLessThan(1_024);
  });
});
