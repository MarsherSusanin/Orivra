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
