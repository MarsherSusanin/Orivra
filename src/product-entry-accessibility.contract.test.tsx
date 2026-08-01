import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { Sidebar } from "./components/Sidebar";
import type { RunSurfaceServices } from "./services/run-surface";

function services(): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [] }),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
    hydrateRun: vi.fn(),
  } as RunSurfaceServices;
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("project token dialog escape routes", () => {
  it("closes the optional /runs connection dialog with Escape", async () => {
    window.history.replaceState({}, "", "/runs");
    const user = userEvent.setup();
    render(<App services={services()} />);

    await user.click(screen.getByRole("button", { name: /connect project/i }));
    expect(screen.getByRole("dialog", { name: /connect project/i })).toBeVisible();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: /connect project/i })).not.toBeInTheDocument();
  });

  it("provides a visible Cancel or Close control for the optional /runs dialog", async () => {
    window.history.replaceState({}, "", "/runs");
    const user = userEvent.setup();
    render(<App services={services()} />);

    await user.click(screen.getByRole("button", { name: /connect project/i }));
    const close = screen.getByRole("button", { name: /cancel|close/i });
    expect(close).toBeVisible();
    await user.click(close);

    expect(screen.queryByRole("dialog", { name: /connect project/i })).not.toBeInTheDocument();
  });

  it("offers Back to runs when a deep-linked run is locked", () => {
    window.history.replaceState({}, "", "/runs/run_locked");
    render(<App services={services()} />);

    expect(screen.getByRole("heading", { name: /connect project to open run/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /back to runs/i })).toHaveAttribute(
      "href",
      "/runs",
    );
  });
});

describe("disabled primary navigation", () => {
  it("keeps every future destination focusable and explains why it is unavailable", () => {
    render(<Sidebar />);

    for (const label of ["Requests", "Consumers", "CI", "Settings"]) {
      const item = screen.getByRole("button", { name: label });
      const descriptionId = item.getAttribute("aria-describedby");
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).not.toBeDisabled();
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId!)).toHaveTextContent(
        `${label} is not available in this build`,
      );
      expect(item).toHaveAccessibleDescription(`${label} is not available in this build`);
    }
  });

  it("is keyboard and touch discoverable without navigating", async () => {
    window.history.replaceState({}, "", "/runs");
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.tab();
    await user.tab();
    await user.tab();
    const requests = screen.getByRole("button", { name: "Requests" });
    expect(requests).toHaveFocus();

    await user.keyboard("{Enter}");
    fireEvent.pointerDown(requests, { pointerType: "touch" });
    fireEvent.click(requests);
    expect(window.location.pathname).toBe("/runs");
  });
});
