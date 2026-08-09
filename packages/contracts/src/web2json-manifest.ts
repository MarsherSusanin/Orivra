import { z } from "zod";
import {
  CanonicalUint256DecimalSchema,
  FdcNetworkV1Schema,
  VersionV1Schema,
  isCanonicalUint256Decimal,
} from "./schema-primitives";
import {
  ABI_SIGNATURE_MAX_CHARACTERS,
  isSafePublicHttpsUrl,
  isValidWeb2JsonAbiSignature,
} from "./web2json-validation";

const StringMapSchema = z.record(z.string().min(1), z.string());

export interface Web2JsonAbiParameterV1 {
  name: string;
  type: string;
  internalType?: string;
  components?: Web2JsonAbiParameterV1[];
}

const ABI_TUPLE_MAX_DEPTH = 8;
const ABI_TUPLE_TYPE_PATTERN = /^tuple(?:\[(?:0|[1-9]\d*)?\])*$/;

function abiParameterSchema(
  remainingTupleDepth: number,
): z.ZodType<Web2JsonAbiParameterV1> {
  const childSchema =
    remainingTupleDepth === 0
      ? z.never()
      : abiParameterSchema(remainingTupleDepth - 1);

  return z
    .object({
      name: z.string().min(1).max(128),
      type: z.string().min(1).max(128),
      internalType: z.string().min(1).max(256).optional(),
      components: z.array(childSchema).min(1).max(64).optional(),
    })
    .strict()
    .superRefine((parameter, context) => {
      const isTuple = ABI_TUPLE_TYPE_PATTERN.test(parameter.type);
      if (isTuple !== (parameter.components !== undefined)) {
        context.addIssue({
          code: "custom",
          path: ["components"],
          message: isTuple
            ? "Tuple ABI parameters require components."
            : "Only tuple ABI parameters may declare components.",
        });
      }
    });
}

export const Web2JsonAbiParameterV1Schema = abiParameterSchema(
  ABI_TUPLE_MAX_DEPTH,
);

const PUBLIC_URL_CREDENTIAL_QUERY_NAMES = new Set([
  "apikey",
  "token",
  "authorization",
  "auth",
  "secret",
  "privatekey",
  "accesstoken",
  "clientsecret",
  "password",
  "xamzcredential",
  "xamzsignature",
  "authorizationtoken",
  "credential",
  "jwt",
  "xamzsecuritytoken",
  "xgoogsignature",
  "xgoogcredential",
  "xgoogsecuritytoken",
  "googleaccessid",
  "signature",
  "sig",
  "awsaccesskeyid",
  "securitytoken",
]);

const PRIVATE_URL_QUERY_VALUE_PATTERN =
  /(?:project|share)_[A-Za-z0-9_-]{32,}|Bearer\s+[^\s;,]+|^0x[a-fA-F0-9]{64}$/i;

/**
 * Classifies public URL query names that carry credentials or signed-URL
 * authorization material. Separators and a trailing version suffix do not
 * make a credential name public; ordinary names such as `signatureVersion`
 * remain valid.
 */
export function isPublicUrlCredentialQueryName(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PUBLIC_URL_CREDENTIAL_QUERY_NAMES.has(normalized.replace(/v\d+$/, ""));
}

export function isPrivateUrlQueryValue(value: string): boolean {
  return PRIVATE_URL_QUERY_VALUE_PATTERN.test(value.trim());
}

export function isSafePublicUrlQueryEntry(
  name: string,
  value: string,
): boolean {
  return (
    !isPublicUrlCredentialQueryName(name) &&
    !isPrivateUrlQueryValue(value)
  );
}

const Web2JsonRequestV1Schema = z
  .object({
    method: z.literal("GET"),
    url: z.string().refine(isSafePublicHttpsUrl, "Expected a public HTTPS URL on port 443"),
    query: StringMapSchema,
    jq: z.string().min(1),
    abiSignature: z
      .string()
      .min(1)
      .max(ABI_SIGNATURE_MAX_CHARACTERS)
      .refine(
        (value) => isValidWeb2JsonAbiSignature(value, Web2JsonAbiParameterV1Schema),
        "Expected a bounded JSON ABI-parameter descriptor",
      ),
  })
  .strict()
  .superRefine((request, context) => {
    if (isSafePublicHttpsUrl(request.url)) {
      const url = new URL(request.url);
      for (const [name, value] of url.searchParams) {
        if (!isSafePublicUrlQueryEntry(name, value)) {
          context.addIssue({
            code: "custom",
            path: ["url"],
            message:
              "Public Web2Json URLs cannot contain credential query entries",
          });
        }
      }
    }
    for (const [name, value] of Object.entries(request.query)) {
      if (!isSafePublicUrlQueryEntry(name, value)) {
        context.addIssue({
          code: "custom",
          path: ["query", name],
          message:
            "Public Web2Json queries cannot contain credential entries",
        });
      }
    }
  });

const Web2JsonConsumerV1Schema = z
  .object({
    expectedScheme: z.literal("https"),
    expectedHost: z.string().trim().min(1),
    expectedPathPrefix: z.string().startsWith("/"),
    expectedQuery: StringMapSchema,
  })
  .strict();

const SubmissionV1Schema = z
  .object({
    mode: z.enum(["replay", "wallet", "relayer"]),
    feeCapWei: CanonicalUint256DecimalSchema,
  })
  .strict();

export const Web2JsonManifestV1Schema = z
  .object({
    version: VersionV1Schema,
    attestationType: z.literal("Web2Json"),
    network: FdcNetworkV1Schema,
    request: Web2JsonRequestV1Schema,
    consumer: Web2JsonConsumerV1Schema,
    submission: SubmissionV1Schema,
  })
  .strict();

export type Web2JsonManifestV1 = z.infer<typeof Web2JsonManifestV1Schema>;

export const Coston2Web2JsonManifestV1Schema =
  Web2JsonManifestV1Schema.extend({
    network: z.literal("coston2"),
  }).strict();

export type Coston2Web2JsonManifestV1 = z.infer<
  typeof Coston2Web2JsonManifestV1Schema
>;

export const ComposerStepV1Schema = z.enum([
  "source",
  "transform",
  "trust",
  "submit",
]);

const DraftQueryRowIdV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const Web2JsonDraftQueryRowV1Schema = z
  .object({
    id: DraftQueryRowIdV1Schema,
    key: z.string().max(128),
    value: z.string().max(2_048),
  })
  .strict();

function containsUrlCredentials(value: string): boolean {
  if (value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.username.length > 0 || url.password.length > 0;
  } catch {
    return false;
  }
}

const DraftSourceUrlV1Schema = z
  .string()
  .max(2_048)
  .refine((value) => !containsUrlCredentials(value), "Draft URLs must not contain credentials");

const DraftExpectedHostV1Schema = z
  .string()
  .max(253)
  .refine(
    (value) => value.length === 0 || value === value.toLowerCase(),
    "Draft expected hosts must be normalized to lowercase",
  );

const DraftPathPrefixV1Schema = z
  .string()
  .max(2_048)
  .refine(
    (value) => value.length === 0 || value.startsWith("/"),
    "Draft path prefixes must be empty or start with /",
  );

const DraftFeeCapV1Schema = z
  .string()
  .max(78)
  .refine(
    (value) => value.length === 0 || isCanonicalUint256Decimal(value),
    "Draft fee caps must be empty or canonical uint256 decimal strings",
  );

const DraftQueryRowsV1Schema = z.array(Web2JsonDraftQueryRowV1Schema).max(50);
const MAX_DRAFT_UTF8_BYTES = 65_536;

function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Strict, bounded local editing state. This is never accepted as run evidence;
 * Web2JsonManifestV1Schema remains the final manifest validator.
 */
export const Web2JsonManifestDraftV1Schema = z
  .object({
    version: VersionV1Schema,
    step: ComposerStepV1Schema,
    updatedAt: z.string().datetime({ offset: true }),
    createIdempotencyKey: z
      .string()
      .regex(
        /^composer_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    fields: z
      .object({
        sourceUrl: DraftSourceUrlV1Schema,
        queryRows: DraftQueryRowsV1Schema,
        jq: z.string().max(16_384),
        abiSignature: z.string().max(2_048),
        expectedScheme: z.literal("https"),
        expectedHost: DraftExpectedHostV1Schema,
        expectedPathPrefix: DraftPathPrefixV1Schema,
        expectedQueryRows: DraftQueryRowsV1Schema,
        submissionMode: z.enum(["replay", "wallet", "relayer"]),
        feeCapWei: DraftFeeCapV1Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((draft, context) => {
    if (serializedUtf8Bytes(draft) > MAX_DRAFT_UTF8_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Draft must not exceed 65536 serialized UTF-8 bytes.",
      });
    }
  });

export type ComposerStepV1 = z.infer<typeof ComposerStepV1Schema>;
export type Web2JsonDraftQueryRowV1 = z.infer<typeof Web2JsonDraftQueryRowV1Schema>;
export type Web2JsonManifestDraftV1 = z.infer<typeof Web2JsonManifestDraftV1Schema>;
