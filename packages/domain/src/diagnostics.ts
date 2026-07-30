import {
  DiagnosticV1Schema,
  Web2JsonManifestV1Schema,
  type DiagnosticV1,
  type Web2JsonManifestV1,
} from "@proofline/contracts";

function normalizedHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, "");
}

function isPathWithinPrefix(path: string, prefix: string): boolean {
  if (prefix === "/") return path.startsWith("/");
  if (prefix.endsWith("/")) return path.startsWith(prefix);
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function canonicalizeManifestUrl(manifestValue: Web2JsonManifestV1): string {
  const manifest = Web2JsonManifestV1Schema.parse(manifestValue);
  const source = new URL(manifest.request.url);
  const query = new URLSearchParams(source.search);
  for (const [key, value] of Object.entries(manifest.request.query)) {
    query.set(key, value);
  }

  const sorted = new URLSearchParams();
  for (const key of [...new Set(query.keys())].sort()) {
    sorted.set(key, query.get(key)!);
  }

  const queryString = sorted.toString();
  return `https://${normalizedHost(source.hostname)}${source.pathname}${queryString ? `?${queryString}` : ""}`;
}

type DiagnosticDetails = Omit<DiagnosticV1, "version" | "severity" | "confidence">;

function mismatch(details: DiagnosticDetails): DiagnosticV1 {
  return DiagnosticV1Schema.parse({
    version: "1",
    severity: "error",
    confidence: "high",
    ...details,
  });
}

export function diagnoseConsumerRequest(
  manifestValue: Web2JsonManifestV1,
  requestUrl: string,
): DiagnosticV1[] {
  const manifest = Web2JsonManifestV1Schema.parse(manifestValue);
  let actual: URL;
  try {
    actual = new URL(requestUrl);
  } catch {
    return [
      mismatch({
        code: "CONSUMER_URL_INVALID",
        summary: "Consumer request URL is not valid.",
        evidence: { expected: "absolute URL", actual: requestUrl, requestUrl },
        remediation: "Reject malformed request URLs before verifying proof data.",
      }),
    ];
  }

  const diagnostics: DiagnosticV1[] = [];
  const actualScheme = actual.protocol.replace(/:$/, "").toLowerCase();
  if (actualScheme !== manifest.consumer.expectedScheme) {
    diagnostics.push(
      mismatch({
        code: "CONSUMER_SCHEME_MISMATCH",
        summary: "Consumer request scheme does not match the manifest invariant.",
        evidence: {
          expected: manifest.consumer.expectedScheme,
          actual: actualScheme,
          requestUrl,
        },
        remediation: "Enforce HTTPS before decoding proof data.",
      }),
    );
  }

  const expectedHost = normalizedHost(manifest.consumer.expectedHost);
  const actualHost = normalizedHost(actual.hostname);
  if (actualHost !== expectedHost) {
    diagnostics.push(
      mismatch({
        code: "CONSUMER_HOST_MISMATCH",
        summary: "Consumer request host does not match the manifest invariant.",
        evidence: { expected: expectedHost, actual: actualHost, requestUrl },
        remediation: "Enforce the exact normalized host before decoding proof data.",
      }),
    );
  }

  if (!isPathWithinPrefix(actual.pathname, manifest.consumer.expectedPathPrefix)) {
    diagnostics.push(
      mismatch({
        code: "CONSUMER_PATH_MISMATCH",
        summary: "Consumer request path is outside the manifest path invariant.",
        evidence: {
          expected: manifest.consumer.expectedPathPrefix,
          actual: actual.pathname,
          requestUrl,
        },
        remediation: "Enforce the expected path prefix at a path-segment boundary.",
      }),
    );
  }

  for (const [key, expected] of Object.entries(manifest.consumer.expectedQuery)) {
    const actualValue = actual.searchParams.get(key);
    if (actualValue !== expected) {
      diagnostics.push(
        mismatch({
          code: "CONSUMER_QUERY_MISMATCH",
          summary: "Consumer request query does not match the manifest invariant.",
          evidence: { key, expected, actual: actualValue, requestUrl },
          remediation: "Enforce every expected query value before decoding proof data.",
        }),
      );
    }
  }

  return diagnostics;
}
