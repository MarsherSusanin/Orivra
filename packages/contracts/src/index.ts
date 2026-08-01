import { z } from "zod";

const VersionV1Schema = z.literal("1");
const NonEmptyIdSchema = z.string().trim().min(1);
const CanonicalUnsignedIntegerSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
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
  .strict();

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
    feeCapWei: CanonicalUnsignedIntegerSchema,
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
    blockNumber: CanonicalUnsignedIntegerSchema,
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
    quotedWei: CanonicalUnsignedIntegerSchema,
    capWei: CanonicalUnsignedIntegerSchema,
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
      .refine(isSafePublicHttpsUrl, "Expected a public canonical HTTPS URL"),
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
    const errorDiagnosticCodes = new Set(
      report.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.code),
    );
    if (
      (report.verdict === "blocked") !== (report.blockers.length > 0) ||
      report.blockers.some((blocker) => !errorDiagnosticCodes.has(blocker))
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Blocked verdicts require matching error diagnostics.",
      });
    }

    const requiredBlockers: Array<[boolean, PreflightBlockerV1]> = [
      [!report.determinism.passed, "PREFLIGHT_SOURCE_NONDETERMINISTIC"],
      [!report.abiCompatibility.compatible, "PREFLIGHT_ABI_INCOMPATIBLE"],
      [!report.fee.withinCap, "PREFLIGHT_FEE_CAP_EXCEEDED"],
    ];
    if (
      requiredBlockers.some(
        ([required, blocker]) => required && !blockerSet.has(blocker),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Failed preflight evidence requires its stable blocker.",
      });
    }

    const truncated = report.responseShape.truncated || report.jqPreview.truncated;
    if (
      (report.verdict === "ready" && truncated) ||
      (report.verdict === "attention" && !truncated)
    ) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "Truncated public shapes require an attention verdict.",
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
    (value) => value.length === 0 || /^(?:0|[1-9]\d*)$/.test(value),
    "Draft fee caps must be empty or canonical unsigned integers",
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
        quotedFeeWei: CanonicalUnsignedIntegerSchema,
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
  runEvent(
    "RUN_FAILED",
    z
      .object({
        stage: RunStageNameV1Schema,
        error: NormalizedFdcErrorSchema,
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
    registryAddress: AddressSchema,
    resolvedContracts: z
      .object({
        FdcHub: AddressSchema,
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
