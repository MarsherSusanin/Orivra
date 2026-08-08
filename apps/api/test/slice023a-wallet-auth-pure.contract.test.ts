// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"11".repeat(65)}`;
const ISSUED_AT = "2026-08-09T00:00:00.000Z";
const EXPIRES_AT = "2026-08-09T00:05:00.000Z";
const NONCE = "a1".repeat(32);
const EXPECTED_MESSAGE = [
  "proofline.example wants you to sign in with your Ethereum account:",
  ADDRESS,
  "",
  "Sign in to Proofline and create your default project.",
  "",
  "URI: https://proofline.example",
  "Version: 1",
  "Chain ID: 114",
  `Nonce: ${NONCE}`,
  `Issued At: ${ISSUED_AT}`,
  `Expiration Time: ${EXPIRES_AT}`,
].join("\n");

type WalletAuthModule = {
  buildEip4361Message(input: {
    webOrigin: string;
    address: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    purpose: "browser-session";
  }): string;
  verifyEoaWalletSignature(
    input: { expectedAddress: string; message: string; signature: string },
    ports: {
      recoverAddress(input: { message: string; signature: string }): Promise<string>;
    },
  ): Promise<boolean>;
};

async function walletAuth(): Promise<WalletAuthModule> {
  const modulePath = "../src/wallet-auth";
  return import(modulePath) as Promise<WalletAuthModule>;
}

describe("Slice 023A pure EIP-4361 boundary", () => {
  it("derives the exact Coston2 message from server inputs and rejects non-root origins", async () => {
    const auth = await walletAuth();
    const input = {
      webOrigin: "https://proofline.example",
      address: ADDRESS,
      nonce: NONCE,
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      purpose: "browser-session" as const,
    };
    expect(auth.buildEip4361Message(input)).toBe(EXPECTED_MESSAGE);
    for (const webOrigin of [
      "http://proofline.example",
      "https://proofline.example/path",
      "https://user:secret@proofline.example",
      "https://proofline.example?tenant=caller",
    ]) {
      expect(() => auth.buildEip4361Message({ ...input, webOrigin })).toThrow();
    }
  });

  it("accepts only canonical millisecond-UTC challenge timestamps", async () => {
    const auth = await walletAuth();
    const base = {
      webOrigin: "https://proofline.example",
      address: ADDRESS,
      nonce: NONCE,
      purpose: "browser-session" as const,
    };
    expect(auth.buildEip4361Message({
      ...base,
      issuedAt: "2026-08-09T00:00:00.123Z",
      expiresAt: "2026-08-09T00:05:00.123Z",
    })).toContain("Issued At: 2026-08-09T00:00:00.123Z");

    for (const [issuedAt, expiresAt] of [
      ["Sun, 09 Aug 2026 00:00:00 GMT", "Sun, 09 Aug 2026 00:05:00 GMT"],
      ["2026-08-09T00:00:00Z", "2026-08-09T00:05:00Z"],
      ["2026-08-09T00:00:00.0Z", "2026-08-09T00:05:00.0Z"],
      ["2026-08-09T00:00:00.0000Z", "2026-08-09T00:05:00.0000Z"],
      ["2026-08-09T00:00:00.000+00:00", "2026-08-09T00:05:00.000+00:00"],
      ["2026-08-09T10:00:00.000+10:00", "2026-08-09T10:05:00.000+10:00"],
      ["2026-08-09t00:00:00.000z", "2026-08-09t00:05:00.000z"],
      ["2026-08-09 00:00:00.000Z", "2026-08-09 00:05:00.000Z"],
    ] as const) {
      expect(() => auth.buildEip4361Message({
        ...base,
        issuedAt,
        expiresAt,
      })).toThrow(/timestamp|RFC3339|UTC/i);
    }
  });

  it("fails closed before returning an EIP-4361 message above 8192 UTF-8 bytes", async () => {
    const auth = await walletAuth();
    expect(() => auth.buildEip4361Message({
      webOrigin: `https://${"a".repeat(4_100)}.example`,
      address: ADDRESS,
      nonce: NONCE,
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      purpose: "browser-session",
    })).toThrow(/8192|message.*large|bytes/i);
  });

  it("accepts only the expected locally recovered EOA address", async () => {
    const auth = await walletAuth();
    const recoverAddress = vi.fn(async () => ADDRESS.toUpperCase());
    await expect(auth.verifyEoaWalletSignature(
      { expectedAddress: ADDRESS, message: EXPECTED_MESSAGE, signature: SIGNATURE },
      { recoverAddress },
    )).resolves.toBe(true);
    expect(recoverAddress).toHaveBeenCalledWith({ message: EXPECTED_MESSAGE, signature: SIGNATURE });

    recoverAddress.mockResolvedValueOnce("0x2222222222222222222222222222222222222222");
    await expect(auth.verifyEoaWalletSignature(
      { expectedAddress: ADDRESS, message: EXPECTED_MESSAGE, signature: SIGNATURE },
      { recoverAddress },
    )).resolves.toBe(false);
  });
});
