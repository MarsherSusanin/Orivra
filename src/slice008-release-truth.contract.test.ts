import { afterEach, describe, expect, it, vi } from "vitest";
import { validDiagnostic } from "../packages/contracts/test/fixtures";
import { createLiveSurfaceServices } from "./services/run-surface";

const projectToken = `project_${"8".repeat(64)}`;
const context = {
  runId: "run_slice008_surface",
  projectToken,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function live(fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetch);
  return createLiveSurfaceServices({
    baseUrl: "https://api.proofline.test",
    projectToken,
    storage: { getItem: () => null, setItem: () => undefined },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Slice 008 Web consumer intent and fail-closed diagnostics", () => {
  it("submits the canonical vulnerable consumer explicitly", async () => {
    const fetch = vi.fn(async () =>
      response(
        {
          summary: "Consumer needs one fix",
          code: "EXPECTED_HOST_NOT_ENFORCED",
          checks: [],
        },
        202,
      ),
    );

    await expect(live(fetch).verifyConsumer(context)).resolves.toMatchObject({
      code: "EXPECTED_HOST_NOT_ENFORCED",
    });
    const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(request[0]).pathname).toBe(
      "/v1/runs/run_slice008_surface/consumer-verifications",
    );
    expect(JSON.parse(String(request[1].body))).toEqual({
      consumer: "canonical-vulnerable",
    });
  });

  it("never maps a failed terminal projection without diagnostics to CONSUMER_VERIFIED", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockResolvedValueOnce(
        response({
          terminal: true,
          stages: { consumer: "failed" },
          consumerVerified: false,
          diagnostics: [],
        }),
      );

    await expect(live(fetch).verifyConsumer(context)).rejects.toThrow(
      /diagnostic|evidence|fail closed/i,
    );
  });

  it("preserves diagnostic code, evidence, and remediation from API to the surface", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          runId: context.runId,
          sequence: 7,
          terminal: true,
          stages: { consumer: "failed" },
          diagnostics: [validDiagnostic],
        }),
      )
      .mockResolvedValueOnce(response({ events: [], nextAfter: 0 }));

    await expect(
      live(fetch).hydrateRun!({ ...context, after: 0 }),
    ).resolves.toMatchObject({
      diagnostics: [
        {
          version: "1",
          code: validDiagnostic.code,
          severity: validDiagnostic.severity,
          confidence: validDiagnostic.confidence,
          summary: validDiagnostic.summary,
          evidence: validDiagnostic.evidence,
          remediation: validDiagnostic.remediation,
        },
      ],
    });
  });
});
