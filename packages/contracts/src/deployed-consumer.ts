import { z } from "zod";

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Sha256EnvelopeSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const DiagnosticSchema = z.object({
  version: z.literal("1"),
  code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
  severity: z.enum(["info", "warning", "error"]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1).max(512),
  evidence: z.record(z.string(), z.unknown()),
  remediation: z.string().min(1).max(1_024),
}).strict();

export const DeployedConsumerVerificationRequestV1Schema = z.object({
  version: z.literal("1"),
  chainId: z.literal(114),
  address: AddressSchema,
}).strict();

export const DeployedConsumerVerificationAcceptedV1Schema = z.object({
  version: z.literal("1"),
  runId: z.string().min(1),
  commandId: z.string().min(1),
  status: z.literal("pending"),
}).strict();

export const DeployedConsumerEvidenceV1Schema = z.object({
  version: z.literal("1"),
  runId: z.string().min(1),
  commandId: z.string().min(1),
  chainId: z.literal(114),
  address: AddressSchema,
  status: z.enum(["verified", "mismatched", "unavailable", "proxy-unsupported"]),
  observedAt: z.string().datetime({ offset: true }),
  blockNumber: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
  registryAddress: AddressSchema,
  codeSizeBytes: z.number().int().min(0).max(1_048_576),
  observedRuntimeBytecodeSha256: Sha256EnvelopeSchema.nullable(),
  expectedRuntimeBytecodeSha256: Sha256EnvelopeSchema,
  sourceSha256: Sha256EnvelopeSchema,
  compilerVersion: z.literal("solc-0.8.36"),
  diagnostics: z.array(DiagnosticSchema).max(8),
}).strict().superRefine((value, context) => {
  if ((value.codeSizeBytes === 0) !== (value.observedRuntimeBytecodeSha256 === null)) {
    context.addIssue({ code: "custom", path: ["observedRuntimeBytecodeSha256"], message: "Code size and observed digest must agree" });
  }
  if (value.status === "verified" && (
    value.diagnostics.length !== 0 ||
    value.observedRuntimeBytecodeSha256 !== value.expectedRuntimeBytecodeSha256
  )) {
    context.addIssue({ code: "custom", path: ["status"], message: "Verified evidence requires an exact runtime digest and no diagnostics" });
  }
  if (value.status !== "verified" && value.diagnostics.length === 0) {
    context.addIssue({ code: "custom", path: ["diagnostics"], message: "Non-verified evidence requires a diagnostic" });
  }
});

export type DeployedConsumerVerificationRequestV1 = z.infer<typeof DeployedConsumerVerificationRequestV1Schema>;
export type DeployedConsumerVerificationAcceptedV1 = z.infer<typeof DeployedConsumerVerificationAcceptedV1Schema>;
export type DeployedConsumerEvidenceV1 = z.infer<typeof DeployedConsumerEvidenceV1Schema>;
