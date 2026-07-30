// @vitest-environment node

import { MockAgent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import { createDaClient } from "../src/coston2";
import { assertManifestHasNoSecrets } from "../src/preflight";
import { createSafeHttpFetcher } from "../src/safe-http";
import { daProofFixture, REQUEST_BYTES } from "./fixtures";

const agents: MockAgent[] = [];

afterEach(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
  agents.length = 0;
});

describe("Slice 007 bounded adapter deadlines", () => {
  it("starts the safe HTTP deadline before DNS and aborts a stalled lookup", async () => {
    let lookupAborted = false;
    const lookup = vi.fn(
      (_hostname: string, options?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              lookupAborted = true;
              reject(options.signal?.reason);
            },
            { once: true },
          );
        }),
    );
    const fetcher = createSafeHttpFetcher({
      lookup,
      dispatch: vi.fn(),
      timeoutMs: 5,
      maxResponseBytes: 1024,
    });

    let guard: ReturnType<typeof setTimeout> | undefined;
    const failure = await Promise.race([
      fetcher.getJson("https://api.example.com/prices/eth"),
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(
          () => reject(new Error("SEMANTIC_GUARD_EXPIRED")),
          80,
        );
      }),
    ]).catch((error) => error);
    if (guard) clearTimeout(guard);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/DNS|request.*timeout/i);
    expect(lookupAborted).toBe(true);
    expect(lookup).toHaveBeenCalledWith(
      "api.example.com",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("aborts a DA request at its configured deadline", async () => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    agent
      .get("https://da.example")
      .intercept({
        path: "/api/v1/fdc/proof-by-request-round-raw",
        method: "POST",
      })
      .reply(200, daProofFixture)
      .delay(100);
    const client = createDaClient({
      endpoint: "https://da.example",
      dispatcher: agent,
      timeoutMs: 5,
    } as any);

    await expect(client.getProof(42_871n, REQUEST_BYTES)).rejects.toMatchObject({
      category: "timeout",
      code: "FDC_TIMEOUT",
      retryable: true,
    });
  });
});

describe("Slice 007 public manifest credential names", () => {
  it.each([
    "access_token",
    "client_secret",
    "password",
    "X-Amz-Credential",
    "X-Amz-Signature",
  ])("rejects credential-bearing query key %s in URL and manifest query", (key) => {
    const manifest = {
      ...validManifest,
      request: {
        ...validManifest.request,
        url: `${validManifest.request.url}&${encodeURIComponent(key)}=credential`,
        query: {
          ...validManifest.request.query,
          [key]: "credential",
        },
      },
    };

    expect(() => assertManifestHasNoSecrets(manifest as any)).toThrow(
      /secret|credential|public/i,
    );
  });

  it("allows ordinary public query names", () => {
    const manifest = {
      ...validManifest,
      request: {
        ...validManifest.request,
        query: {
          ...validManifest.request.query,
          cursor: "page-2",
          signatureVersion: "v4",
        },
      },
    };

    expect(() => assertManifestHasNoSecrets(manifest as any)).not.toThrow();
  });
});
