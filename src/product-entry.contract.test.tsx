import { render, screen } from "@testing-library/react";
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
    ).toHaveAttribute("href", "/runs/new");
    expect(screen.queryByText("ETH/USD snapshot")).not.toBeInTheDocument();
  });

  it("does not ship a hardcoded cockpit run or demo-run fallback", () => {
    expect(appSource).not.toMatch(/\bCOCKPIT_RUN_ID\b/);
    expect(appSource).not.toContain("run_01JYXW5ZC6K9JSGG0TQ7V8N3PH");
  });
});
