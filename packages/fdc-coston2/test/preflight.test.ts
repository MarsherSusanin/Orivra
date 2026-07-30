// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import {
  assertManifestHasNoSecrets,
  runWeb2JsonPreflight,
} from "../src/preflight";
import { FDC_HUB, REQUEST_BYTES } from "./fixtures";

function harness(sampleFactory: (index: number) => unknown = () => ({ price: 2500.125 })) {
  let sample = 0;
  return {
    safeFetcher: {
      getJson: vi.fn(async () => sampleFactory(sample++)),
    },
    transformJq: vi.fn(async (value) => ({
      value: Math.floor((value as { price: number }).price * 1_000_000),
    })),
    abiEncode: vi.fn().mockReturnValue("0xabi"),
    verifier: {
      prepareRequest: vi.fn().mockResolvedValue({ requestBytes: REQUEST_BYTES }),
    },
    feeOracle: {
      quote: vi.fn().mockResolvedValue(12_345n),
    },
  };
}

describe("safe Web2Json preflight", () => {
  it("runs five deterministic fetch/JQ/ABI samples before verifier preparation and fee quote", async () => {
    const ports = harness();
    await expect(
      runWeb2JsonPreflight({
        manifest: validManifest,
        samples: 5,
        fdcHub: FDC_HUB,
        ...ports,
      }),
    ).resolves.toMatchObject({
      sampleCount: 5,
      deterministic: true,
      requestBytes: REQUEST_BYTES,
      quotedFeeWei: 12_345n,
      encodedSample: "0xabi",
    });
    expect(ports.safeFetcher.getJson).toHaveBeenCalledTimes(5);
    expect(ports.transformJq).toHaveBeenCalledTimes(5);
    expect(ports.abiEncode).toHaveBeenCalledTimes(5);
    expect(ports.verifier.prepareRequest).toHaveBeenCalledOnce();
    expect(ports.feeOracle.quote).toHaveBeenCalledWith({
      fdcHub: FDC_HUB,
      requestBytes: REQUEST_BYTES,
    });
  });

  it("fails before verifier or fee when any sample produces different ABI bytes", async () => {
    const ports = harness((index) => ({ price: index === 4 ? 2501 : 2500 }));
    await expect(
      runWeb2JsonPreflight({
        manifest: validManifest,
        samples: 5,
        fdcHub: FDC_HUB,
        ...ports,
      }),
    ).rejects.toMatchObject({
      category: "schema-invalid",
      code: expect.stringMatching(/DETERMIN/i),
      retryable: false,
      evidence: expect.objectContaining({ sampleCount: 5 }),
    });
    expect(ports.verifier.prepareRequest).not.toHaveBeenCalled();
    expect(ports.feeOracle.quote).not.toHaveBeenCalled();
  });

  it("rejects a JQ result that cannot be encoded by the declared ABI", async () => {
    const ports = harness();
    ports.abiEncode.mockImplementation(() => {
      throw new Error("uint256 overflow");
    });
    await expect(
      runWeb2JsonPreflight({
        manifest: validManifest,
        samples: 5,
        fdcHub: FDC_HUB,
        ...ports,
      }),
    ).rejects.toMatchObject({
      category: "schema-invalid",
      code: expect.stringMatching(/ABI/i),
      retryable: false,
    });
  });
});

describe("manifest secret rejection", () => {
  it.each([
    "https://api.example.com/data?api_key=top-secret",
    "https://api.example.com/data?token=top-secret",
    "https://api.example.com/data?authorization=Bearer%20secret",
    "https://user:secret@api.example.com/data",
  ])("rejects credential material in a public Web2 URL: %s", (url) => {
    expect(() =>
      assertManifestHasNoSecrets({
        ...validManifest,
        request: { ...validManifest.request, url },
      }),
    ).toThrow(/secret|credential|public/i);
  });

  it("allows ordinary public query names and values", () => {
    expect(() => assertManifestHasNoSecrets(validManifest)).not.toThrow();
  });
});
