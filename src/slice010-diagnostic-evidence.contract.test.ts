import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveSurfaceServices } from "./services/run-surface";

const projectToken = `project_${"a".repeat(64)}`;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Slice 010 Consumer Lab diagnostic evidence", () => {
  it("maps all four known missingChecks and ignores unknown versioned keys", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockResolvedValueOnce(
        response({
          stages: { consumer: "failed" },
          diagnostics: [
            {
              version: "1",
              code: "CONSUMER_INVARIANT_FAILED",
              evidence: {
                missingChecks: [
                  "scheme",
                  "host",
                  "path",
                  "query",
                  "headers",
                  "future-version-key",
                  17,
                  null,
                ],
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const services = createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken,
      storage: { getItem: () => null, setItem: () => undefined },
    });

    const pending = services.verifyConsumer({ runId: "run_slice010", projectToken });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const result = await pending;
    expect(result.checks).toEqual([
      { label: "Cryptographic proof", status: "passed" },
      { label: "Request identity", status: "passed" },
      { label: "Source scheme invariant", status: "failed" },
      { label: "Source host invariant", status: "failed" },
      { label: "Source path invariant", status: "failed" },
      { label: "Source query invariant", status: "failed" },
    ]);
    expect(result.checks).toHaveLength(6);
    expect(result.checks.map((check) => check.label).join(" ")).not.toMatch(
      /headers|future-version-key/i,
    );
  });
});
