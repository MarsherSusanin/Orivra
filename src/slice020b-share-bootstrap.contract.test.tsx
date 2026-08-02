import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_ID } from "../packages/contracts/test/fixtures";
import { App } from "./App";
import type { HydratedRunView, RunSurfaceServices } from "./services/run-surface";

const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const SESSION_KEY = `proofline:share-token:${RUN_ID}`;

const terminalRun = {
  runId: RUN_ID,
  title: "Shared evidence",
  network: "coston2",
  sequence: 7,
  terminal: true,
  stages: {
    preflight: "completed",
    request: "completed",
    round: "completed",
    proof: "completed",
    verify: "completed",
    consumer: "completed",
  },
  evidence: {},
} as HydratedRunView;

function services(hydrateRun = vi.fn().mockResolvedValue(terminalRun)) {
  return {
    hydrateRun,
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
  } as unknown as RunSurfaceServices;
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("Slice 020B synchronous share capability bootstrap", () => {
  it("moves an exact fragment into run-scoped session state before the first read", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}#share=${SHARE_TOKEN}`);
    const replaceState = vi.spyOn(window.history, "replaceState");
    const hydrateRun = vi.fn().mockResolvedValue(terminalRun);

    render(<App services={services(hydrateRun)} />);

    expect(window.location.hash).toBe("");
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(SHARE_TOKEN);
    expect(sessionStorage.getItem("proofline:project-token")).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain(SHARE_TOKEN);
    await waitFor(() => expect(hydrateRun).toHaveBeenCalledOnce());
    expect(hydrateRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      projectToken: SHARE_TOKEN,
    }));
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(
      hydrateRun.mock.invocationCallOrder[0],
    );
  });

  it("restores only the matching run capability after reload", async () => {
    sessionStorage.setItem(SESSION_KEY, SHARE_TOKEN);
    sessionStorage.setItem("proofline:share-token:run_other", `share_${"c".repeat(64)}`);
    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    const hydrateRun = vi.fn().mockResolvedValue(terminalRun);

    const first = render(<App services={services(hydrateRun)} />);
    await waitFor(() => expect(hydrateRun).toHaveBeenCalledOnce());
    first.unmount();
    render(<App services={services(hydrateRun)} />);
    await waitFor(() => expect(hydrateRun).toHaveBeenCalledTimes(2));
    expect(hydrateRun.mock.calls.map(([context]) => context.projectToken)).toEqual([
      SHARE_TOKEN,
      SHARE_TOKEN,
    ]);
  });

  it.each([
    ["query token", `/runs/${RUN_ID}?share=${SHARE_TOKEN}&status=active`, "?status=active"],
    ["malformed fragment", `/runs/${RUN_ID}#share=share_deadbeef`, ""],
  ])("scrubs and rejects a %s without storage or network", async (_label, path, search) => {
    window.history.replaceState({}, "", path);
    const hydrateRun = vi.fn().mockResolvedValue(terminalRun);
    render(<App services={services(hydrateRun)} />);

    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(search);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    await Promise.resolve();
    expect(hydrateRun).not.toHaveBeenCalled();
  });

  it("does not reuse a capability stored for another run", async () => {
    sessionStorage.setItem("proofline:share-token:run_other", SHARE_TOKEN);
    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    const hydrateRun = vi.fn().mockResolvedValue(terminalRun);
    render(<App services={services(hydrateRun)} />);
    await Promise.resolve();
    expect(hydrateRun).not.toHaveBeenCalled();
  });
});
