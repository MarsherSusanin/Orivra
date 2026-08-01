import {
  PreflightReportV1Schema,
  Web2JsonManifestV1Schema,
  type NormalizedFdcError,
  type PreflightBlockerV1,
  type PreflightDiagnosticV1,
  type PreflightReportV1,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import {
  canonicalSerializePreflightReport,
  canonicalizeManifestUrl,
  createRedactedJsonShape,
  fingerprintCanonicalJson,
} from "@proofline/domain";
import { createHash } from "node:crypto";
import { createFdcError } from "./errors";
import { assertSafeWeb2JsonUrl } from "./safe-http";

const CREDENTIAL_QUERY_NAMES = new Set([
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
]);

const PRIVATE_QUERY_VALUE =
  /(?:project|share)_[A-Za-z0-9_-]{32,}|Bearer\s+[^\s;,]+|^0x[a-fA-F0-9]{64}$/i;

function isCredentialQueryName(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const withoutVersionSuffix = normalized.replace(/v\d+$/, "");
  return CREDENTIAL_QUERY_NAMES.has(withoutVersionSuffix);
}

function assertPublicQueryEntry(key: string, value: string): void {
  if (isCredentialQueryName(key) || PRIVATE_QUERY_VALUE.test(value.trim())) {
    throw new Error("Public Web2Json query cannot contain secret credentials");
  }
}

export function assertManifestHasNoSecrets(manifest: Web2JsonManifestV1): void {
  const url = assertSafeWeb2JsonUrl(manifest.request.url);
  for (const [key, value] of url.searchParams) {
    assertPublicQueryEntry(key, value);
  }
  for (const [key, value] of Object.entries(manifest.request.query)) {
    assertPublicQueryEntry(key, value);
  }
}

export interface PreflightRegistrySnapshot {
  chainId: 114;
  blockNumber: string;
  registryAddress: string;
  resolvedContracts: {
    FdcHub: string;
    FdcRequestFeeConfigurations: string;
    FdcVerification: string;
    Relay: string;
  };
}

export interface PreflightPorts {
  safeFetcher: { getJson(url: string): Promise<unknown> };
  transformJq(value: unknown, jq: string): Promise<unknown>;
  abiEncode(value: unknown, signature: string): string;
  verifier: {
    prepareRequest(manifest: Web2JsonManifestV1): Promise<{ requestBytes: string }>;
  };
  feeOracle: {
    quote(input: { fdcHub: string; requestBytes: string }): Promise<bigint>;
  };
}

export interface Web2JsonPreflightInput extends PreflightPorts {
  runId: string;
  manifest: Web2JsonManifestV1;
  samples: number;
  fdcHub: string;
  networkSnapshot: PreflightRegistrySnapshot;
}

export interface PreflightSubmissionEvidence {
  canonicalUrl: string;
  requestBytes: string;
  quotedFeeWei: bigint;
}

export type Web2JsonPreflightOutcome =
  | {
      kind: "accepted";
      report: PreflightReportV1;
      submissionEvidence: PreflightSubmissionEvidence;
    }
  | {
      kind: "blocked";
      report: PreflightReportV1;
      error: NormalizedFdcError;
    };

function bytesFromHex(value: string, label: string): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw createFdcError(
      "schema-invalid",
      "PREFLIGHT_HEX_EVIDENCE_INVALID",
      `${label} must be non-empty hexadecimal bytes`,
      false,
      { evidenceField: label },
    );
  }
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
}

function fingerprintHexBytes(value: string, label: string): string {
  return `sha256:${createHash("sha256")
    .update(bytesFromHex(value, label))
    .digest("hex")}`;
}

function pathPrefixCovers(pathname: string, prefix: string): boolean {
  return (
    prefix === "/" ||
    pathname === prefix ||
    pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
  );
}

function queryEntries(value: URL): Array<[string, string]> {
  return [...value.searchParams.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function expectedQueryEntries(
  query: Readonly<Record<string, string>>,
): Array<[string, string]> {
  return Object.entries(query).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function trustBlockers(
  manifest: Web2JsonManifestV1,
  canonicalUrl: string,
): PreflightBlockerV1[] {
  const source = new URL(canonicalUrl);
  const blockers: PreflightBlockerV1[] = [];
  if (manifest.consumer.expectedHost !== source.hostname.toLowerCase()) {
    blockers.push("PREFLIGHT_TRUST_HOST_MISMATCH");
  }
  if (!pathPrefixCovers(source.pathname, manifest.consumer.expectedPathPrefix)) {
    blockers.push("PREFLIGHT_TRUST_PATH_MISMATCH");
  }
  const actualQuery = queryEntries(source);
  if (
    new Set(actualQuery.map(([key]) => key)).size !== actualQuery.length ||
    JSON.stringify(expectedQueryEntries(manifest.consumer.expectedQuery)) !==
      JSON.stringify(actualQuery)
  ) {
    blockers.push("PREFLIGHT_TRUST_QUERY_MISMATCH");
  }
  return blockers;
}

const BLOCKER_DIAGNOSTICS: Record<
  PreflightBlockerV1,
  Omit<PreflightDiagnosticV1, "version" | "code" | "severity" | "confidence">
> = {
  PREFLIGHT_SOURCE_NONDETERMINISTIC: {
    summary: "Five transformed samples did not produce one stable result.",
    evidence: { reportFields: ["sampleFingerprints", "determinism"] },
    remediation: "Use a source and transform with stable public output.",
  },
  PREFLIGHT_ABI_INCOMPATIBLE: {
    summary: "At least one transformed sample is incompatible with the declared ABI.",
    evidence: { reportFields: ["abiCompatibility"] },
    remediation: "Align the JQ output with the declared ABI parameter descriptor.",
  },
  PREFLIGHT_FEE_CAP_EXCEEDED: {
    summary: "The registry fee quote exceeds the manifest fee cap.",
    evidence: { reportFields: ["fee"] },
    remediation: "Increase the cap or wait for a lower registry quote.",
  },
  PREFLIGHT_TRUST_HOST_MISMATCH: {
    summary: "The expected consumer host does not match the canonical request host.",
    evidence: { reportFields: ["canonicalUrl"] },
    remediation: "Set Trust host to the exact normalized source host.",
  },
  PREFLIGHT_TRUST_PATH_MISMATCH: {
    summary: "The expected consumer path does not cover the canonical request path.",
    evidence: { reportFields: ["canonicalUrl"] },
    remediation: "Set a segment-safe path prefix that covers the source path.",
  },
  PREFLIGHT_TRUST_QUERY_MISMATCH: {
    summary: "The expected consumer query does not match every effective request input.",
    evidence: { reportFields: ["canonicalUrl"] },
    remediation: "Make the Trust query exactly match the canonical request query.",
  },
};

function blockerDiagnostic(blocker: PreflightBlockerV1): PreflightDiagnosticV1 {
  return {
    version: "1",
    code: blocker,
    severity: "error",
    confidence: "high",
    ...BLOCKER_DIAGNOSTICS[blocker],
  };
}

function truncationDiagnostics(input: {
  responseShapeTruncated: boolean;
  jqShapeTruncated: boolean;
}): PreflightDiagnosticV1[] {
  const diagnostics: PreflightDiagnosticV1[] = [];
  if (input.responseShapeTruncated) {
    diagnostics.push({
      version: "1",
      code: "PREFLIGHT_RESPONSE_SHAPE_TRUNCATED",
      severity: "warning",
      confidence: "high",
      summary: "The response shape exceeded the bounded public preview.",
      evidence: { reportFields: ["responseShape"] },
      remediation: "Review the source schema before submission.",
    });
  }
  if (input.jqShapeTruncated) {
    diagnostics.push({
      version: "1",
      code: "PREFLIGHT_JQ_SHAPE_TRUNCATED",
      severity: "warning",
      confidence: "high",
      summary: "The transformed shape exceeded the bounded public preview.",
      evidence: { reportFields: ["jqPreview"] },
      remediation: "Narrow the transform before submission.",
    });
  }
  return diagnostics;
}

function blockedError(
  blocker: PreflightBlockerV1,
  diagnostic: PreflightDiagnosticV1,
): NormalizedFdcError {
  const category =
    blocker === "PREFLIGHT_SOURCE_NONDETERMINISTIC" ||
    blocker === "PREFLIGHT_ABI_INCOMPATIBLE"
      ? "schema-invalid"
      : "configuration";
  return createFdcError(category, blocker, diagnostic.summary, false, {
    reportFields: diagnostic.evidence.reportFields,
  });
}

export async function runWeb2JsonPreflight(
  input: Web2JsonPreflightInput,
): Promise<Web2JsonPreflightOutcome> {
  if (input.samples !== 5) {
    throw createFdcError(
      "configuration",
      "PREFLIGHT_SAMPLE_COUNT_INVALID",
      "Web2Json preflight requires exactly five determinism samples",
      false,
      { sampleCount: input.samples, requiredSampleCount: 5 },
    );
  }

  const manifest = Web2JsonManifestV1Schema.parse(input.manifest);
  assertManifestHasNoSecrets(manifest);
  if (
    input.fdcHub.toLowerCase() !==
    input.networkSnapshot.resolvedContracts.FdcHub.toLowerCase()
  ) {
    throw createFdcError(
      "configuration",
      "PREFLIGHT_FDC_HUB_SNAPSHOT_MISMATCH",
      "Preflight FdcHub must match the fixed registry snapshot",
      false,
      { reportFields: ["registrySnapshot"] },
    );
  }

  const canonicalUrl = canonicalizeManifestUrl(manifest);
  const sourceSamples: unknown[] = [];
  const transformedSamples: unknown[] = [];
  const sampleFingerprints: string[] = [];
  const encodedSamples: string[] = [];
  let abiCompatible = true;

  for (let index = 0; index < input.samples; index += 1) {
    const source = await input.safeFetcher.getJson(canonicalUrl);
    sourceSamples.push(source);
    const transformed = await input.transformJq(source, manifest.request.jq);
    transformedSamples.push(transformed);
    sampleFingerprints.push(fingerprintCanonicalJson(transformed));
    try {
      const encoded = input.abiEncode(transformed, manifest.request.abiSignature);
      bytesFromHex(encoded, "ABI encoded sample");
      encodedSamples.push(encoded);
    } catch {
      abiCompatible = false;
    }
  }

  const canonicalManifest: Web2JsonManifestV1 = {
    ...manifest,
    request: { ...manifest.request, url: canonicalUrl },
  };
  const { requestBytes } = await input.verifier.prepareRequest(canonicalManifest);
  const requestIdentitySha256 = fingerprintHexBytes(requestBytes, "request bytes");
  const quotedFeeWei = await input.feeOracle.quote({
    fdcHub: input.fdcHub,
    requestBytes,
  });
  if (quotedFeeWei < 0n) {
    throw createFdcError(
      "configuration",
      "FEE_QUOTE_OUT_OF_BOUNDS",
      "The registry fee quote cannot be negative",
      false,
      { quotedFeeWei: quotedFeeWei.toString() },
    );
  }

  const distinctFingerprints = new Set(sampleFingerprints).size;
  const representativeEncoding = encodedSamples[0];
  abiCompatible = abiCompatible && encodedSamples.length === 5;
  const responseShape = createRedactedJsonShape(sourceSamples[0]);
  const jqPreview = createRedactedJsonShape(transformedSamples[0]);
  const feeCapWei = BigInt(manifest.submission.feeCapWei);
  const withinCap = quotedFeeWei <= feeCapWei;
  const blockers: PreflightBlockerV1[] = [];
  if (distinctFingerprints !== 1) {
    blockers.push("PREFLIGHT_SOURCE_NONDETERMINISTIC");
  }
  if (!abiCompatible) blockers.push("PREFLIGHT_ABI_INCOMPATIBLE");
  blockers.push(...trustBlockers(manifest, canonicalUrl));
  if (!withinCap) blockers.push("PREFLIGHT_FEE_CAP_EXCEEDED");

  const shapeDiagnostics = truncationDiagnostics({
    responseShapeTruncated: responseShape.truncated,
    jqShapeTruncated: jqPreview.truncated,
  });
  const diagnostics =
    blockers.length > 0 ? blockers.map(blockerDiagnostic) : shapeDiagnostics;
  const verdict =
    blockers.length > 0
      ? "blocked"
      : shapeDiagnostics.length > 0
        ? "attention"
        : "ready";
  const abiCompatibility = abiCompatible
    ? {
        compatible: true as const,
        checkedSamples: 5 as const,
        encodedBytes: bytesFromHex(representativeEncoding, "ABI encoded sample").length,
        encodedSha256: fingerprintHexBytes(
          representativeEncoding,
          "ABI encoded sample",
        ),
      }
    : { compatible: false as const, checkedSamples: 5 as const };

  const report = PreflightReportV1Schema.parse({
    version: "1",
    runId: input.runId,
    verdict,
    canonicalUrl,
    requestIdentitySha256,
    sampleFingerprints,
    determinism: {
      passed: distinctFingerprints === 1,
      distinctFingerprints,
    },
    responseShape,
    jqPreview,
    abiCompatibility,
    registrySnapshot: input.networkSnapshot,
    fee: {
      quotedWei: quotedFeeWei.toString(),
      capWei: manifest.submission.feeCapWei,
      withinCap,
    },
    blockers,
    diagnostics,
  });
  canonicalSerializePreflightReport(report);

  if (blockers.length > 0) {
    const errorDiagnostic = diagnostics.find(
      (diagnostic) => diagnostic.code === blockers[0],
    )!;
    return {
      kind: "blocked",
      report,
      error: blockedError(blockers[0], errorDiagnostic),
    };
  }
  return {
    kind: "accepted",
    report,
    submissionEvidence: { canonicalUrl, requestBytes, quotedFeeWei },
  };
}
