import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import appSource from "./App.tsx?raw";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";

function services(): RunSurfaceServices {
  return {
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
    hydrateRun: vi.fn(),
  } as unknown as RunSurfaceServices;
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("production product entry", () => {
  it("renders /runs as the run-discovery entry with a path to Composer", () => {
    window.history.replaceState({}, "", "/runs");

    render(<App services={services()} />);

    expect(screen.getByRole("heading", { name: /^runs$/i })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /start (?:a )?web2json run/i }),
    ).toHaveAttribute("href", "/app/runs/new");
    expect(screen.queryAllByText("ETH/USD snapshot")).toHaveLength(0);
  });

  it("does not ship a hardcoded cockpit run or demo-run fallback", () => {
    expect(appSource).not.toMatch(/\bCOCKPIT_RUN_ID\b/);
    expect(appSource).not.toContain("run_01JYXW5ZC6K9JSGG0TQ7V8N3PH");
  });

  it.each([
    ["sample title", "ETH/USD snapshot"],
    ["sample timestamp", "May 15, 2025"],
    ["sample lifecycle", "initialRunStages"],
  ])("excludes the %s from the production App artifact", (_caseName, marker) => {
    expect(appSource).not.toContain(marker);
  });

  it("never renders a sample lifecycle when run identity has no persisted loader", () => {
    window.history.replaceState({}, "", "/runs/run_missing");
    const ports = services();
    ports.hydrateRun = undefined;

    render(
      <App
        runId="run_missing"
        projectToken={`project_${"a".repeat(64)}`}
        services={ports}
      />,
    );

    expect(screen.queryAllByText("ETH/USD snapshot")).toHaveLength(0);
    expect(screen.queryByLabelText(/attestation lifecycle/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /loading run|run unavailable|run not found/i }),
    ).toBeVisible();
  });
});

describe("browser storage denial", () => {
  it("renders /runs and keeps Start usable when the localStorage getter throws", () => {
    window.history.replaceState({}, "", "/runs");
    const denied = vi
      .spyOn(globalThis, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });

    try {
      expect(() => render(<App services={services()} />)).not.toThrow();
      const start = screen.getByRole("link", { name: /start a web2json run/i });
      expect(start).toHaveAttribute("href", "/app/runs/new");
      expect(() => fireEvent.click(start)).not.toThrow();
    } finally {
      denied.mockRestore();
    }
  });

  it("renders /runs and keeps Start usable when the sessionStorage getter throws", () => {
    window.history.replaceState({}, "", "/runs");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const denied = vi
      .spyOn(globalThis, "sessionStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });

    try {
      expect(() =>
        render(<App services={services()} analytics={{ emit: vi.fn() }} />),
      ).not.toThrow();
      const start = screen.getByRole("link", { name: /start a web2json run/i });
      expect(start).toHaveAttribute("href", "/app/runs/new");
      expect(() => fireEvent.click(start)).not.toThrow();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      denied.mockRestore();
      consoleError.mockRestore();
    }
  });
});

describe("run filter location semantics", () => {
  it.each([
    ["/runs", "All"],
    ["/runs?status=active", "Active"],
    ["/runs?status=completed", "Completed"],
    ["/runs?status=failed", "Failed"],
  ])("marks only %s as current after direct load, reload, or back", (path, selected) => {
    window.history.replaceState({}, "", path);
    render(<App services={services()} />);

    const filters = screen.getByRole("navigation", { name: /filter runs/i });
    const current = within(filters)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(selected);
  });
});
