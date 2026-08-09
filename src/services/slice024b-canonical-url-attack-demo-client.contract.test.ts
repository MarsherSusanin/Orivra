// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { makeCanonicalUrlAttackDemoSummaryFixture } from "../test/slice024b-demo-fixture";

async function clientModule(): Promise<Record<string, any>> {
  const modulePath = "./canonical-url-attack-demo-client.ts";
  try {
    return await import(/* @vite-ignore */ modulePath) as Record<string, any>;
  } catch {
    return {};
  }
}

describe("Slice 024B token-free canonical URL attack demo client", () => {
  it("performs one exact same-origin summary GET without bearer, body or credentials", async () => {
    const module = await clientModule();
    expect(module.createCanonicalUrlAttackDemoClient).toBeTypeOf("function");
    const fetch = vi.fn().mockResolvedValue(Response.json(makeCanonicalUrlAttackDemoSummaryFixture()));
    const client = module.createCanonicalUrlAttackDemoClient({ fetch });
    await expect(client.getSummary()).resolves.toEqual(makeCanonicalUrlAttackDemoSummaryFixture());
    expect(fetch).toHaveBeenCalledOnce();
    const [target, init] = fetch.mock.calls[0];
    expect(new URL(String(target)).pathname).toBe("/api/v1/demo/canonical-url");
    expect(new URL(String(target)).origin).toBe("http://localhost");
    expect(init).toMatchObject({ method: "GET" });
    const headers = new Headers(init?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(init?.body).toBeUndefined();
  });

  it("strictly validates the public summary before exposing it", async () => {
    const module = await clientModule();
    expect(module.createCanonicalUrlAttackDemoClient).toBeTypeOf("function");
    const invalid: any = structuredClone(makeCanonicalUrlAttackDemoSummaryFixture());
    invalid.runs.attack.canonicalBundle = "{}";
    const client = module.createCanonicalUrlAttackDemoClient({
      fetch: vi.fn().mockResolvedValue(Response.json(invalid)),
    });
    await expect(client.getSummary()).rejects.toMatchObject({
      code: "CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE",
      message: "Canonical attack recording unavailable",
    });
  });

  it.each([503, 404, 500])("normalizes HTTP %s to one stable unavailable boundary", async (status) => {
    const module = await clientModule();
    expect(module.createCanonicalUrlAttackDemoClient).toBeTypeOf("function");
    const client = module.createCanonicalUrlAttackDemoClient({
      fetch: vi.fn().mockResolvedValue(new Response("hostile upstream detail", { status })),
    });
    await expect(client.getSummary()).rejects.toMatchObject({
      code: "CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE",
      message: "Canonical attack recording unavailable",
    });
  });

  it("normalizes transport failures without reflecting path, URL or server text", async () => {
    const module = await clientModule();
    expect(module.createCanonicalUrlAttackDemoClient).toBeTypeOf("function");
    const client = module.createCanonicalUrlAttackDemoClient({
      fetch: vi.fn().mockRejectedValue(new Error("fetch https://secret.invalid/source failed")),
    });
    const error = await client.getSummary().catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: "CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE",
      message: "Canonical attack recording unavailable",
    });
    expect(String(error)).not.toMatch(/secret\.invalid|source failed/);
  });

  it("derives the download link from the fixed same-origin API prefix only", async () => {
    const module = await clientModule();
    expect(module.canonicalUrlAttackRecordingDownloadHref).toBeTypeOf("function");
    expect(module.canonicalUrlAttackRecordingDownloadHref(
      makeCanonicalUrlAttackDemoSummaryFixture(),
    )).toBe("/api/v1/demo/canonical-url/recording");
  });
});
