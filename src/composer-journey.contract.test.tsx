import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductEventV1 } from "../packages/contracts/src";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";

function services(): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [] }),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
  } as RunSurfaceServices;
}

function collector() {
  const events: ProductEventV1[] = [];
  return {
    events,
    port: {
      emit: vi.fn((event: ProductEventV1) => events.push(event)),
    },
  };
}

function composerStarts(events: readonly ProductEventV1[]) {
  return events.filter(({ name }) => name === "COMPOSER_STARTED");
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Composer journey analytics contract", () => {
  it("records one runs-attributed start across navigation and reload, then permits a new Start journey", async () => {
    const analytics = collector();
    window.history.replaceState({}, "", "/runs");
    const index = render(<App services={services()} analytics={analytics.port} />);

    fireEvent.click(screen.getByRole("link", { name: /start a web2json run/i }));
    expect(composerStarts(analytics.events)).toEqual([
      expect.objectContaining({
        name: "COMPOSER_STARTED",
        metadata: { entryPoint: "runs" },
      }),
    ]);

    index.unmount();
    window.history.replaceState({}, "", "/runs/new?step=source");
    const composer = render(<App services={services()} analytics={analytics.port} />);
    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://api.example.org/public" },
    });
    expect(composerStarts(analytics.events)).toHaveLength(1);

    composer.unmount();
    const reloadedComposer = render(<App services={services()} analytics={analytics.port} />);
    fireEvent.click(screen.getByRole("button", { name: /add query parameter/i }));
    expect(composerStarts(analytics.events)).toHaveLength(1);

    reloadedComposer.unmount();
    window.history.replaceState({}, "", "/runs");
    const nextIndex = render(<App services={services()} analytics={analytics.port} />);
    fireEvent.click(screen.getByRole("link", { name: /start a web2json run/i }));
    expect(composerStarts(analytics.events)).toEqual([
      expect.objectContaining({ metadata: { entryPoint: "runs" } }),
      expect.objectContaining({ metadata: { entryPoint: "runs" } }),
    ]);

    nextIndex.unmount();
    window.history.replaceState({}, "", "/runs/new?step=source");
    render(<App services={services()} analytics={analytics.port} />);
    fireEvent.click(screen.getByRole("button", { name: /add query parameter/i }));
    expect(composerStarts(analytics.events)).toHaveLength(2);
  });

  it("records a direct Composer start once across a reload", async () => {
    const analytics = collector();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/runs/new?step=source");
    const composer = render(<App services={services()} analytics={analytics.port} />);

    await user.type(screen.getByLabelText(/source url/i), "https://api.example.org/public");
    expect(composerStarts(analytics.events)).toEqual([
      expect.objectContaining({
        name: "COMPOSER_STARTED",
        metadata: { entryPoint: "direct" },
      }),
    ]);

    composer.unmount();
    render(<App services={services()} analytics={analytics.port} />);
    fireEvent.click(screen.getByRole("button", { name: /add query parameter/i }));
    expect(composerStarts(analytics.events)).toHaveLength(1);
  });

  it("keeps the Composer usable when session storage is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });
    window.history.replaceState({}, "", "/runs/new?step=source");
    render(<App services={services()} analytics={collector().port} />);

    const source = screen.getByLabelText(/source url/i);
    fireEvent.change(source, {
      target: { value: "https://api.example.org/public" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue to transform/i }));

    expect(source).toHaveValue("https://api.example.org/public");
    expect(window.location.search).toContain("step=transform");
    expect(screen.getByRole("heading", { name: /transform is not available yet/i })).toBeVisible();
  });
});
