import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";

const COINBASE_SOURCE = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const importedManifest = {
  version: "1",
  attestationType: "Web2Json",
  network: "coston2",
  request: {
    method: "GET",
    url: "https://rates.example.com/public/eth?source=primary",
    query: { currency: "USD" },
    jq: ".data | {amount: .amount, currency: .currency}",
    abiSignature:
      '{"components":[{"internalType":"string","name":"amount","type":"string"},{"internalType":"string","name":"currency","type":"string"}],"name":"data","type":"tuple"}',
  },
  consumer: {
    expectedScheme: "https",
    expectedHost: "rates.example.com",
    expectedPathPrefix: "/public/eth",
    expectedQuery: { source: "primary", currency: "USD" },
  },
  submission: { mode: "replay", feeCapWei: "20000000000000000" },
};

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

function file(contents: string, name = "manifest.json") {
  return new File([contents], name, { type: "application/json" });
}

function renderTemplate() {
  window.history.replaceState({}, "", "/runs/new?template=eth-usd&step=source");
  render(<App services={services()} />);
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 015A strict manifest import", () => {
  it("atomically replaces Source and Trust from one strict manifest", async () => {
    const user = userEvent.setup();
    renderTemplate();

    await user.upload(
      screen.getByLabelText(/import manifest/i),
      file(JSON.stringify(importedManifest)),
    );
    expect(screen.getByLabelText(/source url/i)).toHaveValue(importedManifest.request.url);
    const sourceQuery = screen.getByRole("group", { name: /source query/i });
    expect(within(sourceQuery).getByDisplayValue("currency")).toBeVisible();
    expect(within(sourceQuery).getByDisplayValue("USD")).toBeVisible();

    await user.click(
      within(screen.getByRole("navigation", { name: /composer steps/i }))
        .getByRole("link", { name: /^trust/i }),
    );
    expect(screen.getByLabelText(/expected scheme/i)).toHaveValue("https");
    expect(screen.getByLabelText(/expected host/i)).toHaveValue("rates.example.com");
    expect(screen.getByLabelText(/expected path prefix/i)).toHaveValue("/public/eth");
    const expectedQuery = screen.getByRole("group", { name: /expected query/i });
    expect(within(expectedQuery).getByDisplayValue("source")).toBeVisible();
    expect(within(expectedQuery).getByDisplayValue("primary")).toBeVisible();
    expect(within(expectedQuery).getByDisplayValue("currency")).toBeVisible();
  });

  it.each([
    ["corrupt JSON", `{ "token": "project_${"a".repeat(64)}"`],
    ["extra fields", JSON.stringify({ ...importedManifest, headers: { Authorization: "secret" } })],
    [
      "an unsafe HTTP source",
      JSON.stringify({
        ...importedManifest,
        request: { ...importedManifest.request, url: "http://rates.example.com/public/eth" },
      }),
    ],
    [
      "URL credentials",
      JSON.stringify({
        ...importedManifest,
        request: {
          ...importedManifest.request,
          url: "https://user:secret@rates.example.com/public/eth",
        },
      }),
    ],
  ])("rejects %s without partially mutating the template", async (_name, contents) => {
    const user = userEvent.setup();
    renderTemplate();

    await user.upload(screen.getByLabelText(/import manifest/i), file(contents));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/manifest.*invalid|could not import/i);
    expect(alert).not.toHaveTextContent(/project_[a-f0-9]{64}/i);
    expect(alert).not.toHaveTextContent("user:secret");
    expect(screen.getByLabelText(/source url/i)).toHaveValue(COINBASE_SOURCE);
  });
});
