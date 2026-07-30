// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import { assertManifestHasNoSecrets } from "../src/preflight";
import { validateRelayerSubmission } from "../src/relayer";
import { FDC_HUB } from "./fixtures";

const credentialNames = [
  "api_key_v2",
  "access_token_v2",
  "authorization_token",
  "credential",
  "jwt",
  "X-Amz-Security-Token",
] as const;

describe("Slice 008 credential-like query rejection", () => {
  it.each(credentialNames)(
    "rejects the URL query credential variant %s",
    (name) => {
      const url = new URL("https://api.example.com/prices/eth");
      url.searchParams.set(name, "must-not-leave-the-client");
      expect(() =>
        assertManifestHasNoSecrets({
          ...validManifest,
          request: { ...validManifest.request, url: url.toString() },
        }),
      ).toThrow(/secret|credential|public/i);
    },
  );

  it.each(credentialNames)(
    "rejects the manifest query credential variant %s",
    (name) => {
      expect(() =>
        assertManifestHasNoSecrets({
          ...validManifest,
          request: {
            ...validManifest.request,
            query: {
              ...validManifest.request.query,
              [name]: "must-not-leave-the-client",
            },
          },
        }),
      ).toThrow(/secret|credential|public/i);
    },
  );

  it("keeps ordinary versioned public query names valid", () => {
    expect(() =>
      assertManifestHasNoSecrets({
        ...validManifest,
        request: {
          ...validManifest.request,
          query: {
            ...validManifest.request.query,
            api_version_v2: "2026-07",
          },
        },
      }),
    ).not.toThrow();
  });
});

const relayerEnvelope = {
  idempotencyKey: "slice-008-gas-reserve",
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
  balanceFloorWei: 50_000n,
  gasLimit: 21_000n,
  maxFeePerGasWei: 2n,
} as const;

describe("Slice 008 worst-case relayer gas reserve", () => {
  it("accepts the exact attestation value, worst-case gas, and balance floor", () => {
    const value = {
      ...relayerEnvelope,
      balanceWei:
        relayerEnvelope.valueWei +
        relayerEnvelope.gasLimit * relayerEnvelope.maxFeePerGasWei +
        relayerEnvelope.balanceFloorWei,
    };
    expect(validateRelayerSubmission(value as any)).toEqual(value);
  });

  it("rejects a balance that preserves the floor only when gas is ignored", () => {
    expect(() =>
      validateRelayerSubmission({
        ...relayerEnvelope,
        balanceWei:
          relayerEnvelope.valueWei +
          relayerEnvelope.gasLimit * relayerEnvelope.maxFeePerGasWei +
          relayerEnvelope.balanceFloorWei -
          1n,
      } as any),
    ).toThrow(/gas|balance|floor|insufficient/i);
  });

  it.each([
    ["zero gas price", { maxFeePerGasWei: 0n }],
    ["negative gas price", { maxFeePerGasWei: -1n }],
    ["missing gas price", { maxFeePerGasWei: undefined }],
    ["zero gas limit", { gasLimit: 0n }],
  ])("fails closed on %s evidence before signing", (_label, override) => {
    expect(() =>
      validateRelayerSubmission({
        ...relayerEnvelope,
        ...override,
        balanceWei: 1_000_000n,
      } as any),
    ).toThrow(/gas|price|limit|evidence/i);
  });
});
