import { z } from "zod";
import {
  AuthTimestampV1Schema,
  isCanonicalAuthTimestampV1,
} from "./auth-timestamp";
import { VersionV1Schema } from "./schema-primitives";

const WalletAddressV1Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/);
const WalletChallengeIdV1Schema = z
  .string()
  .regex(/^challenge_[a-f0-9]{64}$/);
const WalletSignatureV1Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/);
const BrowserProjectTokenV1Schema = z
  .string()
  .regex(/^project_[a-f0-9]{64}$/);
const AccountTokenIdV1Schema = z
  .string()
  .regex(/^token_[a-f0-9]{32}$/);
const ProjectIdV1Schema = z.string().uuid();
const AccountTokenLabelV1Schema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (label) => label === label.trim(),
    "Token labels cannot have outer whitespace",
  );

function hasExactDuration(
  issuedAt: string,
  expiresAt: string,
  durationMilliseconds: number,
): boolean {
  return Date.parse(expiresAt) - Date.parse(issuedAt) === durationMilliseconds;
}

const WalletIdentityV1Schema = z
  .object({
    kind: z.literal("eoa"),
    address: WalletAddressV1Schema,
  })
  .strict();

const DefaultProjectIdentityV1Schema = z
  .object({
    kind: z.literal("default"),
    projectId: ProjectIdV1Schema,
  })
  .strict();

export { isCanonicalAuthTimestampV1 };

export const WalletChallengeRequestV1Schema = z
  .object({
    version: VersionV1Schema,
    address: WalletAddressV1Schema,
  })
  .strict();

export type WalletChallengeRequestV1 = z.infer<
  typeof WalletChallengeRequestV1Schema
>;

export const WalletChallengeV1Schema = z
  .object({
    version: VersionV1Schema,
    challengeId: WalletChallengeIdV1Schema,
    address: WalletAddressV1Schema,
    purpose: z.literal("browser-session"),
    network: z.literal("coston2"),
    chainId: z.literal(114),
    message: z
      .string()
      .min(1)
      .max(8_192)
      .refine(
        (message) => new TextEncoder().encode(message).byteLength <= 8_192,
        "Wallet challenge message cannot exceed 8192 UTF-8 bytes.",
      ),
    issuedAt: AuthTimestampV1Schema,
    expiresAt: AuthTimestampV1Schema,
  })
  .strict()
  .refine(
    (challenge) =>
      hasExactDuration(challenge.issuedAt, challenge.expiresAt, 5 * 60_000),
    {
      path: ["expiresAt"],
      message: "Wallet challenges must expire exactly five minutes after issue.",
    },
  );

export type WalletChallengeV1 = z.infer<typeof WalletChallengeV1Schema>;

export const WalletSessionRequestV1Schema = z
  .object({
    version: VersionV1Schema,
    challengeId: WalletChallengeIdV1Schema,
    signature: WalletSignatureV1Schema,
  })
  .strict();

export type WalletSessionRequestV1 = z.infer<
  typeof WalletSessionRequestV1Schema
>;

export const WalletSessionV1Schema = z
  .object({
    version: VersionV1Schema,
    wallet: WalletIdentityV1Schema,
    project: DefaultProjectIdentityV1Schema,
    projectToken: BrowserProjectTokenV1Schema,
    issuedAt: AuthTimestampV1Schema,
    expiresAt: AuthTimestampV1Schema,
  })
  .strict()
  .refine(
    (session) =>
      hasExactDuration(session.issuedAt, session.expiresAt, 12 * 60 * 60_000),
    {
      path: ["expiresAt"],
      message: "Browser sessions must expire exactly twelve hours after issue.",
    },
  );

export type WalletSessionV1 = z.infer<typeof WalletSessionV1Schema>;

export const AccountTokenCreateRequestV1Schema = z
  .object({
    version: VersionV1Schema,
    kind: z.enum(["cli", "action"]),
    label: AccountTokenLabelV1Schema,
    expiresInDays: z.number().int().min(1).max(90),
  })
  .strict();

export type AccountTokenCreateRequestV1 = z.infer<
  typeof AccountTokenCreateRequestV1Schema
>;

export const AccountTokenSummaryV1Schema = z
  .object({
    version: VersionV1Schema,
    tokenId: AccountTokenIdV1Schema,
    kind: z.enum(["cli", "action"]),
    label: AccountTokenLabelV1Schema,
    createdAt: AuthTimestampV1Schema,
    expiresAt: AuthTimestampV1Schema,
    revokedAt: AuthTimestampV1Schema.nullable(),
  })
  .strict();

export type AccountTokenSummaryV1 = z.infer<
  typeof AccountTokenSummaryV1Schema
>;

export const AccountV1Schema = z
  .object({
    version: VersionV1Schema,
    wallet: WalletIdentityV1Schema,
    project: DefaultProjectIdentityV1Schema,
    tokens: z.array(AccountTokenSummaryV1Schema),
  })
  .strict();

export type AccountV1 = z.infer<typeof AccountV1Schema>;

export const AccountTokenCreatedV1Schema = z
  .object({
    version: VersionV1Schema,
    token: BrowserProjectTokenV1Schema,
    item: AccountTokenSummaryV1Schema,
  })
  .strict();

export type AccountTokenCreatedV1 = z.infer<
  typeof AccountTokenCreatedV1Schema
>;

export const AccountTokenRevokedV1Schema = z
  .object({
    version: VersionV1Schema,
    tokenId: AccountTokenIdV1Schema,
    revoked: z.literal(true),
  })
  .strict();

export type AccountTokenRevokedV1 = z.infer<
  typeof AccountTokenRevokedV1Schema
>;
