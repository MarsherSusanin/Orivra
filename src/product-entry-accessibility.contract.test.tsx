import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("wallet sign-in dialog escape routes", () => {
  it("closes the optional /runs wallet dialog with Escape and restores focus", async () => {
    window.history.replaceState({}, "", "/runs");
    const user = userEvent.setup();
    render(<App services={services()} />);

    const opener = screen.getByRole("button", { name: /^sign in with wallet$/i });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: /sign in with wallet/i })).toBeVisible();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: /sign in with wallet/i })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("provides a visible Close control for the optional /runs wallet dialog", async () => {
    window.history.replaceState({}, "", "/runs");
    const user = userEvent.setup();
    render(<App services={services()} />);

    await user.click(screen.getByRole("button", { name: /^sign in with wallet$/i }));
    const dialog = screen.getByRole("dialog", { name: /sign in with wallet/i });
    const close = within(dialog).getByRole("button", { name: /close wallet sign in/i });
    expect(close).toBeVisible();
    await user.click(close);

    expect(screen.queryByRole("dialog", { name: /sign in with wallet/i })).not.toBeInTheDocument();
  });

  it("keeps a locked deep URL and offers wallet sign-in plus Back to runs", () => {
    window.history.replaceState({}, "", "/runs/run_locked");
    render(<App services={services()} />);

    expect(screen.getByRole("heading", { name: /sign in to open run/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^sign in with wallet$/i })).toBeEnabled();
    expect(screen.getByRole("link", { name: /back to runs/i })).toHaveAttribute(
      "href",
      "/app/runs",
    );
    expect(window.location.pathname).toBe("/app/runs/run_locked");
    expect(document.body).not.toHaveTextContent(/project token|connect project/i);
  });
});

describe("disabled primary navigation", () => {
  it("keeps every future destination focusable and explains why it is unavailable", () => {
    render(<Sidebar />);

    for (const label of ["Requests", "Consumers", "CI"]) {
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
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
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
