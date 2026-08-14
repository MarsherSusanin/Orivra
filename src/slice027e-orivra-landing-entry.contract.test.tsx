import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { WalletAccessServices } from "./services/wallet-access-client";
import type { RunSurfaceServices } from "./services/run-surface";
import { templateCatalog } from "../test/slice025-template-fixtures";
import { makeCanonicalUrlAttackDemoSummaryFixture } from "./test/slice024b-demo-fixture";
import {
  createLandingComposerDraft,
  stageLandingComposerHandoff,
} from "./services/landing-composer-handoff";

function services(): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockReturnValue(new Promise(() => undefined)),
    hydrateRun: vi.fn().mockReturnValue(new Promise(() => undefined)),
    createRun: vi.fn(), verifyConsumer: vi.fn(), generateConsumer: vi.fn(),
    exportBundle: vi.fn(), replayBundle: vi.fn(), resume: vi.fn().mockReturnValue(null),
  } as unknown as RunSurfaceServices;
}

function walletServices(): WalletAccessServices {
  return {
    listNetworks: vi.fn(), createWalletChallenge: vi.fn(), createWalletSession: vi.fn(),
    getAccount: vi.fn(), createAccountToken: vi.fn(), revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(),
  };
}

function renderLanding() {
  window.history.replaceState({}, "", "/");
  const fetch = vi.fn(async (target: string | URL | Request) => {
    const url = new URL(target instanceof Request ? target.url : String(target), window.location.origin);
    if (url.pathname === "/api/v1/templates") return Response.json(templateCatalog);
    if (url.pathname === "/api/v1/demo/canonical-url") return Response.json(makeCanonicalUrlAttackDemoSummaryFixture());
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  const wallet = walletServices();
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
  const loadProviderAdapter = vi.fn();
  render(<App
    services={services()}
    walletAccess={{ services: wallet, storage, dialog: { loadProviderAdapter } }}
  />);
  return { fetch, wallet, storage, loadProviderAdapter };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Slice 027E Orivra landing entry", () => {
  it("previews the trust boundary locally without wallet or source effects", async () => {
    const fixture = renderLanding();
    expect(await screen.findByRole("heading", { name: "Verify what your Web2Json consumer actually trusts." })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Public HTTPS endpoint"), {
      target: { value: "https://API.Example.org/prices/eth?currency=USD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview trust boundary" }));

    const preview = screen.getByRole("region", { name: "Trust boundary preview" });
    expect(preview).toHaveTextContent("api.example.org");
    expect(preview).toHaveTextContent("/prices/eth");
    expect(preview).toHaveTextContent("currency=USD");
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(fixture.storage.getItem).toHaveBeenCalledOnce();
    expect(fixture.storage.getItem).toHaveBeenCalledWith("proofline:project-token");
    expect(fixture.loadProviderAdapter).not.toHaveBeenCalled();
    Object.values(fixture.wallet).forEach((port) => expect(port).not.toHaveBeenCalled());
  });

  it("rejects credential query entries before handoff", async () => {
    renderLanding();
    await screen.findByRole("heading", { name: "Verify what your Web2Json consumer actually trusts." });
    fireEvent.change(screen.getByLabelText("Public HTTPS endpoint"), {
      target: { value: "https://api.example.org/data?api_key=secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview trust boundary" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/credential/i);
    expect(screen.queryByRole("button", { name: "Continue with wallet" })).not.toBeInTheDocument();
  });

  it("stages the draft, enters the protected canonical route and keeps provider loading explicit", async () => {
    const fixture = renderLanding();
    await screen.findByRole("heading", { name: "Verify what your Web2Json consumer actually trusts." });
    fireEvent.change(screen.getByLabelText("Public HTTPS endpoint"), {
      target: { value: "https://api.example.org/data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview trust boundary" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with wallet" }));

    await waitFor(() => expect(window.location.pathname).toBe("/app/runs/new"));
    expect(window.location.search).toBe("?step=source");
    expect(await screen.findByRole("dialog", { name: "Sign in with wallet" })).toBeVisible();
    expect(fixture.loadProviderAdapter).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("proofline:landing-composer-handoff:v1")).toContain("https://api.example.org/data");
  });

  it("canonicalizes legacy product input while preserving query state", async () => {
    window.history.replaceState({}, "", "/runs/new?step=trust");
    vi.stubGlobal("fetch", vi.fn());
    render(<App projectToken="project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" services={services()} />);
    await waitFor(() => expect(window.location.pathname).toBe("/app/runs/new"));
    expect(window.location.search).toBe("?step=trust");
    expect(screen.getByRole("link", { name: "Back to runs" })).toHaveAttribute("href", "/app/runs");
  });

  it("restores a staged endpoint into an authenticated Composer and consumes the handoff", async () => {
    const result = createLandingComposerDraft({
      sourceUrl: "https://api.example.org/prices/eth?currency=USD",
      updatedAt: "2026-08-11T12:00:00.000Z",
      createIdempotencyKey: "composer_11111111-1111-4111-8111-111111111111",
    });
    if (!result.valid) throw new Error("fixture rejected");
    stageLandingComposerHandoff(sessionStorage, result.draft);
    window.history.replaceState({}, "", "/app/runs/new?step=source");
    vi.stubGlobal("fetch", vi.fn());

    render(<App
      projectToken="project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      services={services()}
    />);

    expect(await screen.findByLabelText(/source url/i)).toHaveValue(result.draft.fields.sourceUrl);
    expect(sessionStorage.getItem("proofline:landing-composer-handoff:v1")).toBeNull();
    expect(localStorage.getItem("proofline:composer-draft:v1")).toContain(result.draft.fields.sourceUrl);
  });

  it("keeps a saved draft byte-identical until explicit landing replacement", async () => {
    const saved = createLandingComposerDraft({
      sourceUrl: "https://saved.example.org/data",
      updatedAt: "2026-08-11T11:00:00.000Z",
      createIdempotencyKey: "composer_22222222-2222-4222-8222-222222222222",
    });
    const landing = createLandingComposerDraft({
      sourceUrl: "https://landing.example.org/prices",
      updatedAt: "2026-08-11T12:00:00.000Z",
      createIdempotencyKey: "composer_33333333-3333-4333-8333-333333333333",
    });
    if (!saved.valid || !landing.valid) throw new Error("fixture rejected");
    const savedBytes = JSON.stringify(saved.draft);
    localStorage.setItem("proofline:composer-draft:v1", savedBytes);
    stageLandingComposerHandoff(sessionStorage, landing.draft);
    window.history.replaceState({}, "", "/app/runs/new?step=source");
    vi.stubGlobal("fetch", vi.fn());

    render(<App
      projectToken="project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      services={services()}
    />);

    expect(await screen.findByLabelText(/source url/i)).toHaveValue(saved.draft.fields.sourceUrl);
    expect(screen.getByText(/Review the URL from the landing/i)).toBeVisible();
    expect(localStorage.getItem("proofline:composer-draft:v1")).toBe(savedBytes);
    fireEvent.click(screen.getByRole("button", { name: "Review replacement" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace with landing URL" }));
    await waitFor(() => expect(screen.getByLabelText(/source url/i)).toHaveValue(landing.draft.fields.sourceUrl));
    expect(localStorage.getItem("proofline:composer-draft:v1")).toContain(landing.draft.fields.sourceUrl);
  });
});
