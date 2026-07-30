import { z } from "zod";

const VersionV1Schema = z.literal("1");
const NonEmptyIdSchema = z.string().trim().min(1);
const CanonicalUnsignedIntegerSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
const HexBytesSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const StringMapSchema = z.record(z.string().min(1), z.string());

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
    abiSignature: z.string().min(1),
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
