import { z } from "zod";

const VersionV1Schema = z.literal("1");
const NonEmptyIdSchema = z.string().trim().min(1);
export const UINT256_MAX_DECIMAL =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export function isCanonicalUint256Decimal(value: string): boolean {
  return (
    /^(?:0|[1-9]\d*)$/.test(value) &&
    (value.length < UINT256_MAX_DECIMAL.length ||
      (value.length === UINT256_MAX_DECIMAL.length &&
        value <= UINT256_MAX_DECIMAL))
  );
}

export const CanonicalUint256DecimalSchema = z
  .string()
  .refine(
    isCanonicalUint256Decimal,
    "Expected a canonical uint256 decimal string",
  );
const HexBytesSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SourceHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/,
  );
const OpaqueCursorSchema = z
  .string()
  .min(16)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/);

const StringMapSchema = z.record(z.string().min(1), z.string());

export interface Web2JsonAbiParameterV1 {
  name: string;
  type: string;
  internalType?: string;
  components?: Web2JsonAbiParameterV1[];
}

const ABI_SIGNATURE_MAX_CHARACTERS = 2_048;
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

function isValidWeb2JsonAbiSignature(value: string): boolean {
  if (value.length > ABI_SIGNATURE_MAX_CHARACTERS) return false;
  try {
    return Web2JsonAbiParameterV1Schema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}

function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

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

function isSafePublicPreflightUrl(value: string): boolean {
  if (!isSafePublicHttpsUrl(value)) return false;
  const url = new URL(value);
  for (const [key, queryValue] of url.searchParams) {
    if (!isSafePublicUrlQueryEntry(key, queryValue)) {
      return false;
    }
  }
  return true;
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
        isValidWeb2JsonAbiSignature,
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
    network: z.literal("coston2"),
    request: Web2JsonRequestV1Schema,
    consumer: Web2JsonConsumerV1Schema,
    submission: SubmissionV1Schema,
  })
  .strict();

export type Web2JsonManifestV1 = z.infer<typeof Web2JsonManifestV1Schema>;

const CreateRunIdV1Schema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const CreateRunResultV1Schema = z
  .object({
    status: z.literal("accepted"),
    runId: CreateRunIdV1Schema,
    location: z.string().min(1).max(137),
  })
  .strict()
  .refine((result) => result.location === `/v1/runs/${result.runId}`, {
    path: ["location"],
    message: "Location must identify the accepted persisted run.",
  });

export type CreateRunResultV1 = z.infer<typeof CreateRunResultV1Schema>;

export const SubmissionRequestV1Schema = z
  .object({
    mode: z.enum(["wallet", "relayer", "replay"]),
  })
  .strict();

export type SubmissionRequestV1 = z.infer<typeof SubmissionRequestV1Schema>;

export const WalletTransactionV1Schema = z
  .object({
    chainId: z.literal("0x72"),
    to: AddressSchema,
    data: HexBytesSchema,
    value: z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/),
  })
  .strict();

export type WalletTransactionV1 = z.infer<typeof WalletTransactionV1Schema>;

export const SubmissionResponseV1Schema = z.discriminatedUnion("mode", [
  z
    .object({
      version: VersionV1Schema,
      runId: NonEmptyIdSchema,
      mode: z.literal("wallet"),
      effectOwner: z.literal("wallet"),
      transaction: WalletTransactionV1Schema,
    })
    .strict(),
  z
    .object({
      version: VersionV1Schema,
      runId: NonEmptyIdSchema,
      mode: z.literal("relayer"),
      effectOwner: z.literal("worker"),
      commandId: NonEmptyIdSchema,
    })
    .strict(),
  z
    .object({
      version: VersionV1Schema,
      runId: NonEmptyIdSchema,
      mode: z.literal("replay"),
      effectOwner: z.literal("none"),
      commandId: NonEmptyIdSchema,
    })
    .strict(),
]);

export type SubmissionResponseV1 = z.infer<typeof SubmissionResponseV1Schema>;

const Sha256EnvelopeSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const MAX_PREFLIGHT_REPORT_UTF8_BYTES = 65_536;
const PRIVATE_REPORT_TEXT_PATTERN =
  /(?:project|share)_[A-Za-z0-9_-]{32,}|Bearer\s+[^\s;,]+|0x[a-fA-F0-9]{64}/i;

function isSafePublicReportText(value: string): boolean {
  return !PRIVATE_REPORT_TEXT_PATTERN.test(value);
}

const SafePublicSummarySchema = z
  .string()
  .min(1)
  .max(512)
  .refine(isSafePublicReportText, "Private-looking values are not public report text");
const SafePublicRemediationSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(isSafePublicReportText, "Private-looking values are not public report text");

export const RedactedJsonShapeNodeV1Schema = z
  .object({
    path: z
      .string()
      .max(512)
      .refine((path) => path === "" || path.startsWith("/"), {
        message: "Shape paths must be root or JSON-pointer-like paths.",
      }),
    type: z.enum(["null", "boolean", "number", "string", "array", "object"]),
  })
  .strict();

export const RedactedJsonShapeV1Schema = z
  .object({
    truncated: z.boolean(),
    nodes: z.array(RedactedJsonShapeNodeV1Schema).min(1).max(256),
  })
  .strict()
  .superRefine((shape, context) => {
    for (let index = 1; index < shape.nodes.length; index += 1) {
      if (shape.nodes[index - 1].path >= shape.nodes[index].path) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "path"],
          message: "Shape node paths must be strictly ordered and unique.",
        });
      }
    }
  });

export type RedactedJsonShapeNodeV1 = z.infer<
  typeof RedactedJsonShapeNodeV1Schema
>;
export type RedactedJsonShapeV1 = z.infer<typeof RedactedJsonShapeV1Schema>;

export const PreflightDiagnosticCodeV1Schema = z.enum([
  "PREFLIGHT_SOURCE_NONDETERMINISTIC",
  "PREFLIGHT_ABI_INCOMPATIBLE",
  "PREFLIGHT_FEE_CAP_EXCEEDED",
  "PREFLIGHT_TRUST_HOST_MISMATCH",
  "PREFLIGHT_TRUST_PATH_MISMATCH",
  "PREFLIGHT_TRUST_QUERY_MISMATCH",
  "PREFLIGHT_RESPONSE_SHAPE_TRUNCATED",
  "PREFLIGHT_JQ_SHAPE_TRUNCATED",
]);

export type PreflightDiagnosticCodeV1 = z.infer<
  typeof PreflightDiagnosticCodeV1Schema
>;

export const PreflightReportFieldV1Schema = z.enum([
  "verdict",
  "canonicalUrl",
  "requestIdentitySha256",
  "sampleFingerprints",
  "determinism",
  "responseShape",
  "jqPreview",
  "abiCompatibility",
  "registrySnapshot",
  "fee",
  "blockers",
  "diagnostics",
]);

export const PreflightDiagnosticV1Schema = z
  .object({
    version: VersionV1Schema,
    code: PreflightDiagnosticCodeV1Schema,
    severity: z.enum(["info", "warning", "error"]),
    confidence: z.enum(["low", "medium", "high"]),
    summary: SafePublicSummarySchema,
    evidence: z
      .object({
        reportFields: z
          .array(PreflightReportFieldV1Schema)
          .min(1)
          .max(12)
          .refine(
            (fields) => new Set(fields).size === fields.length,
            "Diagnostic report field references must be unique",
          ),
      })
      .strict(),
    remediation: SafePublicRemediationSchema,
  })
  .strict();

export type PreflightDiagnosticV1 = z.infer<
  typeof PreflightDiagnosticV1Schema
>;

const PreflightBlockerV1Schema = z.enum([
  "PREFLIGHT_SOURCE_NONDETERMINISTIC",
  "PREFLIGHT_ABI_INCOMPATIBLE",
  "PREFLIGHT_FEE_CAP_EXCEEDED",
  "PREFLIGHT_TRUST_HOST_MISMATCH",
  "PREFLIGHT_TRUST_PATH_MISMATCH",
  "PREFLIGHT_TRUST_QUERY_MISMATCH",
]);

export type PreflightBlockerV1 = z.infer<typeof PreflightBlockerV1Schema>;

const PreflightDiagnosticExpectationByCode = {
  PREFLIGHT_SOURCE_NONDETERMINISTIC: {
    severity: "error",
    reportFields: ["sampleFingerprints", "determinism"],
  },
  PREFLIGHT_ABI_INCOMPATIBLE: {
    severity: "error",
    reportFields: ["abiCompatibility"],
  },
  PREFLIGHT_FEE_CAP_EXCEEDED: {
    severity: "error",
    reportFields: ["fee"],
  },
  PREFLIGHT_TRUST_HOST_MISMATCH: {
    severity: "error",
    reportFields: ["canonicalUrl"],
  },
  PREFLIGHT_TRUST_PATH_MISMATCH: {
    severity: "error",
    reportFields: ["canonicalUrl"],
  },
  PREFLIGHT_TRUST_QUERY_MISMATCH: {
    severity: "error",
    reportFields: ["canonicalUrl"],
  },
  PREFLIGHT_RESPONSE_SHAPE_TRUNCATED: {
    severity: "warning",
    reportFields: ["responseShape"],
  },
  PREFLIGHT_JQ_SHAPE_TRUNCATED: {
    severity: "warning",
    reportFields: ["jqPreview"],
  },
} as const satisfies Record<
  PreflightDiagnosticCodeV1,
  {
    severity: "warning" | "error";
    reportFields: readonly z.infer<typeof PreflightReportFieldV1Schema>[];
  }
>;

const PreflightAbiCompatibilityV1Schema = z
  .object({
    compatible: z.boolean(),
    checkedSamples: z.literal(5),
    encodedBytes: z.number().int().nonnegative().max(1_048_576).optional(),
    encodedSha256: Sha256EnvelopeSchema.optional(),
  })
  .strict()
  .refine(
    (evidence) =>
      evidence.compatible ===
      (evidence.encodedBytes !== undefined && evidence.encodedSha256 !== undefined),
    "Compatible ABI evidence requires encoded size and checksum.",
  );

const PreflightRegistrySnapshotV1Schema = z
  .object({
    chainId: z.literal(114),
    blockNumber: CanonicalUint256DecimalSchema,
    registryAddress: AddressSchema,
    resolvedContracts: z
      .object({
        FdcHub: AddressSchema,
        FdcRequestFeeConfigurations: AddressSchema,
        FdcVerification: AddressSchema,
        Relay: AddressSchema,
      })
      .strict(),
  })
  .strict();

const PreflightFeeV1Schema = z
  .object({
    quotedWei: CanonicalUint256DecimalSchema,
    capWei: CanonicalUint256DecimalSchema,
    withinCap: z.boolean(),
  })
  .strict()
  .refine(
    (fee) => fee.withinCap === (BigInt(fee.quotedWei) <= BigInt(fee.capWei)),
    "Fee cap result must match quoted and capped wei values.",
  );

function serializedPreflightReportBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const PreflightReportV1Schema = z
  .object({
    version: VersionV1Schema,
    runId: CreateRunIdV1Schema,
    verdict: z.enum(["ready", "attention", "blocked"]),
    canonicalUrl: z
      .string()
      .max(2_048)
      .refine(
        isSafePublicPreflightUrl,
        "Expected a public canonical HTTPS URL without credentials",
      ),
    requestIdentitySha256: Sha256EnvelopeSchema,
    sampleFingerprints: z.array(Sha256EnvelopeSchema).length(5),
    determinism: z
      .object({
        passed: z.boolean(),
        distinctFingerprints: z.number().int().min(1).max(5),
      })
      .strict(),
    responseShape: RedactedJsonShapeV1Schema,
    jqPreview: RedactedJsonShapeV1Schema,
    abiCompatibility: PreflightAbiCompatibilityV1Schema,
    registrySnapshot: PreflightRegistrySnapshotV1Schema,
    fee: PreflightFeeV1Schema,
    blockers: z
      .array(PreflightBlockerV1Schema)
      .max(6)
      .refine(
        (blockers) => new Set(blockers).size === blockers.length,
        "Preflight blockers must be unique",
      ),
    diagnostics: z.array(PreflightDiagnosticV1Schema).max(16),
  })
  .strict()
  .superRefine((report, context) => {
    const distinctFingerprints = new Set(report.sampleFingerprints).size;
    if (
      report.determinism.distinctFingerprints !== distinctFingerprints ||
      report.determinism.passed !== (distinctFingerprints === 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["determinism"],
        message: "Determinism must match the five ordered fingerprints.",
      });
    }

    const blockerSet = new Set(report.blockers);
    const diagnosticCodes = report.diagnostics.map(
      (diagnostic) => diagnostic.code,
    );
    const diagnosticCodeSet = new Set(diagnosticCodes);

    for (let index = 0; index < report.diagnostics.length; index += 1) {
      const diagnostic = report.diagnostics[index];
      const expectation = PreflightDiagnosticExpectationByCode[diagnostic.code];
      if (
        diagnostic.severity !== expectation.severity ||
        diagnostic.evidence.reportFields.length !==
          expectation.reportFields.length ||
        diagnostic.evidence.reportFields.some(
          (field, fieldIndex) => field !== expectation.reportFields[fieldIndex],
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["diagnostics", index],
          message: "Diagnostic severity and evidence must match its stable code.",
        });
      }
    }

    if (diagnosticCodeSet.size !== diagnosticCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["diagnostics"],
        message: "Preflight diagnostic codes must be unique.",
      });
    }

    const evidenceBlockers: Array<[boolean, PreflightBlockerV1]> = [
      [!report.determinism.passed, "PREFLIGHT_SOURCE_NONDETERMINISTIC"],
      [!report.abiCompatibility.compatible, "PREFLIGHT_ABI_INCOMPATIBLE"],
      [!report.fee.withinCap, "PREFLIGHT_FEE_CAP_EXCEEDED"],
    ];
    if (
      evidenceBlockers.some(
        ([failed, blocker]) => blockerSet.has(blocker) !== failed,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Preflight evidence and stable blockers must match exactly.",
      });
    }

    const attentionCodes = (
      [
        [
          report.responseShape.truncated,
          "PREFLIGHT_RESPONSE_SHAPE_TRUNCATED",
        ],
        [report.jqPreview.truncated, "PREFLIGHT_JQ_SHAPE_TRUNCATED"],
      ] as const
    )
      .filter(([required]) => required)
      .map(([, code]) => code);

    const hasExactAttentionDiagnostics =
      report.diagnostics.length === attentionCodes.length &&
      attentionCodes.every((code) => diagnosticCodeSet.has(code));
    const hasExactBlockedDiagnostics =
      report.diagnostics.length === report.blockers.length &&
      report.blockers.every((blocker) => diagnosticCodeSet.has(blocker));
    const verdictEvidenceIsExact =
      (report.verdict === "ready" &&
        report.blockers.length === 0 &&
        attentionCodes.length === 0 &&
        report.diagnostics.length === 0) ||
      (report.verdict === "attention" &&
        report.blockers.length === 0 &&
        attentionCodes.length > 0 &&
        hasExactAttentionDiagnostics) ||
      (report.verdict === "blocked" &&
        report.blockers.length > 0 &&
        hasExactBlockedDiagnostics);

    if (!verdictEvidenceIsExact) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "Verdict, blockers, diagnostics, and public evidence must match exactly.",
      });
    }

    if (serializedPreflightReportBytes(report) > MAX_PREFLIGHT_REPORT_UTF8_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Preflight report must not exceed 65536 serialized UTF-8 bytes.",
      });
    }
  });

export type PreflightReportV1 = z.infer<typeof PreflightReportV1Schema>;

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

export const DiagnosticV1Schema = z
  .object({
    version: VersionV1Schema,
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
    severity: z.enum(["info", "warning", "error"]),
    confidence: z.enum(["low", "medium", "high"]),
    summary: z.string().min(1),
    evidence: z.record(z.string(), z.unknown()),
    remediation: z.string().min(1),
  })
  .strict();

export type DiagnosticV1 = z.infer<typeof DiagnosticV1Schema>;

const ConsumerInvariantEvidenceV1Schema = z
  .object({
    invariant: z.enum(["scheme", "host", "path", "query"]),
    expected: z.string(),
    observed: z.string(),
    enforced: z.boolean(),
    passed: z.boolean(),
  })
  .strict();

export const ConsumerLabReportV1Schema = z
  .object({
    version: VersionV1Schema,
    runId: NonEmptyIdSchema,
    statement: z.literal("Valid proof ≠ trusted URL"),
    proofValid: z.boolean(),
    consumerIdentity: z.enum(["canonical-vulnerable", "canonical-safe"]),
    passed: z.boolean(),
    checks: z.tuple([
      ConsumerInvariantEvidenceV1Schema,
      ConsumerInvariantEvidenceV1Schema,
      ConsumerInvariantEvidenceV1Schema,
      ConsumerInvariantEvidenceV1Schema,
    ]),
    diagnostics: z.array(DiagnosticV1Schema),
    safeConsumer: z
      .object({
        identity: z.literal("canonical-safe"),
        contractName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        compilerVersion: z.string().regex(/^solc-\d+\.\d+\.\d+$/),
        compileStatus: z.enum(["passed", "failed", "not-run"]),
        sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        source: z.string().min(1),
        diff: z.string().startsWith("--- canonical-vulnerable\n+++ "),
      })
      .strict(),
    verdict: z
      .object({
        state: z.enum(["safe-to-integrate", "needs-fixes"]),
        missingChecks: z.number().int().min(0).max(4),
      })
      .strict(),
  })
  .strict()
  .superRefine((report, context) => {
    const expected = ["scheme", "host", "path", "query"];
    if (report.checks.some((check, index) => check.invariant !== expected[index])) {
      context.addIssue({ code: "custom", path: ["checks"], message: "Invariant rows must be ordered scheme, host, path, query" });
    }
    const missingChecks = report.checks.filter((check) => !check.enforced || !check.passed).length;
    if (report.verdict.missingChecks !== missingChecks) {
      context.addIssue({ code: "custom", path: ["verdict", "missingChecks"], message: "Missing count must match invariant rows" });
    }
    if (report.consumerIdentity === "canonical-vulnerable" &&
      (report.passed || report.checks.some((check) => check.enforced))) {
      context.addIssue({ code: "custom", path: ["consumerIdentity"], message: "Vulnerable consumer cannot claim enforced checks" });
    }
    if (report.checks.some((check) => check.passed && !check.enforced)) {
      context.addIssue({ code: "custom", path: ["checks"], message: "A passing invariant must be enforced" });
    }
    const allChecksPassed = report.checks.every((check) => check.enforced && check.passed);
    if (report.consumerIdentity === "canonical-safe" && report.passed !== allChecksPassed) {
      context.addIssue({ code: "custom", path: ["passed"], message: "Safe consumer result must match its invariant rows" });
    }
    const safeToIntegrate = report.proofValid && report.passed &&
      report.consumerIdentity === "canonical-safe" && report.verdict.missingChecks === 0 &&
      report.safeConsumer.compileStatus === "passed" && allChecksPassed;
    if ((report.verdict.state === "safe-to-integrate") !== safeToIntegrate) {
      context.addIssue({ code: "custom", path: ["verdict"], message: "Verdict must be derived from proof, consumer, invariant, and compiler evidence" });
    }
  });

export type ConsumerLabReportV1 = z.infer<typeof ConsumerLabReportV1Schema>;

export const NormalizedFdcErrorSchema = z
  .object({
    version: VersionV1Schema,
    category: z.enum([
      "configuration",
      "transport",
      "timeout",
      "not-finalized",
      "consensus-miss",
      "schema-invalid",
      "proof-invalid",
      "consumer-invariant",
    ]),
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
    message: z.string().min(1),
    retryable: z.boolean(),
    evidence: z.record(z.string(), z.unknown()),
  })
  .strict();

export type NormalizedFdcError = z.infer<typeof NormalizedFdcErrorSchema>;

export const RunStageNameV1Schema = z.enum([
  "preflight",
  "request",
  "round",
  "proof",
  "verify",
  "consumer",
]);

export type RunStageNameV1 = z.infer<typeof RunStageNameV1Schema>;

export const RecoveryCheckpointV1Schema = z.enum([
  "preflight",
  "submission",
  "transaction-receipt",
  "voting-round",
  "relay-finalization",
  "da-proof",
  "proof-verification",
  "consumer-verification",
]);

export const PreservedEvidenceV1Schema = z.enum([
  "preflight",
  "transaction",
  "receipt",
  "round",
  "relay",
  "proof",
  "verification",
  "consumer",
]);

export const RecoveryRetrySafetyV1Schema = z.enum([
  "same-command",
  "observe-only",
  "new-run-required",
  "operator-review",
]);

const PreservedEvidenceListV1Schema = z
  .array(PreservedEvidenceV1Schema)
  .max(8)
  .refine((items) => new Set(items).size === items.length, {
    message: "Preserved evidence classes must be unique",
  });

export const RecoveryErrorEvidenceV1Schema = z
  .object({
    stage: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
    attempt: z.number().int().nonnegative().optional(),
    retryAfterSeconds: z.number().finite().nonnegative().optional(),
    votingRound: z.number().int().nonnegative().optional(),
    commandId: NonEmptyIdSchema.optional(),
    originalCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/).optional(),
  })
  .strict();

export const RecoveryErrorMessageV1Schema = z.enum([
  "Worker command failed",
  "Command lease expired before completion",
]);

export const RecoveryErrorV1Schema = z
  .object({
    version: VersionV1Schema,
    category: NormalizedFdcErrorSchema.shape.category,
    code: NormalizedFdcErrorSchema.shape.code,
    message: RecoveryErrorMessageV1Schema,
    retryable: z.boolean(),
    evidence: RecoveryErrorEvidenceV1Schema,
  })
  .strict();

const RunRecoveryCommonV1 = {
  version: VersionV1Schema,
  stage: RunStageNameV1Schema,
  attempt: z.number().int().positive(),
  resumeFrom: RecoveryCheckpointV1Schema,
  preservedEvidence: PreservedEvidenceListV1Schema,
  updatedAt: z.string().datetime({ offset: true }),
  error: RecoveryErrorV1Schema,
};

const WaitingRecoveryV1Schema = z
  .object({
    ...RunRecoveryCommonV1,
    state: z.literal("waiting"),
    retryAfter: z.string().datetime({ offset: true }).optional(),
    retrySafety: z.enum(["same-command", "observe-only"]),
  })
  .strict();

const RetryableRecoveryV1Schema = z
  .object({
    ...RunRecoveryCommonV1,
    state: z.literal("retryable"),
    retryAfter: z.string().datetime({ offset: true }),
    retrySafety: z.literal("same-command"),
  })
  .strict()
  .refine((recovery) => recovery.error.retryable, {
    path: ["error", "retryable"],
    message: "Retryable recovery requires a retryable normalized error",
  });

const TerminalRecoveryV1Schema = z
  .object({
    ...RunRecoveryCommonV1,
    state: z.literal("terminal"),
    retrySafety: z.enum(["new-run-required", "operator-review"]),
  })
  .strict()
  .refine((recovery) => !recovery.error.retryable, {
    path: ["error", "retryable"],
    message: "Terminal recovery requires a non-retryable normalized error",
  });

export const RunRecoveryV1Schema = z.discriminatedUnion("state", [
  WaitingRecoveryV1Schema,
  RetryableRecoveryV1Schema,
  TerminalRecoveryV1Schema,
]);

export type RecoveryCheckpointV1 = z.infer<typeof RecoveryCheckpointV1Schema>;
export type PreservedEvidenceV1 = z.infer<typeof PreservedEvidenceV1Schema>;
export type RecoveryRetrySafetyV1 = z.infer<
  typeof RecoveryRetrySafetyV1Schema
>;
export type RunRecoveryV1 = z.infer<typeof RunRecoveryV1Schema>;
export type RecoveryErrorV1 = z.infer<typeof RecoveryErrorV1Schema>;

const RunEventCommon = {
  version: VersionV1Schema,
  runId: NonEmptyIdSchema,
  sequence: z.number().int().positive(),
  commandId: NonEmptyIdSchema,
  occurredAt: z.string().datetime({ offset: true }),
};

function runEvent<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) {
  return z
    .object({
      ...RunEventCommon,
      type: z.literal(type),
      payload,
    })
    .strict();
}

export const RunEventV1Schema = z.discriminatedUnion("type", [
  runEvent(
    "RUN_CREATED",
    z.object({ manifest: Web2JsonManifestV1Schema }).strict(),
  ),
  runEvent(
    "PREFLIGHT_ACCEPTED",
    z
      .object({
        canonicalUrl: z.string().url(),
        requestBytes: HexBytesSchema,
        quotedFeeWei: CanonicalUint256DecimalSchema,
      })
      .strict(),
  ),
  runEvent(
    "REQUEST_SUBMITTED",
    z
      .object({
        mode: z.enum(["wallet", "relayer"]),
        transactionHash: Bytes32Schema,
      })
      .strict(),
  ),
  runEvent(
    "ROUND_FINALIZED",
    z.object({ votingRound: z.number().int().nonnegative() }).strict(),
  ),
  runEvent(
    "PROOF_AVAILABLE",
    z.object({ proofHash: Bytes32Schema }).strict(),
  ),
  runEvent(
    "PROOF_VERIFIED",
    z.object({ verificationContract: AddressSchema }).strict(),
  ),
  runEvent(
    "CONSUMER_VERIFIED",
    z
      .object({
        passed: z.boolean(),
        diagnostics: z.array(DiagnosticV1Schema),
      })
      .strict(),
  ),
  runEvent("STAGE_WAITING", WaitingRecoveryV1Schema),
  runEvent(
    "STAGE_RETRY_SCHEDULED",
    RetryableRecoveryV1Schema,
  ),
  runEvent(
    "RUN_RESUMED",
    z
      .object({
        stage: RunStageNameV1Schema,
        attempt: z.number().int().positive(),
        resumeFrom: RecoveryCheckpointV1Schema,
        preservedEvidence: PreservedEvidenceListV1Schema,
      })
      .strict(),
  ),
  runEvent(
    "RUN_FAILED",
    z
      .object({
        stage: RunStageNameV1Schema,
        error: NormalizedFdcErrorSchema,
        recovery: TerminalRecoveryV1Schema.optional(),
      })
      .strict(),
  ),
]);

export type RunEventV1 = z.infer<typeof RunEventV1Schema>;
export type RunEventTypeV1 = RunEventV1["type"];

export const RunStageStatusV1Schema = z.enum(["pending", "active", "completed", "failed"]);

export const RunProjectionV1Schema = z
  .object({
    version: VersionV1Schema,
    runId: NonEmptyIdSchema,
    sequence: z.number().int().positive(),
    terminal: z.boolean(),
    terminalFailure: z
      .object({
        stage: RunStageNameV1Schema,
        error: NormalizedFdcErrorSchema,
      })
      .strict()
      .optional(),
    stages: z
      .object({
        preflight: RunStageStatusV1Schema,
        request: RunStageStatusV1Schema,
        round: RunStageStatusV1Schema,
        proof: RunStageStatusV1Schema,
        verify: RunStageStatusV1Schema,
        consumer: RunStageStatusV1Schema,
      })
      .strict(),
    recovery: RunRecoveryV1Schema.optional(),
  })
  .strict();

export type RunProjectionV1 = z.infer<typeof RunProjectionV1Schema>;
export type RunStageStatusV1 = z.infer<typeof RunStageStatusV1Schema>;

export const ProductEventNameV1Schema = z.enum([
  "COMPOSER_STARTED",
  "MANIFEST_VALIDATED",
  "PREFLIGHT_COMPLETED",
  "SUBMISSION_REQUESTED",
  "PROOF_AVAILABLE",
  "CONSUMER_VERIFICATION_FAILED",
  "SAFE_CODEGEN_GENERATED",
  "BUNDLE_REPLAYED",
  "RUN_RESUMED",
]);

export const ProductAnalyticsSessionIdV1Schema = z
  .string()
  .regex(
    /^session_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Expected an opaque generated analytics session identifier",
  );

export type ProductAnalyticsSessionIdV1 = z.infer<
  typeof ProductAnalyticsSessionIdV1Schema
>;

const ProductEventCommon = {
  version: VersionV1Schema,
  sessionId: ProductAnalyticsSessionIdV1Schema,
  occurredAt: z.string().datetime({ offset: true }),
};

function productEvent<
  TName extends z.infer<typeof ProductEventNameV1Schema>,
  TMetadata extends z.ZodType,
>(name: TName, metadata: TMetadata) {
  return z
    .object({
      ...ProductEventCommon,
      name: z.literal(name),
      metadata,
    })
    .strict();
}

export const ProductEventV1Schema = z.discriminatedUnion("name", [
  productEvent(
    "COMPOSER_STARTED",
    z.object({ entryPoint: z.enum(["runs", "direct"]) }).strict(),
  ),
  productEvent(
    "MANIFEST_VALIDATED",
    z.object({ outcome: z.enum(["accepted", "rejected"]) }).strict(),
  ),
  productEvent(
    "PREFLIGHT_COMPLETED",
    z.object({ outcome: z.enum(["accepted", "rejected"]) }).strict(),
  ),
  productEvent(
    "SUBMISSION_REQUESTED",
    z.object({ mode: z.enum(["replay", "wallet", "relayer"]) }).strict(),
  ),
  productEvent(
    "PROOF_AVAILABLE",
    z.object({ source: z.enum(["live", "replay"]) }).strict(),
  ),
  productEvent(
    "CONSUMER_VERIFICATION_FAILED",
    z
      .object({
        category: z.enum([
          "configuration",
          "proof-invalid",
          "consumer-invariant",
        ]),
      })
      .strict(),
  ),
  productEvent(
    "SAFE_CODEGEN_GENERATED",
    z.object({ target: z.enum(["solidity"]) }).strict(),
  ),
  productEvent(
    "BUNDLE_REPLAYED",
    z.object({ outcome: z.enum(["byte-identical", "mismatch", "rejected"]) }).strict(),
  ),
  productEvent(
    "RUN_RESUMED",
    z.object({ priorStatus: z.enum(["active", "completed", "failed"]) }).strict(),
  ),
]);

export type ProductEventNameV1 = z.infer<typeof ProductEventNameV1Schema>;
export type ProductEventV1 = z.infer<typeof ProductEventV1Schema>;

const ProductQaQueueV1Schema = z
  .object({
    status: z.enum(["healthy", "recovered", "unavailable"]),
    retainedEventCount: z.number().int().min(0).max(500),
  })
  .strict()
  .refine(
    (queue) => queue.status !== "unavailable" || queue.retainedEventCount === 0,
    "An unavailable queue cannot retain trusted events",
  );

const ProductQaCounterV1Schema = z
  .object({
    observed: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    consumerFailed: z.number().int().nonnegative(),
    resumed: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (counter) => counter.observed === counter.valid + counter.invalid,
    "Observed evidence must equal valid plus invalid evidence",
  )
  .refine(
    (counter) => counter.completed <= counter.valid,
    "Completed evidence cannot exceed valid evidence",
  )
  .refine(
    (counter) => counter.consumerFailed <= counter.valid,
    "Consumer-failed evidence cannot exceed valid evidence",
  )
  .refine(
    (counter) => counter.resumed <= counter.valid,
    "Resumed evidence cannot exceed valid evidence",
  );

const productQaStep = <TName extends z.infer<typeof ProductEventNameV1Schema>>(
  name: TName,
) => z
  .object({
    name: z.literal(name),
    sessions: z.number().int().nonnegative(),
    journeys: z.number().int().nonnegative(),
  })
  .strict();

const ProductQaStepsV1Schema = z.tuple([
  productQaStep("COMPOSER_STARTED"),
  productQaStep("MANIFEST_VALIDATED"),
  productQaStep("PREFLIGHT_COMPLETED"),
  productQaStep("SUBMISSION_REQUESTED"),
  productQaStep("PROOF_AVAILABLE"),
  productQaStep("CONSUMER_VERIFICATION_FAILED"),
  productQaStep("SAFE_CODEGEN_GENERATED"),
  productQaStep("BUNDLE_REPLAYED"),
  productQaStep("RUN_RESUMED"),
]);

const ProductQaCounterNames = [
  "observed",
  "valid",
  "invalid",
  "completed",
  "consumerFailed",
  "resumed",
] as const;

export const ProductQaReportV1Schema = z
  .object({
    version: VersionV1Schema,
    queue: ProductQaQueueV1Schema,
    sessions: ProductQaCounterV1Schema,
    journeys: ProductQaCounterV1Schema,
    steps: ProductQaStepsV1Schema,
  })
  .strict()
  .refine(
    (report) => ProductQaCounterNames.every(
      (name) => report.sessions[name] <= report.journeys[name],
    ),
    "Journey aggregates must cover session aggregates",
  )
  .refine(
    (report) => report.steps.every(
      (step) => step.sessions <= report.sessions.valid,
    ),
    "Step session counts cannot exceed valid sessions",
  )
  .refine(
    (report) => report.steps.every(
      (step) => step.journeys <= report.journeys.valid,
    ),
    "Step journey counts cannot exceed valid journeys",
  )
  .refine(
    (report) => report.steps.every(
      (step) => step.sessions <= step.journeys,
    ),
    "A step cannot cover more sessions than journeys",
  );

export type ProductQaReportV1 = z.infer<typeof ProductQaReportV1Schema>;

export const RunSummaryV1Schema = z
  .object({
    version: VersionV1Schema,
    runId: NonEmptyIdSchema,
    network: z.literal("coston2"),
    sourceHost: SourceHostSchema,
    submissionMode: z.enum(["replay", "wallet", "relayer"]),
    currentStage: RunStageNameV1Schema,
    status: z.enum(["active", "completed", "failed"]),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    lastSequence: z.number().int().positive(),
    resumable: z.boolean(),
  })
  .strict()
  .refine((run) => Date.parse(run.updatedAt) >= Date.parse(run.createdAt), {
    message: "updatedAt must not precede createdAt",
    path: ["updatedAt"],
  });

export type RunSummaryV1 = z.infer<typeof RunSummaryV1Schema>;

export const RunListPageV1Schema = z
  .object({
    version: VersionV1Schema,
    runs: z.array(RunSummaryV1Schema),
    nextCursor: OpaqueCursorSchema.optional(),
  })
  .strict();

export type RunListPageV1 = z.infer<typeof RunListPageV1Schema>;

const NetworkSnapshotV1Schema = z
  .object({
    chainId: z.literal(114),
    blockNumber: CanonicalUint256DecimalSchema,
    registryAddress: AddressSchema,
    resolvedContracts: z
      .object({
        FdcHub: AddressSchema,
        FdcRequestFeeConfigurations: AddressSchema,
        FdcVerification: AddressSchema,
        Relay: AddressSchema,
      })
      .strict(),
  })
  .strict();

const ProofSnapshotV1Schema = z
  .object({
    votingRound: z.number().int().nonnegative(),
    merkleProof: z.array(Bytes32Schema),
    response: HexBytesSchema,
  })
  .strict();

const VerificationSnapshotV1Schema = z
  .object({
    proofVerified: z.boolean(),
    consumerVerified: z.boolean(),
    diagnostics: z.array(DiagnosticV1Schema),
  })
  .strict();

const BundleArtifactsV1Schema = z
  .object({
    safeConsumerSha256: Sha256Schema,
  })
  .strict();

export const ProofBundleContentV1Schema = z
  .object({
    version: VersionV1Schema,
    runId: NonEmptyIdSchema,
    manifest: Web2JsonManifestV1Schema,
    events: z.array(RunEventV1Schema).min(1),
    requestBytes: HexBytesSchema,
    network: NetworkSnapshotV1Schema,
    proof: ProofSnapshotV1Schema,
    verification: VerificationSnapshotV1Schema,
    artifacts: BundleArtifactsV1Schema,
  })
  .strict();

export type ProofBundleContentV1 = z.infer<typeof ProofBundleContentV1Schema>;

export const ProofBundleV1Schema = ProofBundleContentV1Schema.extend({
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export type ProofBundleV1 = z.infer<typeof ProofBundleV1Schema>;

const Sha256EnvelopeV1Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const EvidenceReceiptV1Schema = z
  .object({
    version: VersionV1Schema,
    runId: NonEmptyIdSchema,
    network: z.literal("coston2"),
    submissionMode: z.enum(["wallet", "relayer", "replay"]),
    transactionHash: Bytes32Schema.optional(),
    votingRound: z.number().int().nonnegative(),
    proofChecksum: Sha256EnvelopeV1Schema,
    bundleChecksum: Sha256EnvelopeV1Schema,
    consumerResult: z
      .object({
        passed: z.boolean(),
        diagnosticCodes: z
          .array(z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/))
          .refine((codes) => new Set(codes).size === codes.length, {
            message: "Diagnostic codes must be unique",
          }),
      })
      .strict(),
    safeConsumerChecksum: Sha256EnvelopeV1Schema,
    replayResult: z
      .object({
        byteIdentical: z.literal(true),
        checksum: Sha256EnvelopeV1Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const live = receipt.submissionMode !== "replay";
    if (live !== (receipt.transactionHash !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["transactionHash"],
        message: "Live receipts require a transaction hash and replay receipts omit it",
      });
    }
    if (receipt.replayResult.checksum !== receipt.bundleChecksum) {
      context.addIssue({
        code: "custom",
        path: ["replayResult", "checksum"],
        message: "Replay checksum must match the canonical bundle checksum",
      });
    }
    if (receipt.consumerResult.passed !== (receipt.consumerResult.diagnosticCodes.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["consumerResult"],
        message: "Consumer result must agree with its diagnostic evidence",
      });
    }
  });

export type EvidenceReceiptV1 = z.infer<typeof EvidenceReceiptV1Schema>;

export const ShareLinkV1Schema = z
  .object({
    version: VersionV1Schema,
    runId: NonEmptyIdSchema,
    url: z.string().url(),
  })
  .strict()
  .superRefine((link, context) => {
    const url = new URL(link.url);
    const token = /^#share=(share_[a-f0-9]{64})$/.exec(url.hash)?.[1];
    const pathRunId = /^\/runs\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    let decodedRunId: string | undefined;
    try {
      decodedRunId = pathRunId === undefined ? undefined : decodeURIComponent(pathRunId);
    } catch {
      decodedRunId = undefined;
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      token === undefined ||
      decodedRunId !== link.runId
    ) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Share URL must be an HTTPS run-bound fragment capability",
      });
    }
  });

export type ShareLinkV1 = z.infer<typeof ShareLinkV1Schema>;
