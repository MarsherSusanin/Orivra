// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const CHALLENGE_ID = `challenge_${"a".repeat(64)}`;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = `token_${"b".repeat(32)}`;
const PROJECT_TOKEN = `project_${"c".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;
const ISSUED_AT = "2026-08-09T00:00:00.000Z";
const CHALLENGE_EXPIRES_AT = "2026-08-09T00:05:00.000Z";
const SESSION_EXPIRES_AT = "2026-08-09T12:00:00.000Z";
const MESSAGE = [
  "proofline.example wants you to sign in with your Ethereum account:",
  ADDRESS,
  "",
  "Sign in to Proofline and create your default project.",
  "",
  "URI: https://proofline.example",
  "Version: 1",
  "Chain ID: 114",
  `Nonce: ${"a1".repeat(32)}`,
  `Issued At: ${ISSUED_AT}`,
  `Expiration Time: ${CHALLENGE_EXPIRES_AT}`,
].join("\n");

type PublicSchema = {
  safeParse(value: unknown): { success: boolean };
};

function requiredSchema(name: string): PublicSchema {
  const schema = (Contracts as Record<string, unknown>)[name] as
    | PublicSchema
    | undefined;
  expect(schema, `Slice 023A must export ${name}`).toBeDefined();
  if (!schema) throw new Error(`Missing ${name}`);
  return schema;
}

describe("Slice 023A wallet auth public contracts", () => {
  it("freezes strict server-authored challenge contracts", () => {
    const request = requiredSchema("WalletChallengeRequestV1Schema");
    const challenge = requiredSchema("WalletChallengeV1Schema");

    expect(request.safeParse({ version: "1", address: ADDRESS }).success).toBe(true);
    expect(request.safeParse({ address: ADDRESS }).success).toBe(false);
    expect(request.safeParse({ version: "1", address: ADDRESS, chainId: 114 }).success).toBe(false);
    expect(request.safeParse({ version: "1", address: "0x1234" }).success).toBe(false);

    const value = {
      version: "1",
      challengeId: CHALLENGE_ID,
      address: ADDRESS,
      purpose: "browser-session",
      network: "coston2",
      chainId: 114,
      message: MESSAGE,
      issuedAt: ISSUED_AT,
      expiresAt: CHALLENGE_EXPIRES_AT,
    };
    expect(challenge.safeParse(value).success).toBe(true);
    expect(challenge.safeParse({ ...value, expiresAt: "2026-08-09T00:06:00.000Z" }).success).toBe(false);
    expect(challenge.safeParse({ ...value, domain: "caller.example" }).success).toBe(false);
  });

  it("freezes strict one-time browser session contracts", () => {
    const request = requiredSchema("WalletSessionRequestV1Schema");
    const session = requiredSchema("WalletSessionV1Schema");
    expect(request.safeParse({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE }).success).toBe(true);
    expect(request.safeParse({ challengeId: CHALLENGE_ID, signature: SIGNATURE }).success).toBe(false);
    expect(request.safeParse({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE, message: MESSAGE }).success).toBe(false);
    expect(request.safeParse({ version: "1", challengeId: CHALLENGE_ID, signature: "0x12" }).success).toBe(false);

    const value = {
      version: "1",
      wallet: { kind: "eoa", address: ADDRESS },
      project: { kind: "default", projectId: PROJECT_ID },
      projectToken: PROJECT_TOKEN,
      issuedAt: ISSUED_AT,
      expiresAt: SESSION_EXPIRES_AT,
    };
    expect(session.safeParse(value).success).toBe(true);
    expect(session.safeParse({ ...value, expiresAt: "2026-08-09T13:00:00.000Z" }).success).toBe(false);
    expect(session.safeParse({ ...value, privateKey: "forbidden" }).success).toBe(false);
  });

  it("keeps raw credentials out of the strict account read contract", () => {
    const account = requiredSchema("AccountV1Schema");
    const value = {
      version: "1",
      wallet: { kind: "eoa", address: ADDRESS },
      project: { kind: "default", projectId: PROJECT_ID },
      tokens: [],
    };
    expect(account.safeParse(value).success).toBe(true);
    expect(account.safeParse({ ...value, projectToken: PROJECT_TOKEN }).success).toBe(false);
  });

  it("freezes bounded CLI/Action token creation, summary and one-time secret contracts", () => {
    const createRequest = requiredSchema("AccountTokenCreateRequestV1Schema");
    const summary = requiredSchema("AccountTokenSummaryV1Schema");
    const created = requiredSchema("AccountTokenCreatedV1Schema");
    const revoked = requiredSchema("AccountTokenRevokedV1Schema");
    const item = {
      version: "1",
      tokenId: TOKEN_ID,
      kind: "cli",
      label: "Local CLI",
      createdAt: ISSUED_AT,
      expiresAt: "2026-09-08T00:00:00.000Z",
      revokedAt: null,
    };

    expect(createRequest.safeParse({ version: "1", kind: "cli", label: "Local CLI", expiresInDays: 30 }).success).toBe(true);
    expect(createRequest.safeParse({ version: "1", kind: "action", label: "CI", expiresInDays: 90 }).success).toBe(true);
    expect(createRequest.safeParse({ kind: "cli", label: "Local CLI", expiresInDays: 30 }).success).toBe(false);
    expect(createRequest.safeParse({ version: "1", kind: "cli", label: "Local CLI", expiresInDays: 91 }).success).toBe(false);
    expect(summary.safeParse(item).success).toBe(true);
    expect(summary.safeParse({ ...item, token: PROJECT_TOKEN }).success).toBe(false);
    expect(created.safeParse({ version: "1", token: PROJECT_TOKEN, item }).success).toBe(true);
    expect(revoked.safeParse({ version: "1", tokenId: TOKEN_ID, revoked: true }).success).toBe(true);
  });
});
