// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveSurfaceServices } from "./run-surface";

const projectToken = `project_${"a".repeat(64)}`;
const runId = "run_hydration";
const transactionHash = `0x${"c".repeat(64)}`;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function live(fetch: ReturnType<typeof vi.fn>, token = projectToken) {
  vi.stubGlobal("fetch", fetch);
  return createLiveSurfaceServices({
    baseUrl: "https://api.proofline.test",
    projectToken: token,
    storage: { getItem: () => null, setItem: () => undefined },
  });
}

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  occurredAt: string,
) {
  return { sequence, type, payload, occurredAt };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live run hydration", () => {
  it("maps a full event journal into title, stages, diagnostics, and evidence", async () => {
    const events = [
      event(1, "RUN_CREATED", {
        manifest: {
          attestationType: "Web2Json",
          network: "coston2",
          consumer: { expectedHost: "api.example.com" },
        },
      }, "2025-05-15T12:04:11.000Z"),
      event(2, "PREFLIGHT_ACCEPTED", { quotedFeeWei: "12345000000000000" }, "2025-05-15T12:04:14.000Z"),
      event(3, "REQUEST_SUBMITTED", { transactionHash }, "2025-05-15T12:04:26.000Z"),
      event(4, "ROUND_FINALIZED", { votingRound: 42871 }, "2025-05-15T12:05:56.000Z"),
      event(5, "PROOF_AVAILABLE", {}, "2025-05-15T12:06:08.000Z"),
      event(6, "PROOF_VERIFIED", {}, "2025-05-15T12:06:09.000Z"),
      event(7, "CONSUMER_VERIFIED", {
        diagnostics: [{
          code: "CONSUMER_HOST_MISMATCH",
          summary: "Host mismatch",
          severity: "error",
          confidence: "high",
          evidence: { expected: "api.example.com" },
          remediation: "Enforce the exact host.",
        }],
      }, "2025-05-15T12:06:11.000Z"),
      null,
    ];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({
        sequence: 7,
        terminal: true,
        stages: {
          preflight: "completed",
          request: "completed",
          round: "completed",
          proof: "completed",
          verify: "completed",
          consumer: "failed",
        },
      }))
      .mockResolvedValueOnce(response({ events, nextAfter: 7 }));

    const hydrated = await live(fetch).hydrateRun!({
      runId,
      projectToken,
      after: 0,
    });

    expect(hydrated).toMatchObject({
      runId,
      title: "Web2Json · api.example.com",
      attestationType: "Web2Json",
      network: "coston2",
      sequence: 7,
      terminal: true,
      stages: { consumer: "failed" },
      diagnostics: [{
        code: "CONSUMER_HOST_MISMATCH",
        severity: "error",
        confidence: "high",
      }],
      evidence: {
        transactionHash,
        votingRound: "42871",
        fee: "0.012345 ETH",
        elapsed: "2m 0s",
        explorerUrl: `https://coston2-explorer.flare.network/tx/${transactionHash}`,
      },
    });
    expect(hydrated.stageDetails?.round).toEqual({
      time: "12:05:56",
      duration: "1m 30s",
    });
    expect(String(fetch.mock.calls[1][0])).toContain("events?after=0");
  });

  it("prefers explicit API presentation fields and incrementally reuses cached events", async () => {
    const events = [
      event(1, "RUN_CREATED", { manifest: {} }, "invalid-date"),
      event(2, "PREFLIGHT_ACCEPTED", { quotedFeeWei: "invalid" }, "2025-05-15T12:04:14.000Z"),
      event(3, "REQUEST_SUBMITTED", {}, "2025-05-15T12:04:26.000Z"),
    ];
    const projection = {
      title: "Explicit run title",
      attestationType: "Web2Json",
      network: "Coston2",
      startedAt: "2025-05-15T12:04:00.000Z",
      sequence: 3,
      terminal: false,
      stages: {
        preflight: "completed",
        request: "completed",
        round: "active",
        proof: "unexpected",
        verify: 42,
        consumer: "pending",
      },
      diagnostics: [
        null,
        { code: "", summary: "ignored" },
        {
          code: "CONSUMER_PATH_MISMATCH",
          summary: "Path mismatch",
          severity: "unknown",
          confidence: "unknown",
          evidence: "invalid",
        },
      ],
      evidence: {
        transactionHash,
        votingRound: "99",
        fee: "1 ETH",
        elapsed: "12s",
        explorerUrl: "https://example.test/tx",
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(projection))
      .mockResolvedValueOnce(response({ events, nextAfter: 3 }))
      .mockResolvedValueOnce(response({ ...projection, terminal: true }))
      .mockResolvedValueOnce(response({ events: [{ sequence: "bad" }, "invalid"], nextAfter: 3 }));
    const services = live(fetch);

    const first = await services.hydrateRun!({ runId, projectToken, after: 0 });
    const second = await services.hydrateRun!({ runId, projectToken, after: 3 });

    expect(first).toMatchObject({
      title: "Explicit run title",
      diagnostics: [{ severity: "warning", confidence: "medium" }],
      evidence: projection.evidence,
      stages: { proof: "pending", verify: "pending" },
    });
    expect(first.stageDetails?.preflight).toEqual({ time: "—", duration: "—" });
    expect(second.terminal).toBe(true);
    expect(String(fetch.mock.calls[3][0])).toContain("events?after=3");
  });

  it("fails closed with missing credentials and safely maps malformed optional data", async () => {
    const deniedFetch = vi.fn();
    await expect(
      live(deniedFetch, "").hydrateRun!({ runId, projectToken: "", after: 0 }),
    ).rejects.toThrow(/project token/i);
    expect(deniedFetch).not.toHaveBeenCalled();

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ stages: null, diagnostics: "invalid" }))
      .mockResolvedValueOnce(response({ events: "invalid", nextAfter: 0 }));
    const hydrated = await live(fetch).hydrateRun!({ runId, projectToken, after: 9 });
    expect(hydrated).toMatchObject({
      title: "Web2Json run",
      sequence: 0,
      terminal: false,
      stages: {
        preflight: "pending",
        request: "pending",
        round: "pending",
        proof: "pending",
        verify: "pending",
        consumer: "pending",
      },
      diagnostics: [],
      evidence: {},
    });
  });
});

describe("failed consumer verification polling", () => {
  it("returns an evidence-backed failed terminal projection without timing out", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ accepted: true }, 202))
      .mockResolvedValueOnce(response({
        stages: { consumer: "failed" },
        diagnostics: [{ code: "CONSUMER_HOST_MISMATCH" }],
      }));
    await expect(
      live(fetch).verifyConsumer({ runId, projectToken }),
    ).resolves.toMatchObject({
      summary: "Consumer needs one fix",
      code: "CONSUMER_HOST_MISMATCH",
      checks: expect.arrayContaining([
        { label: "Source host invariant", status: "failed" },
      ]),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
