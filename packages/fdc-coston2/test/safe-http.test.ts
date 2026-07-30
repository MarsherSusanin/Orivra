// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  assertPublicIpAddress,
  assertSafeWeb2JsonUrl,
  createSafeHttpFetcher,
} from "../src/safe-http";

const PUBLIC_V4 = "93.184.216.34";

describe("safe Web2Json URL policy", () => {
  it.each([
    "http://example.com/data",
    "https://example.com:444/data",
    "https://user:secret@example.com/data",
    "https://example.com/data#fragment",
    "ftp://example.com/data",
    "not a url",
  ])("rejects an unsafe source URL: %s", (url) => {
    expect(() => assertSafeWeb2JsonUrl(url)).toThrow();
  });

  it("accepts only an HTTPS URL on the default or explicit 443 port", () => {
    expect(assertSafeWeb2JsonUrl("https://example.com/data").href).toBe(
      "https://example.com/data",
    );
    expect(assertSafeWeb2JsonUrl("https://example.com:443/data").port).toBe("");
  });
});

describe("public IP classification", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ])("denies non-public, local, metadata, multicast, or reserved address %s", (address) => {
    expect(() => assertPublicIpAddress(address)).toThrow(/public|address|SSRF/i);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:2800:220:1:248:1893:25c8:1946"])(
    "allows public address %s",
    (address) => {
      expect(assertPublicIpAddress(address)).toBe(address);
    },
  );

  it("rejects malformed address text", () => {
    expect(() => assertPublicIpAddress("example.com")).toThrow(/address/i);
  });
});

describe("pinned safe HTTP fetch", () => {
  it("resolves once, validates every answer, pins the connection, disables redirects, and caps bytes", async () => {
    const lookup = vi.fn(async () => [
      { address: PUBLIC_V4, family: 4 as const },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
    ]);
    const dispatch = vi.fn(async (request) => ({
      status: 200,
      connectedAddress: request.pinnedAddress,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode('{"ok":true}'),
    }));
    const fetcher = createSafeHttpFetcher({
      lookup,
      dispatch,
      timeoutMs: 500,
      maxResponseBytes: 1_048_576,
    });

    await expect(fetcher.getJson("https://example.com/data")).resolves.toEqual({ ok: true });
    expect(lookup).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        pinnedAddress: PUBLIC_V4,
        maxResponseBytes: 1_048_576,
      }),
    );
  });

  it("fails before dispatch if any DNS answer is unsafe", async () => {
    const dispatch = vi.fn();
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [
        { address: PUBLIC_V4, family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
      dispatch,
      timeoutMs: 100,
      maxResponseBytes: 1_048_576,
    });

    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(/public|SSRF/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects DNS rebinding when the connected peer differs from the pinned answer", async () => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
      dispatch: async () => ({
        status: 200,
        connectedAddress: "127.0.0.1",
        headers: {},
        body: new TextEncoder().encode("{}"),
      }),
      timeoutMs: 100,
      maxResponseBytes: 1_048_576,
    });

    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(
      /pinned|rebind|address/i,
    );
  });

  it.each([301, 302, 303, 307, 308])("never follows HTTP redirect status %s", async (status) => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
      dispatch: async () => ({
        status,
        connectedAddress: PUBLIC_V4,
        headers: { location: "https://other.example/data" },
        body: new Uint8Array(),
      }),
      timeoutMs: 100,
      maxResponseBytes: 1_048_576,
    });

    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(/redirect/i);
  });

  it("aborts a bounded request timeout", async () => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
      dispatch: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      timeoutMs: 5,
      maxResponseBytes: 1_048_576,
    });

    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(/timeout/i);
  });

  it("rejects a response before buffering more than one MiB", async () => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
      dispatch: async () => ({
        status: 200,
        connectedAddress: PUBLIC_V4,
        headers: { "content-length": "1048577" },
        body: new Uint8Array(1_048_577),
      }),
      timeoutMs: 100,
      maxResponseBytes: 1_048_576,
    });

    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(
      /1048576|1 MiB|response.*large/i,
    );
  });
});
