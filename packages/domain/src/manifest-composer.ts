import {
  Web2JsonManifestDraftV1Schema,
  Web2JsonManifestV1Schema,
  type Web2JsonDraftQueryRowV1,
  type Web2JsonManifestDraftV1,
  type Web2JsonManifestV1,
} from "@proofline/contracts";

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
  return draftFromManifest(
    {
      version: "1",
      attestationType: "Web2Json",
      network: "coston2",
      request: {
        method: "GET",
        url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
        query: {},
        jq: ".data | {amount: .amount, currency: .currency}",
        abiSignature: "{string amount,string currency}",
      },
      consumer: {
        expectedScheme: "https",
        expectedHost: "api.coinbase.com",
        expectedPathPrefix: "/v2/prices/ETH-USD/spot",
        expectedQuery: {},
      },
      submission: {
        mode: "replay",
        feeCapWei: "20000000000000000",
      },
    },
    input,
  );
}
