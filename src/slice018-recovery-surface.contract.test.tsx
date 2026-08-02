import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, validManifest } from "../packages/contracts/test/fixtures";
import { App } from "./App";
import {
  createLiveSurfaceServices,
  type HydratedRunView,
  type RunSurfaceServices,
} from "./services/run-surface";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function recovery(state: "waiting" | "retryable" | "terminal") {
  return {
    version: "1",
    state,
    stage: state === "retryable" ? "preflight" : state === "waiting" ? "round" : "proof",
    attempt: 2,
    ...(state === "terminal" ? {} : { retryAfter: "2026-08-03T02:00:15.000Z" }),
    resumeFrom: state === "retryable" ? "preflight" : state === "waiting" ? "transaction-receipt" : "da-proof",
    preservedEvidence: state === "retryable" ? [] : ["preflight", "transaction"],
    updatedAt: "2026-08-03T02:00:00.000Z",
    error: {
      version: "1",
      category: state === "waiting" ? "not-finalized" : state === "terminal" ? "proof-invalid" : "transport",
      code: state === "waiting" ? "REQUEST_RECEIPT_PENDING" : state === "terminal" ? "FDC_PROOF_INVALID" : "VERIFIER_TRANSPORT_FAILED",
      message: "Worker command failed",
      retryable: state !== "terminal",
      evidence: {},
    },
    retrySafety: state === "terminal" ? "new-run-required" : "same-command",
  } as const;
}

function run(state: "waiting" | "retryable" | "terminal") {
  return {
    runId: RUN_ID,
    title: "Recovery run",
    attestationType: "Web2Json",
    network: "coston2",
    sequence: 4,
    terminal: state === "terminal",
    submissionMode: "wallet",
    manifest: validManifest,
    stages: {
      preflight: state === "retryable" ? "active" : "completed",
      request: state === "retryable" ? "pending" : "completed",
      round: state === "waiting" ? "active" : state === "terminal" ? "completed" : "pending",
      proof: state === "terminal" ? "failed" : "pending",
      verify: "pending",
      consumer: "pending",
    },
    recovery: recovery(state),
    diagnostics: [],
    evidence: state === "retryable" ? {} : { transactionHash: `0x${"c".repeat(64)}` },
  } as unknown as HydratedRunView;
}

function surface(hydrateRun: ReturnType<typeof vi.fn>): RunSurfaceServices {
  return {
    hydrateRun,
    createRun: vi.fn(),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
  } as unknown as RunSurfaceServices;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("Slice 018 recovery hydration", () => {
  it("maps the strict recovery contract without copying private adapter fields", async () => {
    const expected = recovery("waiting");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({
        sequence: 2,
        terminal: false,
        stages: run("waiting").stages,
        recovery: expected,
      }))
      .mockResolvedValueOnce(response({
        events: [{
          version: "1",
          runId: RUN_ID,
          sequence: 1,
          commandId: "command_create",
          occurredAt: "2026-08-03T01:59:00.000Z",
          type: "RUN_CREATED",
          payload: { manifest: validManifest },
        }],
        nextAfter: 1,
      }));
    vi.stubGlobal("fetch", fetch);
    const services = createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken: PROJECT_TOKEN,
      storage: { getItem: () => null, setItem: () => undefined },
      recoveryStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    const hydrated = await services.hydrateRun!({
      runId: RUN_ID,
      projectToken: PROJECT_TOKEN,
      after: 0,
    });
    expect(hydrated).toMatchObject({ recovery: expected });
    expect(JSON.stringify(hydrated)).not.toMatch(/stack|privateUrl|authorization/i);
  });
});

describe("Slice 018 recovery surface", () => {
  it.each([
    ["waiting", /waiting/i, /transaction receipt/i, null],
    ["retryable", /retry scheduled/i, /same command/i, /refresh status/i],
    ["terminal", /recovery stopped/i, /new run/i, /create new run/i],
  ] as const)("renders one safe %s action from persisted recovery", async (state, title, detail, action) => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    sessionStorage.setItem("proofline:project-token", PROJECT_TOKEN);
    render(<App services={surface(vi.fn().mockResolvedValue(run(state)))} />);

    const panel = await screen.findByRole("region", { name: /run recovery/i });
    expect(panel).toHaveTextContent(title);
    expect(panel).toHaveTextContent(detail);
    expect(panel).toHaveTextContent(/attempt 2/i);
    expect(panel).toHaveTextContent(/last update/i);
    if (action) {
      expect(screen.getByRole("button", { name: action })).toBeVisible();
    } else {
      expect(screen.queryByRole("button", { name: /retry command/i })).not.toBeInTheDocument();
    }
  });

  it("keeps persisted evidence visible when polling goes offline and offers one refresh", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    sessionStorage.setItem("proofline:project-token", PROJECT_TOKEN);
    const hydrateRun = vi
      .fn()
      .mockResolvedValueOnce(run("waiting"))
      .mockRejectedValueOnce(new Error(`Failed to fetch Bearer ${PROJECT_TOKEN}`));
    render(<App services={surface(hydrateRun)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(screen.getByText(/0xcccc/i)).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/offline|connection/i);
    expect(screen.getByText(/0xcccc/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /refresh status/i })).toBeVisible();
    expect(document.body.textContent).not.toContain(PROJECT_TOKEN);
  });

  it("fails visibly on a partial journal without discarding the last projection", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    sessionStorage.setItem("proofline:project-token", PROJECT_TOKEN);
    const partial = {
      ...run("waiting"),
      sync: { state: "partial", projectionSequence: 4, eventSequence: 2 },
    } as unknown as HydratedRunView;
    render(<App services={surface(vi.fn().mockResolvedValue(partial))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/partial|incomplete/i);
    expect(screen.getByRole("button", { name: /refresh status/i })).toBeVisible();
  });
});
