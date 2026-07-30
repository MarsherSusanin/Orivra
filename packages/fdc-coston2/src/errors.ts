import {
  NormalizedFdcErrorSchema,
  type NormalizedFdcError,
} from "@proofline/contracts";

const SECRET_KEY = /(?:api.?key|private.?key|authorization|raw.?transaction|secret|token)/i;
const BEARER = /Bearer\s+[^\s;,]+/gi;
const HEX_SECRET = /\b(?:key|secret)\s*=\s*0x[a-f0-9]{8,}\b/gi;

function redactString(value: string): string {
  return value.replace(BEARER, "Bearer [REDACTED]").replace(HEX_SECRET, "[REDACTED]");
}

export function redactEvidence(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : redactEvidence(item),
      ]),
    );
  }
  return value;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : {};
}

export function normalizeFdcError(
  error: unknown,
  evidence: Record<string, unknown> = {},
): NormalizedFdcError {
  const record = errorRecord(error);
  const text = String(record.message ?? error ?? "FDC operation failed");
  const status = String(record.status ?? "").toUpperCase();
  const code = String(record.code ?? "").toUpperCase();
  const name = String(record.name ?? "");

  let category: NormalizedFdcError["category"] = "transport";
  let retryable = true;
  if (record.kind === "configuration") {
    category = "configuration";
    retryable = false;
  } else if (name === "TimeoutError" || /timeout|deadline/i.test(text)) {
    category = "timeout";
  } else if (status === "NOT_FINALIZED") {
    category = "not-finalized";
  } else if (status === "CONSENSUS_MISS") {
    category = "consensus-miss";
    retryable = false;
  } else if (status === "SCHEMA_INVALID") {
    category = "schema-invalid";
    retryable = false;
  } else if (status === "PROOF_INVALID") {
    category = "proof-invalid";
    retryable = false;
  } else if (status === "CONSUMER_INVARIANT") {
    category = "consumer-invariant";
    retryable = false;
  } else if (code === "ECONNRESET") {
    category = "transport";
  }

  return NormalizedFdcErrorSchema.parse({
    version: "1",
    category,
    code: `FDC_${category.replaceAll("-", "_").toUpperCase()}`,
    message: redactString(text),
    retryable,
    evidence: redactEvidence(evidence),
  });
}

export function createFdcError(
  category: NormalizedFdcError["category"],
  code: string,
  message: string,
  retryable: boolean,
  evidence: Record<string, unknown>,
): NormalizedFdcError {
  return NormalizedFdcErrorSchema.parse({
    version: "1",
    category,
    code,
    message,
    retryable,
    evidence: redactEvidence(evidence),
  });
}
