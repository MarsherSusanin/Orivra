import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";

const COINBASE_SOURCE = "https://api.coinbase.com/v2/prices/ETH-USD/spot";

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

function renderComposer(path = "/runs/new") {
  window.history.replaceState({}, "", path);
  return render(<App services={services()} />);
}

async function openTrust(user: ReturnType<typeof userEvent.setup>) {
  const steps = screen.getByRole("navigation", { name: /composer steps/i });
  await user.click(within(steps).getByRole("link", { name: /^trust/i }));
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 015A ETH/USD Source and Trust template", () => {
  it("starts with the exact public Coinbase source and derived trust defaults", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("A browser source fetch must never occur"),
    );
    renderComposer("/runs/new?template=eth-usd&step=source");

    expect(screen.getByLabelText(/source url/i)).toHaveValue(COINBASE_SOURCE);
    expect(screen.getByText(/remote access happens during server-side preflight/i)).toBeVisible();

    await openTrust(user);
    expect(screen.getByLabelText(/expected scheme/i)).toHaveValue("https");
    expect(screen.getByLabelText(/expected scheme/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/expected host/i)).toHaveValue("api.coinbase.com");
    expect(screen.getByLabelText(/expected path prefix/i)).toHaveValue(
      "/v2/prices/ETH-USD/spot",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("adds, edits and removes source query rows using named controls", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: /add query parameter/i }));
    const sourceQuery = screen.getByRole("group", { name: /source query/i });
    const key = within(sourceQuery).getAllByLabelText(/query key/i).at(-1)!;
    const value = within(sourceQuery).getAllByLabelText(/query value/i).at(-1)!;
    await user.type(key, "currency");
    await user.type(value, "USD");
    expect(key).toHaveValue("currency");
    expect(value).toHaveValue("USD");

    await user.click(within(sourceQuery).getByRole("button", { name: /remove query parameter/i }));
    expect(within(sourceQuery).queryByDisplayValue("currency")).not.toBeInTheDocument();
  });

  it("preserves Source fields while navigating to Trust and back through URL state", async () => {
    const user = userEvent.setup();
    renderComposer("/runs/new?step=source&status=active");

    const source = screen.getByLabelText(/source url/i);
    await user.type(source, "https://api.example.com/public/prices");
    await user.click(screen.getByRole("button", { name: /add query parameter/i }));
    const sourceQuery = screen.getByRole("group", { name: /source query/i });
    await user.type(within(sourceQuery).getAllByLabelText(/query key/i).at(-1)!, "asset");
    await user.type(within(sourceQuery).getAllByLabelText(/query value/i).at(-1)!, "ETH");

    await openTrust(user);
    expect(new URLSearchParams(window.location.search).get("step")).toBe("trust");
    expect(new URLSearchParams(window.location.search).get("status")).toBe("active");
    await user.click(
      within(screen.getByRole("navigation", { name: /composer steps/i }))
        .getByRole("link", { name: /^source/i }),
    );

    expect(screen.getByLabelText(/source url/i)).toHaveValue(
      "https://api.example.com/public/prices",
    );
    expect(screen.getByDisplayValue("asset")).toBeVisible();
    expect(screen.getByDisplayValue("ETH")).toBeVisible();
  });

  it("never sends the arbitrary source URL through browser fetch", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network disabled"),
    );
    renderComposer();

    await user.type(screen.getByLabelText(/source url/i), "https://source.example/public");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await openTrust(user);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Slice 015A inline validation", () => {
  it.each([
    ["http://api.example.com/public", /https/i],
    ["https://api.example.com:8443/public", /port 443/i],
    ["https://user:secret@api.example.com/public", /credentials/i],
    ["https://api.example.com/public#private", /fragment/i],
  ])("blocks unsafe source %s next to the URL field", async (unsafeUrl, errorCopy) => {
    const user = userEvent.setup();
    renderComposer();

    const source = screen.getByLabelText(/source url/i);
    await user.type(source, unsafeUrl);
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(source).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(errorCopy)).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("step") ?? "source").toBe("source");
  });

  it("normalizes the trust host and validates path prefix and expected query inline", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(
      screen.getByLabelText(/source url/i),
      "https://API.Example.COM/v2/prices?asset=ETH",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await openTrust(user);

    expect(screen.getByLabelText(/expected host/i)).toHaveValue("api.example.com");
    const path = screen.getByLabelText(/expected path prefix/i);
    await user.clear(path);
    await user.type(path, "v2/prices");
    fireEvent.blur(path);
    expect(path).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/path prefix.*\//i)).toBeVisible();

    const expectedQuery = screen.getByRole("group", { name: /expected query/i });
    expect(within(expectedQuery).getByDisplayValue("asset")).toBeVisible();
    expect(within(expectedQuery).getByDisplayValue("ETH")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /add expected query/i }));
    const key = within(expectedQuery).getAllByLabelText(/expected query key/i).at(-1)!;
    const value = within(expectedQuery).getAllByLabelText(/expected query value/i).at(-1)!;
    await user.type(key, "currency");
    await user.type(value, "USD");
    expect(key).toHaveValue("currency");
    expect(value).toHaveValue("USD");
    await user.click(
      within(expectedQuery).getAllByRole("button", { name: /remove expected query/i }).at(-1)!,
    );
    expect(within(expectedQuery).queryByDisplayValue("currency")).not.toBeInTheDocument();
    expect(within(expectedQuery).getByDisplayValue("asset")).toBeVisible();
    expect(within(expectedQuery).getByDisplayValue("ETH")).toBeVisible();
  });

  it("exposes every essential Source control by label and keyboard", async () => {
    const user = userEvent.setup();
    renderComposer();

    const source = screen.getByLabelText(/source url/i);
    const importControl = screen.getByLabelText(/import manifest/i);
    const addQuery = screen.getByRole("button", { name: /add query parameter/i });
    expect(source).toBeEnabled();
    expect(importControl).toHaveAttribute("type", "file");
    expect(addQuery).toBeEnabled();

    await user.tab();
    while (document.activeElement !== source) await user.tab();
    expect(source).toHaveFocus();
    await user.type(source, "https://api.example.com/public");
    expect(source).toHaveValue("https://api.example.com/public");
  });
});
