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

type TimestampVariant = "canonical" | "missing-milliseconds" | "offset" | "rfc1123" | "impossible";

type TimestampFieldCase = {
  name: string;
  schema: PublicSchema;
  canonical: string;
  value(timestamp: string, variant: TimestampVariant): unknown;
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
  function timestampFieldCases(): TimestampFieldCase[] {
    const challenge = requiredSchema("WalletChallengeV1Schema");
    const session = requiredSchema("WalletSessionV1Schema");
    const summary = requiredSchema("AccountTokenSummaryV1Schema");
    const challengeValue = {
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
    const sessionValue = {
      version: "1",
      wallet: { kind: "eoa", address: ADDRESS },
      project: { kind: "default", projectId: PROJECT_ID },
      projectToken: PROJECT_TOKEN,
      issuedAt: ISSUED_AT,
      expiresAt: SESSION_EXPIRES_AT,
    };
    const tokenValue = {
      version: "1",
      tokenId: TOKEN_ID,
      kind: "cli",
      label: "Local CLI",
      createdAt: ISSUED_AT,
      expiresAt: "2026-09-08T00:00:00.000Z",
      revokedAt: "2026-08-10T00:00:00.000Z",
    };

    const fieldCase = (
      name: string,
      schema: PublicSchema,
      value: Record<string, unknown>,
      field: string,
      impossibleCompanion: Record<string, string> = {},
    ): TimestampFieldCase => ({
      name,
      schema,
      canonical: value[field] as string,
      value: (timestamp, variant) => ({
        ...value,
        [field]: timestamp,
        ...(variant === "impossible" ? impossibleCompanion : {}),
      }),
    });

    return [
      fieldCase("challenge.issuedAt", challenge, challengeValue, "issuedAt", {
        expiresAt: "2026-03-02T00:05:00.000Z",
      }),
      fieldCase("challenge.expiresAt", challenge, challengeValue, "expiresAt", {
        issuedAt: "2026-03-02T00:00:00.000Z",
      }),
      fieldCase("session.issuedAt", session, sessionValue, "issuedAt", {
        expiresAt: "2026-03-02T12:00:00.000Z",
      }),
      fieldCase("session.expiresAt", session, sessionValue, "expiresAt", {
        issuedAt: "2026-03-02T00:00:00.000Z",
      }),
      fieldCase("accountToken.createdAt", summary, tokenValue, "createdAt"),
      fieldCase("accountToken.expiresAt", summary, tokenValue, "expiresAt"),
      fieldCase("accountToken.revokedAt", summary, tokenValue, "revokedAt"),
    ];
  }

  it("accepts canonical millisecond-UTC values for every auth response timestamp", () => {
    for (const field of timestampFieldCases()) {
      expect(
        field.schema.safeParse(field.value(field.canonical, "canonical")).success,
        field.name,
      ).toBe(true);
    }
  });

  it("rejects every non-canonical or impossible auth response timestamp", () => {
    const accepted: string[] = [];
    for (const field of timestampFieldCases()) {
      const variants: Array<[Exclude<TimestampVariant, "canonical">, string]> = [
        ["missing-milliseconds", field.canonical.replace(".000Z", "Z")],
        ["offset", field.canonical.replace("Z", "+00:00")],
        ["rfc1123", new Date(field.canonical).toUTCString()],
        ["impossible", field.canonical.replace(/^2026-\d{2}-\d{2}/, "2026-02-30")],
      ];
      for (const [variant, timestamp] of variants) {
        if (field.schema.safeParse(field.value(timestamp, variant)).success) {
          accepted.push(`${field.name}:${variant}`);
        }
      }
    }
    expect(accepted).toEqual([]);
  });

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

  it("bounds challenge messages by UTF-8 bytes rather than JavaScript characters", () => {
    const challenge = requiredSchema("WalletChallengeV1Schema");
    const value = {
      version: "1",
      challengeId: CHALLENGE_ID,
      address: ADDRESS,
      purpose: "browser-session",
      network: "coston2",
      chainId: 114,
      message: "a",
      issuedAt: ISSUED_AT,
      expiresAt: CHALLENGE_EXPIRES_AT,
    };
    const exactAscii = "a".repeat(8_192);
    const exactMultibyte = "é".repeat(4_096);
    const overMultibyte = "é".repeat(4_097);
    expect(new TextEncoder().encode(exactMultibyte)).toHaveLength(8_192);
    expect(new TextEncoder().encode(overMultibyte)).toHaveLength(8_194);
    expect(challenge.safeParse({ ...value, message: exactAscii }).success).toBe(true);
    expect(challenge.safeParse({ ...value, message: exactMultibyte }).success).toBe(true);
    expect(challenge.safeParse({ ...value, message: overMultibyte }).success).toBe(false);
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
