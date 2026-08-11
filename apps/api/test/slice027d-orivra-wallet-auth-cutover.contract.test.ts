// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createPersistedWalletAuthService } from "../src/wallet-session-service";
import { buildEip4361Message } from "../src/wallet-auth";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const NONCE = "a1".repeat(32);
const SIGNATURE = `0x${"11".repeat(65)}`;
const ISSUED_AT = "2026-08-11T00:00:00.000Z";
const EXPIRES_AT = "2026-08-11T00:05:00.000Z";
const CHALLENGE_ID = `challenge_${"a".repeat(64)}`;

function message(displayName: "Orivra" | "Proofline") {
  return [
    "proofline.example wants you to sign in with your Ethereum account:",
    ADDRESS,
    "",
    `Sign in to ${displayName} and create your default project.`,
    "",
    "URI: https://proofline.example",
    "Version: 1",
    "Chain ID: 114",
    `Nonce: ${NONCE}`,
    `Issued At: ${ISSUED_AT}`,
    `Expiration Time: ${EXPIRES_AT}`,
  ].join("\n");
}

function authForPersistedMessage(persistedMessage: string) {
  const recoverAddress = vi.fn(async () => OTHER_ADDRESS);
  const query = vi.fn(async (sql: string) => {
    if (/UPDATE proofline_private\.wallet_challenges/i.test(sql)) {
      return {
        rowCount: 1,
        rows: [{
          id: CHALLENGE_ID,
          address: Buffer.from(ADDRESS.slice(2), "hex"),
          nonce: Buffer.from(NONCE, "hex"),
          message: persistedMessage,
          issued_at: new Date(ISSUED_AT),
          expires_at: new Date(EXPIRES_AT),
        }],
      };
    }
    return { rowCount: 0, rows: [] };
  });
  const client = { query, release: vi.fn() };
  const service = createPersistedWalletAuthService({
    pool: { connect: vi.fn(async () => client), query } as never,
    tokenDigestKey: "slice-027d-test-digest-key",
    publicWebOrigin: "https://proofline.example",
    ports: { recoverAddress },
  });
  return { service, query, recoverAddress };
}

describe("Slice 027D Orivra EIP-4361 cutover", () => {
  it("issues only the exact new Orivra challenge while keeping the origin technical identity", () => {
    const built = buildEip4361Message({
      webOrigin: "https://proofline.example",
      address: ADDRESS,
      nonce: NONCE,
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      purpose: "browser-session",
    });
    expect(built).toBe(message("Orivra"));
    expect(built).not.toContain("Sign in to Proofline");
    expect(built).toContain("URI: https://proofline.example");
  });

  it("fails closed for an exact pre-cutover Proofline challenge without signature recovery", async () => {
    const fixture = authForPersistedMessage(message("Proofline"));
    await expect(fixture.service.createWalletSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    })).rejects.toMatchObject({ code: "CHALLENGE_UNAVAILABLE" });
    expect(fixture.recoverAddress).not.toHaveBeenCalled();
    const consumeSql = fixture.query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => /UPDATE proofline_private\.wallet_challenges/i.test(sql));
    expect(consumeSql).toMatch(/expires_at\s*>\s*now\(\)/i);
    expect(Date.parse(EXPIRES_AT) - Date.parse(ISSUED_AT)).toBe(300_000);
  });

  it("rejects a near-legacy or caller-authored brand variant before signature recovery", async () => {
    const fixture = authForPersistedMessage(
      message("Proofline").replace("Sign in to Proofline", "Sign in to proofline"),
    );
    await expect(fixture.service.createWalletSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    })).rejects.toMatchObject({ code: "CHALLENGE_UNAVAILABLE" });
    expect(fixture.recoverAddress).not.toHaveBeenCalled();
  });

  it("keeps durable consume-before-recovery and adds no brand environment authority", async () => {
    const serviceSource = await readFile(
      new URL("../src/wallet-session-service.ts", import.meta.url),
      "utf8",
    );
    const authSource = await readFile(new URL("../src/wallet-auth.ts", import.meta.url), "utf8");
    expect(serviceSource).toMatch(/COMMIT[\s\S]*verifyEoaWalletSignature/);
    expect(`${serviceSource}\n${authSource}`).not.toMatch(/PROOFLINE_(?:BRAND|DISPLAY_NAME|SIWE_CUTOVER)/);
  });
});
