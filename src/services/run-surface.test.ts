import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveSurfaceServices,
  createTestSurfaceServices,
} from "./run-surface";

const projectToken = `project_${"a".repeat(64)}`;
const context = { runId: "run_1", projectToken };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function live(fetch: ReturnType<typeof vi.fn>, storage?: Pick<Storage, "getItem" | "setItem">) {
  vi.stubGlobal("fetch", fetch);
  return createLiveSurfaceServices({
    baseUrl: "https://api.proofline.test",
    projectToken,
    storage: storage ?? { getItem: () => null, setItem: () => undefined },
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live run surface verification orchestration", () => {
  it("ignores stale deployed-consumer evidence until the accepted command completes", async () => {
    vi.useFakeTimers();
    const evidence = (commandId: string) => ({
      version: "1",
      runId: "run_1",
      commandId,
      chainId: 114,
      address: `0x${"1".repeat(40)}`,
      status: "verified",
      observedAt: "2026-08-16T00:00:00.000Z",
      blockNumber: "123",
      registryAddress: `0x${"2".repeat(40)}`,
      codeSizeBytes: 32,
      observedRuntimeBytecodeSha256: `sha256:${"a".repeat(64)}`,
      expectedRuntimeBytecodeSha256: `sha256:${"a".repeat(64)}`,
      sourceSha256: `sha256:${"b".repeat(64)}`,
      compilerVersion: "solc-0.8.36",
      diagnostics: [],
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({
        version: "1",
        runId: "run_1",
        commandId: "command_current",
        status: "pending",
      }, 202))
      .mockResolvedValueOnce(response(evidence("command_previous")))
      .mockResolvedValueOnce(response(evidence("command_current")));

    const pending = live(fetch).verifyDeployedConsumer?.({
      ...context,
      address: `0x${"1".repeat(40)}`,
    });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual(evidence("command_current"));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("returns an immediate service result without polling", async () => {
    const accepted = {
      summary: "Consumer invariants verified",
      code: "CONSUMER_VERIFIED",
      checks: [{ label: "Cryptographic proof", status: "passed" }],
    };
    const fetch = vi.fn().mockResolvedValue(response(accepted, 202));

    await expect(live(fetch).verifyConsumer(context)).resolves.toEqual(accepted);
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("idempotency-key")).toMatch(
      /^verify-consumer-/,
    );
  });

  it("polls until completion and maps every invariant diagnostic", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockResolvedValueOnce(response({ stages: { consumer: "pending" } }))
      .mockResolvedValueOnce(
        response({
          stages: { consumer: "completed" },
          diagnostics: [
            { code: "CONSUMER_SCHEME_MISMATCH" },
            { code: "CONSUMER_HOST_MISMATCH" },
            { code: "CONSUMER_PATH_MISMATCH" },
            { code: "CONSUMER_QUERY_MISMATCH" },
            null,
            "invalid",
            { code: 42 },
          ],
        }),
      );
    const pending = live(fetch).verifyConsumer(context);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual({
      summary: "Consumer needs 4 fixes",
      code: "CONSUMER_SCHEME_MISMATCH",
      checks: [
        { label: "Cryptographic proof", status: "passed" },
        { label: "Request identity", status: "passed" },
        { label: "Source scheme invariant", status: "failed" },
        { label: "Source host invariant", status: "failed" },
        { label: "Source path invariant", status: "failed" },
        { label: "Source query invariant", status: "failed" },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("reports a single fix with all unaffected checks still passing", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockResolvedValueOnce(
        response({
          stages: { consumer: "completed" },
          diagnostics: [{ code: "EXPECTED_HOST_NOT_ENFORCED" }],
        }),
      );
    await expect(live(fetch).verifyConsumer(context)).resolves.toMatchObject({
      summary: "Consumer needs one fix",
      code: "EXPECTED_HOST_NOT_ENFORCED",
      checks: expect.arrayContaining([
        { label: "Source host invariant", status: "failed" },
        { label: "Source scheme invariant", status: "passed" },
      ]),
    });
  });

  it("returns the all-green result for a completed run without diagnostics", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockResolvedValueOnce(
        response({ stages: { consumer: "completed" }, diagnostics: [] }),
      );
    await expect(live(fetch).verifyConsumer(context)).resolves.toMatchObject({
      summary: "Consumer invariants verified",
      code: "CONSUMER_VERIFIED",
    });
  });

  it("propagates polling failures so the cockpit can offer retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockResolvedValueOnce(
        response({ error: { message: "Coston2 projection unavailable" } }, 503),
      );
    await expect(live(fetch).verifyConsumer(context)).rejects.toThrow(
      /projection unavailable/i,
    );
  });

  it("times out after the bounded polling budget and keeps the run retryable", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockImplementation(async () => response({ stages: "invalid" }));
    const pending = live(fetch).verifyConsumer(context).catch((cause) => cause);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/timed out|retry/i),
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(13);
  });

  it.each([
    { runId: "run_1", projectToken: "" },
    { runId: "run_1", projectToken: `project_${"b".repeat(64)}` },
  ])("rejects mutation with an invalid context token %#", async (invalidContext) => {
    const fetch = vi.fn();
    const services = live(fetch);
    await expect(services.verifyConsumer(invalidContext)).rejects.toThrow(
      /project token/i,
    );
    await expect(services.generateConsumer(invalidContext)).rejects.toThrow(
      /project token/i,
    );
    await expect(services.exportBundle(invalidContext)).rejects.toThrow(
      /project token/i,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the configured live service itself has no token", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const services = createLiveSurfaceServices({
      baseUrl: "/api",
      projectToken: "",
      storage: { getItem: () => null, setItem: () => undefined },
    });
    await expect(
      services.verifyConsumer({ runId: "run_1", projectToken: "" }),
    ).rejects.toThrow(/project token/i);
  });
});

describe("live run surface artifact, replay, and resume", () => {
  it("generates, exports, replays, and resumes through the same browser client", async () => {
    const values = new Map([
      ["proofline:last-run", "run_resume"],
      ["proofline:run_resume:after", "7"],
    ]);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({ source: "contract Safe {}", sha256: "a".repeat(64) }, 201),
      )
      .mockResolvedValueOnce(
        new Response('{"version":"1"}', { status: 200 }),
      )
      .mockResolvedValueOnce(
        response({ runId: "run_replay", byteIdentical: true }, 201),
      );
    const services = live(fetch, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });

    await expect(services.generateConsumer(context)).resolves.toMatchObject({
      source: "contract Safe {}",
    });
    const bundle = await services.exportBundle(context);
    expect(bundle).toBe('{"version":"1"}');
    await expect(services.replayBundle(bundle)).resolves.toEqual({
      byteIdentical: true,
    });
    expect(services.resume?.()).toEqual({ runId: "run_resume", after: 7 });
    expect(
      fetch.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("idempotency-key"),
      ),
    ).toEqual([
      expect.stringMatching(/^generate-consumer-/),
      null,
      expect.stringMatching(/^replay-bundle-/),
    ]);
  });

  it("uses a collision-resistant fallback command key when randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fetch = vi.fn().mockResolvedValue(
      response({
        summary: "Consumer invariants verified",
        code: "CONSUMER_VERIFIED",
        checks: [],
      }),
    );

    await live(fetch).verifyConsumer(context);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("idempotency-key")).toBe(
      "verify-consumer-1234-0.5",
    );
    vi.restoreAllMocks();
  });
});

describe("test-only deterministic surface", () => {
  it("provides complete deterministic consumer, artifact, bundle, and replay behavior", async () => {
    const services = createTestSurfaceServices();
    await expect(services.verifyConsumer(context)).resolves.toMatchObject({
      code: "EXPECTED_HOST_NOT_ENFORCED",
    });
    await expect(services.generateConsumer(context)).resolves.toMatchObject({
      source: expect.stringContaining("requireHost"),
      sha256: "0".repeat(64),
    });
    const bundle = await services.exportBundle(context);
    expect(JSON.parse(bundle)).toMatchObject({ version: "1" });
    await expect(services.replayBundle(bundle)).resolves.toEqual({
      byteIdentical: true,
    });
    expect(services.resume?.()).toBeNull();
  });
});
