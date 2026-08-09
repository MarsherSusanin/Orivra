import axe from "axe-core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import stylesSource from "./styles.css?raw";
import { makeCanonicalUrlAttackDemoSummaryFixture } from "./test/slice024b-demo-fixture";
import type { WalletAccessServices } from "./services/wallet-access-client";

function walletAccess(): WalletAccessServices {
  return {
    listNetworks: vi.fn(),
    createWalletChallenge: vi.fn(),
    createWalletSession: vi.fn(),
    getAccount: vi.fn(),
    createAccountToken: vi.fn(),
    revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(),
  };
}

function renderDemo(response: Response | (() => Promise<Response>)) {
  window.history.replaceState({}, "", "/demo/canonical-url");
  const fetch = vi.fn(
    typeof response === "function" ? response : async () => response,
  );
  vi.stubGlobal("fetch", fetch);
  const wallet = walletAccess();
  const rendered = render(
    <App
      walletAccess={{
        services: wallet,
        storage: {
          getItem: vi.fn(() => `project_${"a".repeat(64)}`),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
      }}
    />,
  );
  return { ...rendered, fetch, wallet };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Slice 024B /demo/canonical-url product route", () => {
  it("loads one anonymous summary and separates persisted Coston2 from local EVM evidence", async () => {
    const summary = makeCanonicalUrlAttackDemoSummaryFixture();
    const fixture = renderDemo(Response.json(summary));
    expect(await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Persisted Coston2 evidence" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Deterministic local EVM replay" })).toBeVisible();
    expect(screen.getByText(summary.runs.attack.transactionHash)).toBeVisible();
    expect(screen.getByText(String(summary.runs.control.votingRound))).toBeVisible();
    expect(screen.getByText(summary.recording.checksum)).toBeVisible();
    expect(fixture.fetch).toHaveBeenCalledOnce();
    const requestUrl = new URL(String((fixture.fetch.mock.calls as any[][])[0][0]));
    expect(`${requestUrl.pathname}${requestUrl.search}`).toBe("/api/v1/demo/canonical-url");
  });

  it("never restores a wallet, sends bearer auth or preloads the full recording", async () => {
    const fixture = renderDemo(Response.json(makeCanonicalUrlAttackDemoSummaryFixture()));
    await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" });
    expect(fixture.wallet.getAccount).not.toHaveBeenCalled();
    expect(fixture.wallet.listNetworks).not.toHaveBeenCalled();
    expect(fixture.wallet.createWalletChallenge).not.toHaveBeenCalled();
    expect(fixture.fetch).toHaveBeenCalledOnce();
    const init = (fixture.fetch.mock.calls as any[][])[0][1] as RequestInit | undefined;
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(String((fixture.fetch.mock.calls as any[][])[0][0])).not.toContain("/recording");
    expect(screen.queryByText(/sign in|connect wallet/i)).not.toBeInTheDocument();
  });

  it("offers only a user-initiated same-origin recording download", async () => {
    const summary = makeCanonicalUrlAttackDemoSummaryFixture();
    const fixture = renderDemo(Response.json(summary));
    const download = await screen.findByRole("link", { name: /download exact recording/i });
    expect(download).toHaveAttribute("href", "/api/v1/demo/canonical-url/recording");
    expect(download).toHaveAttribute("download");
    expect(fixture.fetch).toHaveBeenCalledOnce();
    const externalLinks = screen.queryAllByRole("link").filter((link) =>
      [summary.runs.attack.requestedUrl, summary.runs.control.requestedUrl]
        .includes(link.getAttribute("href") as any),
    );
    expect(externalLinks).toEqual([]);
  });

  it.each([
    ["503", new Response(JSON.stringify({ error: { message: "database corruption at /private/path" } }), { status: 503 })],
    ["invalid summary", Response.json({ version: "1", status: "available", fixture: true })],
  ])("shows one honest stable unavailable state for %s", async (_label, response) => {
    renderDemo(response);
    expect(await screen.findByRole("heading", { name: "Canonical attack recording unavailable" })).toBeVisible();
    expect(document.body).not.toHaveTextContent(/database corruption|private\/path|fixture/i);
    expect(screen.queryByText(/Proof available/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Persisted Coston2 evidence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download exact recording/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/0x[a-f0-9]{64}|sha256:[a-f0-9]{64}/i);
  });

  it("is keyboard reachable and has no serious or critical axe violations", async () => {
    const rendered = renderDemo(Response.json(makeCanonicalUrlAttackDemoSummaryFixture()));
    const download = await screen.findByRole("link", { name: /download exact recording/i });
    const user = userEvent.setup();
    await user.tab();
    while (document.activeElement !== download && document.activeElement !== document.body) {
      await user.tab();
    }
    expect(download).toHaveFocus();
    const result = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  });

  it("restores the deep route across back and forward without duplicate network work", async () => {
    window.history.replaceState({}, "", "/runs");
    window.history.pushState({}, "", "/demo/canonical-url");
    const fixture = renderDemo(Response.json(makeCanonicalUrlAttackDemoSummaryFixture()));
    await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" });

    window.history.back();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/runs");
      expect(screen.getByRole("heading", { name: /^Runs$/i })).toBeVisible();
    });

    window.history.forward();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/demo/canonical-url");
      expect(screen.getByRole("heading", { name: "Valid proof ≠ trusted URL" })).toBeVisible();
    });
    expect(fixture.fetch.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("keeps evidence bounded and stacked at the accepted mobile breakpoint", () => {
    expect(stylesSource).toMatch(/\.canonical-demo/);
    expect(stylesSource).toMatch(/\.canonical-demo-evidence/);
    const mobile = stylesSource.match(/@media\s*\(max-width:\s*720px\)[^{]*\{([\s\S]*)$/)?.[1] ?? "";
    expect(mobile).toMatch(/\.canonical-demo-evidence[\s\S]*grid-template-columns:\s*1fr/);
    expect(mobile).toMatch(/\.canonical-demo-hash[\s\S]*(?:overflow-wrap:\s*anywhere|word-break:\s*break-all)/);
  });
});
