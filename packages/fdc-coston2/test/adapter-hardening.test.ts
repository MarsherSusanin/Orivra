// @vitest-environment node

import { MockAgent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  exactTrustManifest,
  validManifest,
  validPreflightReport,
} from "../../contracts/test/fixtures";
import {
  createDaClient,
  quoteAttestationFee,
} from "../src/coston2";
import { normalizeFdcError, redactEvidence } from "../src/errors";
import {
  assertPublicIpAddress,
  createSafeHttpFetcher,
} from "../src/safe-http";
import { runWeb2JsonPreflight } from "../src/preflight";
import { createWeb2JsonVerifierClient } from "../src/verifier";
import {
  daProofFixture,
  FDC_HUB,
  REQUEST_BYTES,
} from "./fixtures";

const agents: MockAgent[] = [];
const PUBLIC_V4 = "93.184.216.34";

afterEach(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
  agents.length = 0;
});

describe("Coston2 adapter HTTP and schema failures", () => {
  it("rejects a non-bigint registry fee quote with stable evidence", async () => {
    await expect(
      quoteAttestationFee({
        requestBytes: REQUEST_BYTES,
        fdcHub: FDC_HUB,
        reader: { readContract: vi.fn().mockResolvedValue("12345") },
      }),
    ).rejects.toMatchObject({
      category: "schema-invalid",
      code: "FEE_QUOTE_INVALID",
      retryable: false,
      evidence: { valueType: "string" },
    });
  });

  it("fails closed when DA returns a valid-looking proof with non-2xx HTTP status", async () => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    agent
      .get("https://da.example")
      .intercept({
        path: "/api/v1/fdc/proof-by-request-round-raw",
        method: "POST",
      })
      .reply(503, daProofFixture);
    const client = createDaClient({
      endpoint: "https://da.example/",
      dispatcher: agent,
    });

    await expect(client.getProof(42_871n, REQUEST_BYTES)).rejects.toMatchObject({
      category: expect.stringMatching(/transport|not-finalized/),
      retryable: true,
    });
  });

  it.each([
    null,
    {},
    { ...daProofFixture, response_hex: "0x1" },
    { ...daProofFixture, attestation_type: 42 },
    { ...daProofFixture, proof: "not-an-array" },
    { ...daProofFixture, proof: ["0x1234"] },
  ])("rejects malformed raw DA response %j", async (reply) => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    agent
      .get("https://da.example")
      .intercept({
        path: "/api/v1/fdc/proof-by-request-round-raw",
        method: "POST",
      })
      .reply(200, reply);
    const client = createDaClient({
      endpoint: "https://da.example",
      dispatcher: agent,
    });

    await expect(client.getProof(42_871n, REQUEST_BYTES)).rejects.toMatchObject({
      category: "schema-invalid",
      code: "DA_RESPONSE_INVALID",
    });
  });

  it("normalizes a DA transport failure without exposing the request bytes", async () => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    const client = createDaClient({
      endpoint: "https://da.example",
      dispatcher: agent,
    });
    const failure = await client.getProof(42_871n, REQUEST_BYTES).catch((cause) => cause);
    expect(failure).toMatchObject({
      category: "transport",
      retryable: true,
      evidence: expect.objectContaining({ operation: "getRawDaProof" }),
    });
    expect(JSON.stringify(failure)).not.toContain(REQUEST_BYTES);
  });

  it("fails closed when the verifier returns VALID bytes under non-2xx HTTP status", async () => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    agent
      .get("https://verifier.example")
      .intercept({
        path: "/verifier/web2/Web2Json/prepareRequest",
        method: "POST",
      })
      .reply(500, { status: "VALID", abiEncodedRequest: REQUEST_BYTES });
    const client = createWeb2JsonVerifierClient({
      endpoint: "https://verifier.example/",
      apiKey: "verifier-secret",
      dispatcher: agent,
    });

    await expect(client.prepareRequest(validManifest)).rejects.toMatchObject({
      category: "transport",
      retryable: true,
    });
  });

  it.each([
    null,
    { status: 200, abiEncodedRequest: REQUEST_BYTES },
    { status: "VALID", abiEncodedRequest: "0x" },
    { status: "VALID", abiEncodedRequest: "0x1" },
  ])("rejects verifier payload shape %j", async (reply) => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    agent
      .get("https://verifier.example")
      .intercept({
        path: "/verifier/web2/Web2Json/prepareRequest",
        method: "POST",
      })
      .reply(200, reply);
    const client = createWeb2JsonVerifierClient({
      endpoint: "https://verifier.example",
      apiKey: "verifier-secret",
      dispatcher: agent,
    });

    await expect(client.prepareRequest(validManifest)).rejects.toMatchObject({
      category: "schema-invalid",
      code: "VERIFIER_RESPONSE_INVALID",
    });
  });
});

describe("safe HTTP remaining boundary behavior", () => {
  it.each([
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "fec0::1",
  ])("denies documentation or reserved non-public address %s", (address) => {
    expect(() => assertPublicIpAddress(address)).toThrow(/public|SSRF/i);
  });

  it.each(["::ffff:7f00:1", "::ffff:1:2:3"])(
    "denies IPv4-mapped IPv6 representation %s",
    (address) => {
      expect(() => assertPublicIpAddress(address)).toThrow(/public|SSRF/i);
    },
  );

  it.each([
    { timeoutMs: 0, maxResponseBytes: 1024 },
    { timeoutMs: 100, maxResponseBytes: 0 },
  ])("requires positive fetch bounds %o", (bounds) => {
    expect(() =>
      createSafeHttpFetcher({
        lookup: vi.fn(),
        dispatch: vi.fn(),
        ...bounds,
      }),
    ).toThrow(/bounds|positive/i);
  });

  it("rejects an empty DNS answer without dispatch", async () => {
    const dispatch = vi.fn();
    const fetcher = createSafeHttpFetcher({
      lookup: vi.fn().mockResolvedValue([]),
      dispatch,
      timeoutMs: 100,
      maxResponseBytes: 1024,
    });
    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(
      /DNS|public address/i,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([199, 400, 404, 500])("rejects source HTTP status %s", async (status) => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
      dispatch: async () => ({
        status,
        connectedAddress: PUBLIC_V4,
        headers: {},
        body: new TextEncoder().encode("{}"),
      }),
      timeoutMs: 100,
      maxResponseBytes: 1024,
    });
    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(
      new RegExp(String(status)),
    );
  });

  it("rejects an oversized buffered body even without content-length", async () => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
      dispatch: async () => ({
        status: 200,
        connectedAddress: PUBLIC_V4,
        headers: {},
        body: new Uint8Array(1025),
      }),
      timeoutMs: 100,
      maxResponseBytes: 1024,
    });
    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(
      /1024|response exceeds/i,
    );
  });

  it("preserves a non-timeout dispatcher error", async () => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
      dispatch: async () => {
        throw new TypeError("TLS certificate rejected");
      },
      timeoutMs: 100,
      maxResponseBytes: 1024,
    });
    await expect(fetcher.getJson("https://example.com/data")).rejects.toThrow(
      /TLS certificate/i,
    );
  });
});

describe("preflight and error invariants", () => {
  it.each([0, 1, 4, 6])(
    "requires exactly five determinism samples, not %s",
    async (samples) => {
      const ports = {
        safeFetcher: { getJson: vi.fn().mockResolvedValue({ price: 1 }) },
        transformJq: vi.fn().mockResolvedValue({ value: 1 }),
        abiEncode: vi.fn().mockReturnValue("0x01"),
        verifier: {
          prepareRequest: vi.fn().mockResolvedValue({ requestBytes: REQUEST_BYTES }),
        },
        feeOracle: { quote: vi.fn().mockResolvedValue(1n) },
      };

      await expect(
        runWeb2JsonPreflight({
          runId: RUN_ID,
          manifest: exactTrustManifest,
          samples,
          fdcHub: FDC_HUB,
          networkSnapshot: validPreflightReport.registrySnapshot,
          ...ports,
        } as any),
      ).rejects.toMatchObject({
        category: "configuration",
        code: "PREFLIGHT_SAMPLE_COUNT_INVALID",
      });
      expect(ports.safeFetcher.getJson).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ message: "request timeout while polling" }, "timeout", true],
    [undefined, "transport", true],
    ["socket closed", "transport", true],
  ])("normalizes %j into %s", (failure, category, retryable) => {
    expect(normalizeFdcError(failure)).toMatchObject({ category, retryable });
  });

  it("redacts secret-bearing array entries and keeps ordinary evidence", () => {
    expect(
      redactEvidence([
        { rawTransaction: "0xsigned", endpoint: "https://rpc.example" },
        "Bearer project_secret",
        42,
      ]),
    ).toEqual([
      { rawTransaction: "[REDACTED]", endpoint: "https://rpc.example" },
      "Bearer [REDACTED]",
      42,
    ]);
  });
});
