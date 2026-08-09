import {
  CanonicalUrlAttackDemoSummaryV1Schema,
  type CanonicalUrlAttackDemoSummaryV1,
} from "@proofline/contracts";

const UNAVAILABLE_CODE = "CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE";
const UNAVAILABLE_MESSAGE = "Canonical attack recording unavailable";

export class CanonicalUrlAttackDemoUnavailableError extends Error {
  readonly code = UNAVAILABLE_CODE;

  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "CanonicalUrlAttackDemoUnavailableError";
  }
}

export function createCanonicalUrlAttackDemoClient(input: {
  fetch: typeof globalThis.fetch;
}) {
  return {
    async getSummary(): Promise<CanonicalUrlAttackDemoSummaryV1> {
      try {
        const target = new URL(
          "/api/v1/demo/canonical-url",
          globalThis.location?.origin ?? "http://localhost",
        );
        const response = await Reflect.apply(input.fetch, globalThis, [
          target.toString(),
          {
            method: "GET",
            headers: { accept: "application/json" },
            credentials: "omit",
          },
        ]);
        if (!response.ok) throw new CanonicalUrlAttackDemoUnavailableError();
        const parsed = CanonicalUrlAttackDemoSummaryV1Schema.safeParse(
          await response.json(),
        );
        if (!parsed.success) {
          throw new CanonicalUrlAttackDemoUnavailableError();
        }
        return parsed.data;
      } catch {
        throw new CanonicalUrlAttackDemoUnavailableError();
      }
    },
  };
}

export function canonicalUrlAttackRecordingDownloadHref(
  summary: CanonicalUrlAttackDemoSummaryV1,
): string {
  const parsed = CanonicalUrlAttackDemoSummaryV1Schema.parse(summary);
  return `/api${parsed.downloadPath}`;
}
