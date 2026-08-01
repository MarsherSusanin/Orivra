// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  validPreflightReport,
} from "../../packages/contracts/test/fixtures";
import { createRunClient } from "./run-client";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;

function clientWith(body: unknown) {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const client = createRunClient({
    baseUrl: "https://control.proofline.test/api/",
    projectToken: PROJECT_TOKEN,
    fetch: fetch as any,
    storage: { getItem: vi.fn(() => null), setItem: vi.fn() },
  }) as any;
  expect(
    client.getPreflightReport,
    "Slice 016A requires a typed API-only preflight report client",
  ).toBeTypeOf("function");
  return { client, fetch };
}

describe("Slice 016A web preflight report client", () => {
  it("GETs and schema-validates the persisted report only from the Proofline API", async () => {
    const fixture = clientWith(validPreflightReport);

    await expect(
      fixture.client.getPreflightReport(RUN_ID),
    ).resolves.toEqual(validPreflightReport);

    expect(fixture.fetch).toHaveBeenCalledOnce();
    const [url, options] = fixture.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://control.proofline.test/api/v1/runs/${encodeURIComponent(RUN_ID)}/preflight`,
    );
    expect(url).not.toContain("api.example.com");
    expect(options).toMatchObject({ method: "GET" });
    const headers = options.headers as Headers;
    expect(headers.get("authorization")).toBe(`Bearer ${PROJECT_TOKEN}`);
    expect(headers.has("idempotency-key")).toBe(false);
    expect(options.body).toBeUndefined();
  });

  it("fails closed when the API returns a schema-invalid report", async () => {
    const fixture = clientWith({
      ...validPreflightReport,
      sampleFingerprints: validPreflightReport.sampleFingerprints.slice(0, 4),
    });

    await expect(
      fixture.client.getPreflightReport(RUN_ID),
    ).rejects.toThrow(/invalid.*preflight.*report|contract/i);
    expect(fixture.fetch).toHaveBeenCalledOnce();
  });

  it("accepts a run-scoped share credential without persisting or forwarding it elsewhere", async () => {
    const shareToken = `share_${"b".repeat(64)}`;
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
      new Response(JSON.stringify(validPreflightReport), { status: 200 }),
    );
    const client = createRunClient({
      baseUrl: "https://control.proofline.test/v1",
      projectToken: shareToken,
      fetch: fetch as any,
      storage,
    }) as any;
    expect(client.getPreflightReport).toBeTypeOf("function");

    await client.getPreflightReport(RUN_ID);

    expect(storage.setItem).not.toHaveBeenCalled();
    const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(shareToken);
    expect((options.headers as Headers).get("authorization")).toBe(
      `Bearer ${shareToken}`,
    );
  });
});
