import {
  Web2JsonAbiParameterV1Schema,
  Web2JsonManifestDraftV1Schema,
  Web2JsonManifestV1Schema,
  type Web2JsonDraftQueryRowV1,
  type Web2JsonManifestDraftV1,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";
import {
  getWeb2JsonTemplateDetail,
  resolveWeb2JsonTemplate,
} from "./web2json-template-catalog";

export type ComposerSourceIssueCode =
  | "SOURCE_URL_INVALID"
  | "SOURCE_URL_HTTPS_REQUIRED"
  | "SOURCE_URL_PORT_NOT_ALLOWED"
  | "SOURCE_URL_CREDENTIALS_NOT_ALLOWED"
  | "SOURCE_URL_FRAGMENT_NOT_ALLOWED";

export interface ComposerSourceIssue {
  field: "sourceUrl";
  code: ComposerSourceIssueCode;
  message: string;
}

export type ComposerSourceValidation =
  | { valid: true }
  | { valid: false; issue: ComposerSourceIssue };

export interface CreateComposerDraftInput {
  updatedAt: string;
  createIdempotencyKey: string;
}

export interface ImportWeb2JsonManifestDraftInput extends CreateComposerDraftInput {
  manifest: unknown;
}

export interface ComposerTrustFields {
  expectedScheme: "https";
  expectedHost: string;
  expectedPathPrefix: string;
  expectedQueryRows: Web2JsonDraftQueryRowV1[];
}

export type ComposerTrustIssueCode =
  | "TRUST_HOST_REQUIRED"
  | "TRUST_HOST_INVALID"
  | "TRUST_HOST_NOT_NORMALIZED"
  | "TRUST_PATH_PREFIX_INVALID"
  | "TRUST_QUERY_KEY_REQUIRED"
  | "TRUST_QUERY_KEY_DUPLICATE";

export interface ComposerTrustIssue {
  field: string;
  code: ComposerTrustIssueCode;
  message: string;
}

export type ComposerTrustValidation =
  | { valid: true }
  | { valid: false; issues: ComposerTrustIssue[] };

export type ComposerFinalizationIssueCode =
  | ComposerSourceIssueCode
  | ComposerTrustIssueCode
  | "SOURCE_URL_QUERY_DUPLICATE"
  | "SOURCE_QUERY_KEY_REQUIRED"
  | "SOURCE_QUERY_KEY_DUPLICATE"
  | "TRANSFORM_JQ_REQUIRED"
  | "TRANSFORM_ABI_JSON_INVALID"
  | "TRANSFORM_ABI_DESCRIPTOR_INVALID"
  | "TRUST_HOST_MISMATCH"
  | "TRUST_PATH_NOT_COVERED"
  | "TRUST_QUERY_MISMATCH"
  | "SUBMISSION_FEE_CAP_REQUIRED";

export interface ComposerFinalizationIssue {
  field: string;
  code: ComposerFinalizationIssueCode;
  message: string;
}

export type ComposerTransformValidation =
  | { valid: true; canonicalAbiSignature: string }
  | { valid: false; issues: ComposerFinalizationIssue[] };

export type Web2JsonManifestFinalization =
  | {
      valid: true;
      manifest: Web2JsonManifestV1;
      canonicalJson: string;
    }
  | { valid: false; issues: ComposerFinalizationIssue[] };

export type ComposerDraftDecodeResult =
  | { state: "empty" }
  | { state: "restored"; draft: Web2JsonManifestDraftV1 }
  | {
      state: "rejected";
      reason: "corrupt" | "unsupported-version" | "oversized" | "invalid";
    };

const SOURCE_ISSUES: Record<ComposerSourceIssueCode, ComposerSourceIssue> = {
  SOURCE_URL_INVALID: {
    field: "sourceUrl",
    code: "SOURCE_URL_INVALID",
    message: "Enter a valid absolute source URL.",
  },
  SOURCE_URL_HTTPS_REQUIRED: {
    field: "sourceUrl",
    code: "SOURCE_URL_HTTPS_REQUIRED",
    message: "Use HTTPS for the source URL.",
  },
  SOURCE_URL_PORT_NOT_ALLOWED: {
    field: "sourceUrl",
    code: "SOURCE_URL_PORT_NOT_ALLOWED",
    message: "Source URLs must use port 443.",
  },
  SOURCE_URL_CREDENTIALS_NOT_ALLOWED: {
    field: "sourceUrl",
    code: "SOURCE_URL_CREDENTIALS_NOT_ALLOWED",
    message: "Remove credentials from the source URL.",
  },
  SOURCE_URL_FRAGMENT_NOT_ALLOWED: {
    field: "sourceUrl",
    code: "SOURCE_URL_FRAGMENT_NOT_ALLOWED",
    message: "Remove the URL fragment.",
  },
};

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:\[[0-9A-Fa-f:.]+\]|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*)$/;

const TRUST_ISSUES = {
  hostRequired: {
    field: "expectedHost",
    code: "TRUST_HOST_REQUIRED",
    message: "Enter the expected source host.",
  },
  hostInvalid: {
    field: "expectedHost",
    code: "TRUST_HOST_INVALID",
    message: "Enter a valid hostname without a scheme, path, port, or credentials.",
  },
  hostNotNormalized: {
    field: "expectedHost",
    code: "TRUST_HOST_NOT_NORMALIZED",
    message: "Use the lowercase normalized host.",
  },
  pathInvalid: {
    field: "expectedPathPrefix",
    code: "TRUST_PATH_PREFIX_INVALID",
    message: "Expected path prefix must start with /.",
  },
} as const satisfies Record<string, ComposerTrustIssue>;

const MAX_DRAFT_UTF8_BYTES = 65_536;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidSource(code: ComposerSourceIssueCode): ComposerSourceValidation {
  return { valid: false, issue: { ...SOURCE_ISSUES[code] } };
}

function sortedQueryRows(
  values: Readonly<Record<string, string>>,
  idPrefix: "source-query" | "expected-query",
): Web2JsonDraftQueryRowV1[] {
  return Object.keys(values)
    .sort()
    .map((key, index) => ({
      id: `${idPrefix}-${index}`,
      key,
      value: values[key],
    }));
}

function urlQueryMap(url: URL): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of [...new Set(url.searchParams.keys())].sort()) {
    values[key] = url.searchParams.get(key)!;
  }
  return values;
}

export function validateComposerSourceUrl(value: string): ComposerSourceValidation {
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    return invalidSource("SOURCE_URL_INVALID");
  }

  if (source.protocol !== "https:") {
    return invalidSource("SOURCE_URL_HTTPS_REQUIRED");
  }
  if (source.port !== "") {
    return invalidSource("SOURCE_URL_PORT_NOT_ALLOWED");
  }
  if (source.username !== "" || source.password !== "") {
    return invalidSource("SOURCE_URL_CREDENTIALS_NOT_ALLOWED");
  }
  if (source.hash !== "") {
    return invalidSource("SOURCE_URL_FRAGMENT_NOT_ALLOWED");
  }

  return { valid: true };
}

function parseSafeSourceUrl(value: string): URL {
  const validation = validateComposerSourceUrl(value);
  if (!validation.valid) {
    throw new Error(`Invalid Composer source URL: ${validation.issue.message}`);
  }
  return new URL(value);
}

export function deriveTrustFromSourceUrl(sourceUrl: string): ComposerTrustFields {
  const source = parseSafeSourceUrl(sourceUrl);
  return {
    expectedScheme: "https",
    expectedHost: source.hostname.toLowerCase(),
    expectedPathPrefix: source.pathname,
    expectedQueryRows: sortedQueryRows(urlQueryMap(source), "expected-query"),
  };
}

export function validateComposerTrustFields(
  fields: ComposerTrustFields,
): ComposerTrustValidation {
  const issues: ComposerTrustIssue[] = [];
  const host = fields.expectedHost.trim();

  if (host === "") {
    issues.push({ ...TRUST_ISSUES.hostRequired });
  } else if (!HOSTNAME_PATTERN.test(host)) {
    issues.push({ ...TRUST_ISSUES.hostInvalid });
  } else if (fields.expectedHost !== host || host !== host.toLowerCase()) {
    issues.push({ ...TRUST_ISSUES.hostNotNormalized });
  }

  if (!/^\/[^?#]*$/.test(fields.expectedPathPrefix)) {
    issues.push({ ...TRUST_ISSUES.pathInvalid });
  }

  const queryKeys = new Set<string>();
  fields.expectedQueryRows.forEach((row, index) => {
    const key = row.key.trim();
    if (key === "") {
      issues.push({
        field: `expectedQueryRows.${index}.key`,
        code: "TRUST_QUERY_KEY_REQUIRED",
        message: "Expected query keys cannot be blank.",
      });
    } else if (queryKeys.has(key)) {
      issues.push({
        field: `expectedQueryRows.${index}.key`,
        code: "TRUST_QUERY_KEY_DUPLICATE",
        message: "Expected query keys must be unique.",
      });
    } else {
      queryKeys.add(key);
    }
  });

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

function draftFromManifest(
  manifest: Web2JsonManifestV1,
  input: CreateComposerDraftInput,
): Web2JsonManifestDraftV1 {
  return Web2JsonManifestDraftV1Schema.parse({
    version: "1",
    step: "source",
    updatedAt: input.updatedAt,
    createIdempotencyKey: input.createIdempotencyKey,
    fields: {
      sourceUrl: manifest.request.url,
      queryRows: sortedQueryRows(manifest.request.query, "source-query"),
      jq: manifest.request.jq,
      abiSignature: manifest.request.abiSignature,
      expectedScheme: manifest.consumer.expectedScheme,
      expectedHost: manifest.consumer.expectedHost.toLowerCase(),
      expectedPathPrefix: manifest.consumer.expectedPathPrefix,
      expectedQueryRows: sortedQueryRows(
        manifest.consumer.expectedQuery,
        "expected-query",
      ),
      submissionMode: manifest.submission.mode,
      feeCapWei: manifest.submission.feeCapWei,
    },
  });
}

export function importWeb2JsonManifestDraft(
  input: ImportWeb2JsonManifestDraftInput,
): Web2JsonManifestDraftV1 {
  let manifest: Web2JsonManifestV1;
  try {
    manifest = Web2JsonManifestV1Schema.parse(input.manifest);
  } catch (error) {
    throw new Error("Manifest is not a valid Web2JsonManifestV1.", { cause: error });
  }
  return draftFromManifest(manifest, input);
}

export function createEthUsdComposerDraft(
  input: CreateComposerDraftInput,
): Web2JsonManifestDraftV1 {
  const resolvedDetail = resolveWeb2JsonTemplate({
    detail: getWeb2JsonTemplateDetail("eth-usd"),
    expectedId: "eth-usd",
    expectedRevision: 1,
  });
  return importWeb2JsonManifestDraft({ ...input, manifest: resolvedDetail.manifest });
}

export function validateComposerTransformFields(fields: {
  jq: string;
  abiSignature: string;
}): ComposerTransformValidation {
  const issues: ComposerFinalizationIssue[] = [];
  if (fields.jq.trim() === "") {
    issues.push({
      field: "jq",
      code: "TRANSFORM_JQ_REQUIRED",
      message: "Enter a JQ transform.",
    });
  }

  let descriptor: unknown;
  try {
    descriptor = JSON.parse(fields.abiSignature);
  } catch {
    issues.push({
      field: "abiSignature",
      code: "TRANSFORM_ABI_JSON_INVALID",
      message: "Enter a valid JSON ABI-parameter descriptor.",
    });
    return { valid: false, issues };
  }

  const parsedDescriptor = Web2JsonAbiParameterV1Schema.safeParse(descriptor);
  if (!parsedDescriptor.success) {
    issues.push({
      field: "abiSignature",
      code: "TRANSFORM_ABI_DESCRIPTOR_INVALID",
      message: "Use the official bounded ABI-parameter descriptor shape.",
    });
  }

  if (issues.length > 0 || !parsedDescriptor.success) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    canonicalAbiSignature: canonicalJson(parsedDescriptor.data),
  };
}

interface QueryRowsResult {
  query: Record<string, string>;
  issues: ComposerFinalizationIssue[];
}

function queryRowsToMap(
  rows: readonly Web2JsonDraftQueryRowV1[],
): QueryRowsResult {
  const query = Object.create(null) as Record<string, string>;
  const issues: ComposerFinalizationIssue[] = [];

  rows.forEach((row, index) => {
    const key = row.key.trim();
    if (key === "") {
      issues.push({
        field: `queryRows.${index}.key`,
        code: "SOURCE_QUERY_KEY_REQUIRED",
        message: "Source query keys cannot be blank.",
      });
    } else if (Object.hasOwn(query, key)) {
      issues.push({
        field: `queryRows.${index}.key`,
        code: "SOURCE_QUERY_KEY_DUPLICATE",
        message: "Source query keys must be unique.",
      });
    } else {
      query[key] = row.value;
    }
  });

  return { query, issues };
}

function rowsToSafeMap(
  rows: readonly Web2JsonDraftQueryRowV1[],
): Record<string, string> {
  const query = Object.create(null) as Record<string, string>;
  for (const row of rows) query[row.key.trim()] = row.value;
  return query;
}

function sourceUrlQuery(source: URL): QueryRowsResult {
  const query = Object.create(null) as Record<string, string>;
  const issues: ComposerFinalizationIssue[] = [];

  for (const [key, value] of source.searchParams) {
    if (Object.hasOwn(query, key)) {
      issues.push({
        field: "sourceUrl",
        code: "SOURCE_URL_QUERY_DUPLICATE",
        message: "Source URL query keys must be unique.",
      });
    } else {
      query[key] = value;
    }
  }

  return { query, issues };
}

function mergeQueryMaps(
  base: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.assign(Object.create(null), base, overrides) as Record<
    string,
    string
  >;
}

function pathPrefixCovers(pathname: string, prefix: string): boolean {
  return (
    prefix === "/" ||
    pathname === prefix ||
    pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
  );
}

function queryMapsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function finalizeWeb2JsonManifestDraft(
  draft: Web2JsonManifestDraftV1,
): Web2JsonManifestFinalization {
  const sourceValidation = validateComposerSourceUrl(draft.fields.sourceUrl);
  if (!sourceValidation.valid) {
    return {
      valid: false,
      issues: [{ ...sourceValidation.issue }],
    };
  }

  const source = new URL(draft.fields.sourceUrl);
  const urlQuery = sourceUrlQuery(source);
  const editorQuery = queryRowsToMap(draft.fields.queryRows);
  const expectedQuery = rowsToSafeMap(draft.fields.expectedQueryRows);
  const transform = validateComposerTransformFields({
    jq: draft.fields.jq,
    abiSignature: draft.fields.abiSignature,
  });
  const trust = validateComposerTrustFields({
    expectedScheme: draft.fields.expectedScheme,
    expectedHost: draft.fields.expectedHost,
    expectedPathPrefix: draft.fields.expectedPathPrefix,
    expectedQueryRows: draft.fields.expectedQueryRows,
  });
  const effectiveQuery = mergeQueryMaps(urlQuery.query, editorQuery.query);
  const issues: ComposerFinalizationIssue[] = [
    ...urlQuery.issues,
    ...editorQuery.issues,
    ...(transform.valid ? [] : transform.issues),
    ...(trust.valid ? [] : trust.issues),
  ];

  if (draft.fields.expectedHost !== source.hostname.toLowerCase()) {
    issues.push({
      field: "expectedHost",
      code: "TRUST_HOST_MISMATCH",
      message: "Expected host must exactly match the normalized source host.",
    });
  }
  if (!pathPrefixCovers(source.pathname, draft.fields.expectedPathPrefix)) {
    issues.push({
      field: "expectedPathPrefix",
      code: "TRUST_PATH_NOT_COVERED",
      message: "Expected path prefix must cover the complete source path segment.",
    });
  }
  if (!queryMapsEqual(expectedQuery, effectiveQuery)) {
    issues.push({
      field: "expectedQueryRows",
      code: "TRUST_QUERY_MISMATCH",
      message: "Expected query must exactly match every effective request query value.",
    });
  }
  if (draft.fields.feeCapWei === "") {
    issues.push({
      field: "feeCapWei",
      code: "SUBMISSION_FEE_CAP_REQUIRED",
      message: "Enter a submission fee cap in wei.",
    });
  }

  if (issues.length > 0 || !transform.valid) {
    return { valid: false, issues };
  }

  const manifest = {
    version: "1",
    attestationType: "Web2Json",
    network: "coston2",
    request: {
      method: "GET",
      url: draft.fields.sourceUrl,
      query: editorQuery.query,
      jq: draft.fields.jq,
      abiSignature: transform.canonicalAbiSignature,
    },
    consumer: {
      expectedScheme: "https",
      expectedHost: draft.fields.expectedHost,
      expectedPathPrefix: draft.fields.expectedPathPrefix,
      expectedQuery,
    },
    submission: {
      mode: draft.fields.submissionMode,
      feeCapWei: draft.fields.feeCapWei,
    },
  } as const satisfies Web2JsonManifestV1;
  Web2JsonManifestV1Schema.parse(manifest);

  return {
    valid: true,
    manifest,
    canonicalJson: canonicalJson(manifest),
  };
}

export function serializeComposerDraftV1(
  draft: Web2JsonManifestDraftV1,
): string {
  return JSON.stringify(Web2JsonManifestDraftV1Schema.parse(draft));
}

export function decodeComposerDraftV1(
  raw: string | null,
): ComposerDraftDecodeResult {
  if (raw === null) return { state: "empty" };
  if (utf8ByteLength(raw) > MAX_DRAFT_UTF8_BYTES) {
    return { state: "rejected", reason: "oversized" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { state: "rejected", reason: "corrupt" };
  }

  if (
    typeof decoded === "object" &&
    decoded !== null &&
    !Array.isArray(decoded) &&
    Object.hasOwn(decoded, "version") &&
    (decoded as { version: unknown }).version !== "1"
  ) {
    return { state: "rejected", reason: "unsupported-version" };
  }

  const parsed = Web2JsonManifestDraftV1Schema.safeParse(decoded);
  return parsed.success
    ? { state: "restored", draft: parsed.data }
    : { state: "rejected", reason: "invalid" };
}
