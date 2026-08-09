// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@proofline/domain";
import { createProoflineApi } from "../src/app";
import {
  RECORDING_BYTES,
  RECORDING_SHA256,
  makeCanonicalUrlAttackDemoSummary,
} from "../../../packages/contracts/test/slice024b-canonical-url-attack-demo.fixtures";

const PUBLIC_ORIGIN = "https://proofline.example";
const UNAVAILABLE = {
  version: "1",
  error: {
    code: "CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE",
    message: "Canonical URL attack recording is unavailable",
  },
};

function etag(bytes: string): string {
  return `"sha256:${createHash("sha256").update(bytes).digest("hex")}"`;
}

function availableCache() {
  const summary = makeCanonicalUrlAttackDemoSummary();
  const summaryBytes = canonicalJson(summary);
  return {
    status: "available" as const,
    summary,
    summaryBytes,
    summaryEtag: etag(summaryBytes),
    recordingBytes: Buffer.from(RECORDING_BYTES, "utf8"),
    recordingSha256: RECORDING_SHA256,
    recordingEtag: `"${RECORDING_SHA256}"`,
  };
}

const CACHE_FIELDS = [
  "status",
  "summary",
  "summaryBytes",
  "summaryEtag",
  "recordingBytes",
  "recordingSha256",
  "recordingEtag",
] as const;

function observableCache(input: ReturnType<typeof availableCache> = availableCache()) {
  const backing: Record<(typeof CACHE_FIELDS)[number], any> = { ...input };
  let readsBlocked = false;
  const sourceSummary = backing.summary;
  backing.summary = new Proxy(sourceSummary, {
    get(target, property, receiver) {
      if (readsBlocked) throw new Error("cache summary reread after composition");
      return Reflect.get(target, property, receiver);
    },
  });
  const reads = Object.fromEntries(CACHE_FIELDS.map((field) => [field, 0])) as
    Record<(typeof CACHE_FIELDS)[number], number>;
  const cache = Object.fromEntries(CACHE_FIELDS.map((field) => [field, undefined])) as
    Record<(typeof CACHE_FIELDS)[number], unknown>;
  for (const field of CACHE_FIELDS) {
    Object.defineProperty(cache, field, {
      enumerable: true,
      get() {
        if (readsBlocked) throw new Error(`${field} reread after composition`);
        reads[field] += 1;
        return backing[field];
      },
    });
  }
  return {
    cache,
    reads,
    backing,
    blockReads() {
      readsBlocked = true;
    },
  };
}

function harness(state: unknown = availableCache()) {
  const authenticate = vi.fn().mockResolvedValue(null);
  const service = { listNetworks: vi.fn() };
  const api = createProoflineApi({
    service,
    authenticate,
    publicWebOrigin: PUBLIC_ORIGIN,
    canonicalUrlAttackDemo: state,
  } as any);
  return { api, authenticate, service };
}

function request(
  path: string,
  input: { method?: string; origin?: string; authorization?: string; etag?: string } = {},
) {
  const headers = new Headers();
  if (input.origin) headers.set("origin", input.origin);
  if (input.authorization) headers.set("authorization", input.authorization);
  if (input.etag) headers.set("if-none-match", input.etag);
  return new Request(`https://api.proofline.test${path}`, {
    method: input.method ?? "GET",
    headers,
  });
}

describe("Slice 024B anonymous canonical URL attack demo API", () => {
  it("validates and snapshots the private cache exactly once at composition", async () => {
    const expected = availableCache();
    const observed = observableCache();
    const fixture = harness(observed.cache);
    expect(observed.reads).toEqual(
      Object.fromEntries(CACHE_FIELDS.map((field) => [field, 1])),
    );

    const callerOwnedBytes = observed.backing.recordingBytes as Buffer;
    callerOwnedBytes.fill(0x78);
    observed.backing.summary = {
      ...makeCanonicalUrlAttackDemoSummary(),
      statement: "mutated after composition",
    };
    observed.backing.summaryBytes = "{}";
    observed.backing.summaryEtag = '"sha256:mutated"';
    observed.backing.recordingBytes = Buffer.from("mutated after composition");
    observed.backing.recordingSha256 = `sha256:${"0".repeat(64)}`;
    observed.backing.recordingEtag = `"sha256:${"0".repeat(64)}"`;
    observed.blockReads();
    const readsAtComposition = { ...observed.reads };

    const firstSummary = await fixture.api.fetch(request("/v1/demo/canonical-url"));
    const secondSummary = await fixture.api.fetch(request("/v1/demo/canonical-url"));
    const notModified = await fixture.api.fetch(request("/v1/demo/canonical-url", {
      etag: expected.summaryEtag,
    }));
    const download = await fixture.api.fetch(request(
      "/v1/demo/canonical-url/recording",
    ));

    expect(firstSummary.status).toBe(200);
    expect(await firstSummary.text()).toBe(expected.summaryBytes);
    expect(secondSummary.status).toBe(200);
    expect(await secondSummary.text()).toBe(expected.summaryBytes);
    expect(firstSummary.headers.get("etag")).toBe(expected.summaryEtag);
    expect(secondSummary.headers.get("etag")).toBe(expected.summaryEtag);
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(expected.summaryEtag);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(
      Buffer.from(RECORDING_BYTES),
    );
    expect(download.headers.get("etag")).toBe(expected.recordingEtag);
    expect(observed.reads).toEqual(readsAtComposition);
  });

  it("keeps cache validation, canonicalization and hashing out of the request path", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
    const responseStart = source.indexOf(
      "function canonicalUrlAttackDemoResponse(",
    );
    const responseEnd = source.indexOf("\nfunction isV1Path(", responseStart);
    expect(responseStart).toBeGreaterThanOrEqual(0);
    expect(responseEnd).toBeGreaterThan(responseStart);
    const responseSource = source.slice(responseStart, responseEnd);
    expect(responseSource).not.toMatch(
      /validatedCanonicalUrlAttackDemoCache|CanonicalUrlAttackDemoSummaryV1Schema|\.safeParse\s*\(|canonicalJson\s*\(|sha256Envelope\s*\(|createHash\s*\(/,
    );
  });

  it("serves the strict summary before bearer authentication", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request("/v1/demo/canonical-url", {
      authorization: "Bearer definitely-not-a-valid-token",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(makeCanonicalUrlAttackDemoSummary());
    expect(fixture.authenticate).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("etag")).toBe(availableCache().summaryEtag);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("downloads the exact stored bytes with exact media, length, digest and attachment identity", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request("/v1/demo/canonical-url/recording"));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(RECORDING_BYTES));
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.proofline.canonical-url-attack-recording.v1+json; charset=utf-8",
    );
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(RECORDING_BYTES)));
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("etag")).toBe(`"${RECORDING_SHA256}"`);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="canonical-url-attack-recording-${RECORDING_SHA256.slice(7)}.json"`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it.each(["/v1/demo/canonical-url", "/v1/demo/canonical-url/recording"])(
    "returns bodyless 304 only for that representation's exact If-None-Match on %s",
    async (path) => {
      const cache = availableCache();
      const expected = path.endsWith("recording") ? cache.recordingEtag : cache.summaryEtag;
      const response = await harness(cache).api.fetch(request(path, { etag: expected }));
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe(expected);
      expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    },
  );

  it("uses exact-origin CORS while allowing ordinary server-side requests without Origin", async () => {
    const allowed = await harness().api.fetch(request("/v1/demo/canonical-url", {
      origin: PUBLIC_ORIGIN,
    }));
    const server = await harness().api.fetch(request("/v1/demo/canonical-url"));
    const hostile = await harness().api.fetch(request("/v1/demo/canonical-url", {
      origin: "https://attacker.example",
    }));
    expect(allowed.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(allowed.headers.get("vary")).toMatch(/Origin/);
    expect(server.status).toBe(200);
    expect(server.headers.has("access-control-allow-origin")).toBe(false);
    expect(hostile.headers.has("access-control-allow-origin")).toBe(false);
  });

  it.each(["/v1/demo/canonical-url", "/v1/demo/canonical-url/recording"])(
    "returns the same bounded no-store 503 and no selection reason when %s is unavailable",
    async (path) => {
      const response = await harness({ status: "unavailable" }).api.fetch(request(path));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(UNAVAILABLE);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.has("etag")).toBe(false);
      expect(response.headers.has("retry-after")).toBe(false);
    },
  );

  it.each(["?sha256=latest", "?recording=fixture", "?x=1&x=2"])(
    "rejects demo selection query %s before auth or cached evidence read",
    async (query) => {
      const fixture = harness();
      const response = await fixture.api.fetch(request(`/v1/demo/canonical-url${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_CANONICAL_URL_ATTACK_DEMO_QUERY" },
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(fixture.authenticate).not.toHaveBeenCalled();
    },
  );

  it("also rejects download query selection before authentication", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request(
      "/v1/demo/canonical-url/recording?sha256=latest",
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_CANONICAL_URL_ATTACK_DEMO_QUERY" },
    });
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects unsupported %s deterministically before bearer authentication",
    async (method) => {
      const fixture = harness();
      const response = await fixture.api.fetch(request("/v1/demo/canonical-url", {
        method,
        authorization: `Bearer project_${"a".repeat(64)}`,
      }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
      expect(fixture.authenticate).not.toHaveBeenCalled();
    },
  );

  it("rejects HEAD on the exact download path instead of leaking metadata through another method", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request(
      "/v1/demo/canonical-url/recording",
      { method: "HEAD" },
    ));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it("normalizes an invalid injected cache before handling any request", async () => {
    const cache: any = availableCache();
    cache.summary = { ...cache.summary, authorization: "Bearer secret" };
    const observed = observableCache(cache);
    const fixture = harness(observed.cache);
    const readsAtComposition = { ...observed.reads };
    expect(Object.values(readsAtComposition).some((count) => count > 0)).toBe(true);
    observed.blockReads();
    const response = await fixture.api.fetch(request("/v1/demo/canonical-url"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(UNAVAILABLE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(observed.reads).toEqual(readsAtComposition);
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it("keeps a missing composed cache on the uniform unavailable path", async () => {
    const authenticate = vi.fn().mockResolvedValue(null);
    const api = createProoflineApi({
      service: { listNetworks: vi.fn() },
      authenticate,
      publicWebOrigin: PUBLIC_ORIGIN,
    });
    for (const path of [
      "/v1/demo/canonical-url",
      "/v1/demo/canonical-url/recording",
    ]) {
      const response = await api.fetch(request(path));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(UNAVAILABLE);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(authenticate).not.toHaveBeenCalled();
  });
});
