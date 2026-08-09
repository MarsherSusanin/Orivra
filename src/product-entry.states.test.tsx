import axe from "axe-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";

const projectToken = `project_${"a".repeat(64)}`;
const run = {
  version: "1" as const,
  runId: "run_active",
  network: "coston2" as const,
  sourceHost: "api.example.com",
  submissionMode: "wallet" as const,
  currentStage: "proof" as const,
  status: "active" as const,
  createdAt: "2026-08-02T01:00:00.000Z",
  updatedAt: "2026-08-02T02:00:00.000Z",
  lastSequence: 5,
  resumable: true,
};

function services(overrides: Partial<RunSurfaceServices> = {}): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [] }),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
    ...overrides,
  } as RunSurfaceServices;
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("run discovery states", () => {
  it("moves from loading to a recent resumable run without hiding its status", async () => {
    window.history.replaceState({}, "", "/runs?status=active");
    let resolvePage!: (value: { version: "1"; runs: [typeof run] }) => void;
    const listRuns = vi.fn().mockReturnValue(
      new Promise((resolve) => { resolvePage = resolve; }),
    );
    render(<App projectToken={projectToken} services={services({ listRuns })} />);

    expect(screen.getByRole("heading", { name: /loading runs/i })).toBeVisible();
    resolvePage({ version: "1", runs: [run] });

    const recent = await screen.findByRole("region", { name: /recent runs/i });
    expect(within(recent).getByRole("link", { name: /api\.example\.com/i })).toHaveAttribute(
      "href",
      "/runs/run_active",
    );
    expect(within(recent).getByText("Resumable")).toBeVisible();
    expect(within(recent).getByText("active")).toBeVisible();
    expect(listRuns).toHaveBeenCalledWith({ projectToken, status: "active", limit: 20 });
  });

  it("shows an honest empty project state and disabled future navigation", async () => {
    window.history.replaceState({}, "", "/runs");
    render(<App projectToken={projectToken} services={services()} />);

    expect(await screen.findByRole("heading", { name: /no runs yet/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /browse templates/i })).toHaveAttribute(
      "href",
      "/templates",
    );
    for (const label of ["Requests", "Consumers", "CI"]) {
      const item = screen.getByRole("button", { name: label });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).not.toBeDisabled();
      expect(item).not.toHaveAttribute("href");
    }
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("keeps an unavailable list actionable without leaking its credential", async () => {
    window.history.replaceState({}, "", "/runs");
    render(
      <App
        projectToken={projectToken}
        services={services({
          listRuns: vi.fn().mockRejectedValue(new Error("Proofline API 503: unavailable")),
        })}
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unavailable/i);
    expect(within(alert).getByRole("button", { name: /reconnect wallet session/i })).toBeEnabled();
    expect(alert).not.toHaveTextContent(projectToken);
  });

  it("exposes the /runs/new Composer route without losing the 014 entry shell", () => {
    window.history.replaceState({}, "", "/runs/new");
    render(<App services={services()} />);

    expect(screen.getByRole("heading", { name: /new web2json run/i })).toBeVisible();
    expect(screen.getByRole("navigation", { name: /composer steps/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /back to runs/i })).toHaveAttribute("href", "/runs");
  });

  it("emits Composer analytics only for the explicit start action", () => {
    window.history.replaceState({}, "", "/runs");
    const analytics = { emit: vi.fn() };
    render(<App services={services()} analytics={analytics} />);

    expect(analytics.emit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: /start a web2json run/i }));
    expect(analytics.emit).toHaveBeenCalledOnce();
    expect(analytics.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.stringMatching(
          /^session_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        name: "COMPOSER_STARTED",
        metadata: { entryPoint: "runs" },
      }),
    );
  });

  it("has no serious or critical accessibility violations", async () => {
    window.history.replaceState({}, "", "/runs");
    const { container } = render(
      <App
        projectToken={projectToken}
        services={services({
          listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [run] }),
        })}
      />,
    );
    await screen.findByRole("region", { name: /recent runs/i });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  });
});
