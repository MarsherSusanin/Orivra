// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest, expectedCanonicalUrl } from "../../contracts/test/fixtures";
import { runWeb2JsonPreflight } from "../src/preflight";
import {
  assertPublicIpAddress,
  createSafeHttpFetcher,
} from "../src/safe-http";
import { createRelayerExecutor } from "../src/relayer";
import { FDC_HUB, REQUEST_BYTES } from "./fixtures";

const transactionHash = `0x${"a".repeat(64)}`;

describe("verifier remediation: SSRF and deadlines", () => {
  it.each([
    "::127.0.0.1",
    "::ffff:0:127.0.0.1",
    "2002:7f00:1::",
  ])("denies alternate IPv6 encodings of non-public IPv4 address %s", (address) => {
    expect(() => assertPublicIpAddress(address)).toThrow(/public|SSRF/i);
  });

  it("enforces its own deadline when a dispatcher ignores AbortSignal", async () => {
    const fetcher = createSafeHttpFetcher({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch: async () => new Promise(() => undefined),
      timeoutMs: 5,
      maxResponseBytes: 1024,
    });

    await expect(
      Promise.race([
        fetcher.getJson("https://example.com/data"),
        new Promise((resolve) => setTimeout(() => resolve("dispatcher remained pending"), 50)),
      ]),
    ).rejects.toThrow(/timeout/i);
  });
});

describe("verifier remediation: canonical request and fee caps", () => {
  it("attests the same canonical URL that was sampled during preflight", async () => {
    const safeFetcher = { getJson: vi.fn().mockResolvedValue({ price: 1 }) };
    const prepareRequest = vi
      .fn()
      .mockResolvedValue({ requestBytes: REQUEST_BYTES });

    await runWeb2JsonPreflight({
      manifest: validManifest,
      samples: 5,
      fdcHub: FDC_HUB,
      safeFetcher,
      transformJq: vi.fn().mockResolvedValue({ value: 1 }),
      abiEncode: vi.fn().mockReturnValue("0x01"),
      verifier: { prepareRequest },
      feeOracle: { quote: vi.fn().mockResolvedValue(12_345n) },
    });

    expect(safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(safeFetcher.getJson).toHaveBeenCalledWith(expectedCanonicalUrl);
    expect(prepareRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ url: expectedCanonicalUrl }),
      }),
    );
  });

  it.each([
    ["wallet", -1n],
    ["wallet", 20_000_000_000_000_001n],
    ["relayer", -1n],
    ["relayer", 20_000_000_000_000_001n],
  ] as const)("rejects a %s quote of %s outside the manifest fee envelope", async (mode, quote) => {
    const manifest = {
      ...validManifest,
      submission: { ...validManifest.submission, mode },
    };
    await expect(
      runWeb2JsonPreflight({
        manifest,
        samples: 5,
        fdcHub: FDC_HUB,
        safeFetcher: { getJson: vi.fn().mockResolvedValue({ price: 1 }) },
        transformJq: vi.fn().mockResolvedValue({ value: 1 }),
        abiEncode: vi.fn().mockReturnValue("0x01"),
        verifier: { prepareRequest: vi.fn().mockResolvedValue({ requestBytes: REQUEST_BYTES }) },
        feeOracle: { quote: vi.fn().mockResolvedValue(quote) },
      }),
    ).rejects.toMatchObject({
      category: "configuration",
      code: "FEE_QUOTE_OUT_OF_BOUNDS",
      retryable: false,
    });
  });
});

describe("verifier remediation: relayer command binding and recovery", () => {
  it("rejects persisted signed bytes whose command fingerprint differs", async () => {
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue({
        nonce: 7n,
        rawTransaction: "0x02f8signed",
        transactionHash,
        commandFingerprint: `sha256:${"b".repeat(64)}`,
      }),
      reserveNonce: vi.fn(),
      persistSignedTransaction: vi.fn(),
      markBroadcast: vi.fn(),
    };
    const executor = createRelayerExecutor({
      repository,
      signer: { sign: vi.fn() },
      broadcaster: vi.fn().mockResolvedValue(transactionHash),
    });

    await expect(
      executor.execute({
        idempotencyKey: "submission-1",
        chainId: 114,
        target: FDC_HUB,
        expectedTarget: FDC_HUB,
        calldata: "0xfeedcafe",
        expectedCalldata: "0xfeedcafe",
        valueWei: 12_345n,
        quotedFeeWei: 12_345n,
        projectFeeCapWei: 20_000n,
        globalFeeCapWei: 30_000n,
        quotaRemaining: 1,
        balanceWei: 100_000n,
        balanceFloorWei: 50_000n,
      }),
    ).rejects.toThrow(/fingerprint|command mismatch/i);
  });

  it("records a successful recovery broadcast of the exact persisted bytes", async () => {
    const persisted = {
      nonce: 7n,
      rawTransaction: "0x02f8signed",
      transactionHash,
    };
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(persisted),
      reserveNonce: vi.fn(),
      persistSignedTransaction: vi.fn(),
      markBroadcast: vi.fn().mockResolvedValue(undefined),
    };
    const broadcaster = vi.fn().mockResolvedValue(transactionHash);
    const executor = createRelayerExecutor({
      repository,
      signer: { sign: vi.fn() },
      broadcaster,
    });
    const command = {
      idempotencyKey: "submission-1",
      chainId: 114,
      target: FDC_HUB,
      expectedTarget: FDC_HUB,
      calldata: "0xfeedcafe",
      expectedCalldata: "0xfeedcafe",
      valueWei: 12_345n,
      quotedFeeWei: 12_345n,
      projectFeeCapWei: 20_000n,
      globalFeeCapWei: 30_000n,
      quotaRemaining: 1,
      balanceWei: 100_000n,
      balanceFloorWei: 50_000n,
    };

    await executor.execute(command);
    expect(broadcaster).toHaveBeenCalledWith(persisted.rawTransaction);
    expect(repository.markBroadcast).toHaveBeenCalledWith(
      command.idempotencyKey,
      persisted.transactionHash,
      expect.objectContaining({ recovered: true }),
    );
  });
});
