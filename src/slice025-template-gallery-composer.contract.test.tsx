import axe from "axe-core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validComposerDraft } from "../packages/contracts/test/fixtures";
import {
  ethUsdManifest,
  ethUsdTemplateDetail,
  openMeteoManifest,
  openMeteoTemplateDetail,
  templateCatalog,
} from "../test/slice025-template-fixtures";
import { App } from "./App";
import type { WalletAccessServices } from "./services/wallet-access-client";
import type { RunSurfaceServices } from "./services/run-surface";
import stylesSource from "./styles.css?raw";

const DRAFT_KEY = "proofline:composer-draft:v1";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const browserWindow = window as typeof window & {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};

function wallet(): WalletAccessServices {
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

function services(overrides: Record<string, unknown> = {}): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [] }),
    createRun: vi.fn(),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as RunSurfaceServices;
}

function fetchRouter(overrides: Record<string, Response> = {}) {
  return vi.fn(async (target: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(target), window.location.origin);
    const custom = overrides[`${url.pathname}${url.search}`];
    if (custom) return custom.clone();
    if (url.pathname === "/api/v1/templates") return Response.json(templateCatalog);
    if (url.pathname === "/api/v1/templates/open-meteo-current-weather") {
      return Response.json(openMeteoTemplateDetail);
    }
    if (url.pathname === "/api/v1/templates/eth-usd") {
      return Response.json(ethUsdTemplateDetail);
    }
    throw new Error(`Unexpected browser request ${url.pathname}`);
  });
}

function renderPath(path: string, input: {
  fetch?: ReturnType<typeof fetchRouter>;
  projectToken?: string;
  services?: RunSurfaceServices;
} = {}) {
  window.history.replaceState({}, "", path);
  const fetch = input.fetch ?? fetchRouter();
  vi.stubGlobal("fetch", fetch);
  const walletServices = wallet();
  const rendered = render(
    <App
      projectToken={input.projectToken}
      services={input.services ?? services()}
      walletAccess={{ services: walletServices, storage: sessionStorage }}
    />,
  );
  return { ...rendered, fetch, wallet: walletServices };
}

function expectOnlyTemplateApiRequests(fetch: ReturnType<typeof fetchRouter>): void {
  for (const [target, init] of fetch.mock.calls) {
    const url = new URL(String(target), window.location.origin);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname.startsWith("/api/v1/templates")).toBe(true);
    expect(url.hostname).not.toBe("api.open-meteo.com");
    expect(url.hostname).not.toBe("api.coinbase.com");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  browserWindow.happyDOM.setViewport({ width: 1024, height: 768 });
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Slice 025C template gallery, detail and Composer authority", () => {
  it("renders the anonymous gallery with Open-Meteo featured/default and an explicit blank start", async () => {
    const fixture = renderPath("/templates");
    expect(await screen.findByRole("heading", { name: "Start from a template" })).toBeVisible();
    const weather = screen.getByRole("region", { name: "Berlin current temperature" });
    expect(within(weather).getByText("Featured")).toBeVisible();
    expect(within(weather).getByText("Open-Meteo")).toBeVisible();
    expect(within(weather).getByRole("link", { name: "Use template" })).toHaveAttribute(
      "href",
      "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
    );
    expect(screen.getByRole("link", { name: "Start blank" })).toHaveAttribute(
      "href",
      "/runs/new?step=source",
    );
    expect(fixture.fetch).toHaveBeenCalledOnce();
    expectOnlyTemplateApiRequests(fixture.fetch);
    expect(fixture.wallet.listNetworks).not.toHaveBeenCalled();
    expect(fixture.wallet.getAccount).not.toHaveBeenCalled();
  });

  it("shows one resolved detail with bounded inert provenance only", async () => {
    const fixture = renderPath("/templates/open-meteo-current-weather");
    expect(await screen.findByRole("heading", { name: "Berlin current temperature" })).toBeVisible();
    const provenance = screen.getByRole("region", { name: "Template provenance" });
    expect(provenance).toHaveTextContent("Open-Meteo");
    expect(provenance).toHaveTextContent("Revision 1");
    expect(provenance).toHaveTextContent(openMeteoTemplateDetail.template.manifestSha256);
    expect(screen.getByRole("link", { name: "Use template" })).toHaveAttribute(
      "href",
      "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
    );
    expect(document.body).not.toHaveTextContent(openMeteoManifest.request.abiSignature);
    expect(document.body).not.toHaveTextContent(openMeteoManifest.request.jq);
    expect(screen.queryByRole("link", { name: /api\.open-meteo\.com/i })).not.toBeInTheDocument();
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("resolves Open-Meteo before persisting a new editable draft without blank fallback", async () => {
    const fixture = renderPath(
      "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
    );
    expect(await screen.findByLabelText(/source url/i)).toHaveValue(openMeteoManifest.request.url);
    expect(screen.getByDisplayValue("52.52")).toBeVisible();
    expect(screen.getByDisplayValue("13.41")).toBeVisible();
    const persisted = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    expect(persisted.fields.sourceUrl).toBe(openMeteoManifest.request.url);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("keeps the legacy eth-usd deep link and canonicalizes its missing revision", async () => {
    const fixture = renderPath("/runs/new?template=eth-usd&step=source");
    expect(await screen.findByLabelText(/source url/i)).toHaveValue(ethUsdManifest.request.url);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("template")).toBe("eth-usd");
    expect(params.get("revision")).toBe("1");
    expect(params.get("step")).toBe("source");
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it.each([
    ["unknown template", "/runs/new?template=missing&revision=1&step=source"],
    ["mismatched revision", "/runs/new?template=open-meteo-current-weather&revision=2&step=source"],
    ["missing non-legacy revision", "/runs/new?template=open-meteo-current-weather&step=source"],
  ])("fails closed as Template unavailable for %s", async (_name, path) => {
    const before = JSON.stringify(validComposerDraft);
    localStorage.setItem(DRAFT_KEY, before);
    const fixture = renderPath(path);
    expect(await screen.findByText("Template unavailable")).toBeVisible();
    expect(screen.getByLabelText(/source url/i)).toHaveValue(validComposerDraft.fields.sourceUrl);
    expect(screen.getByRole("link", { name: "Browse templates" })).toHaveAttribute("href", "/templates");
    expect(localStorage.getItem(DRAFT_KEY)).toBe(before);
    expect(document.body).not.toHaveTextContent(/sample|fallback/i);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("shows a stable unavailable route with no draft or fallback manifest", async () => {
    const fixture = renderPath("/runs/new?template=missing&revision=1&step=source");
    expect(await screen.findByRole("heading", { name: "Template unavailable" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Browse templates" })).toHaveAttribute("href", "/templates");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.queryByLabelText(/source url/i)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/coinbase|open-meteo|sample|fallback/i);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("keeps a restored draft byte-identical when replacement is cancelled", async () => {
    const before = JSON.stringify(validComposerDraft);
    localStorage.setItem(DRAFT_KEY, before);
    const user = userEvent.setup();
    const fixture = renderPath(
      "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
    );
    expect(await screen.findByText("A saved draft was restored. Review the requested template before replacing it.")).toBeVisible();
    expect(screen.getByLabelText(/source url/i)).toHaveValue(validComposerDraft.fields.sourceUrl);
    await user.click(screen.getByRole("button", { name: "Review replacement" }));
    const dialog = screen.getByRole("dialog", { name: "Replace saved draft?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep saved draft" }));
    expect(localStorage.getItem(DRAFT_KEY)).toBe(before);
    expect(screen.getByLabelText(/source url/i)).toHaveValue(validComposerDraft.fields.sourceUrl);
    const params = new URLSearchParams(window.location.search);
    expect(params.has("template")).toBe(false);
    expect(params.has("revision")).toBe(false);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("replaces only after confirmation and creates a fresh idempotency key", async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(validComposerDraft));
    const user = userEvent.setup();
    const fixture = renderPath(
      "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
    );
    await screen.findByText("A saved draft was restored. Review the requested template before replacing it.");
    await user.click(screen.getByRole("button", { name: "Review replacement" }));
    await user.click(within(screen.getByRole("dialog", { name: "Replace saved draft?" }))
      .getByRole("button", { name: "Replace with template" }));
    expect(await screen.findByLabelText(/source url/i)).toHaveValue(openMeteoManifest.request.url);
    const persisted = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    expect(persisted.createIdempotencyKey).not.toBe(validComposerDraft.createIdempotencyKey);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("submits the exact resolved manifest and excludes template metadata", async () => {
    const createRun = vi.fn().mockResolvedValue({
      status: "accepted",
      runId: "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
      location: "/v1/runs/run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
    });
    const user = userEvent.setup();
    const fixture = renderPath(
      "/runs/new?template=open-meteo-current-weather&revision=1&step=submit",
      { projectToken: PROJECT_TOKEN, services: services({ createRun }) },
    );
    await user.click(await screen.findByRole("button", { name: "Create preflight run" }));
    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    const input = createRun.mock.calls[0][0];
    expect(input.manifest).toEqual(openMeteoManifest);
    expect(input).not.toHaveProperty("template");
    expect(input).not.toHaveProperty("provenance");
    expect(JSON.stringify(input)).not.toMatch(/manifestSha256|catalogRevision|templateRevision/);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("prevents a stale detail response from overwriting a newer template choice", async () => {
    const delayedOpenMeteo = deferred<Response>();
    const fetch = vi.fn(async (target: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(target), window.location.origin).pathname;
      if (path === "/api/v1/templates") return Response.json(templateCatalog);
      if (path === "/api/v1/templates/open-meteo-current-weather") {
        return delayedOpenMeteo.promise;
      }
      if (path === "/api/v1/templates/eth-usd") return Response.json(ethUsdTemplateDetail);
      throw new Error(`Unexpected request ${path}`);
    });
    const fixture = renderPath(
      "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
      { fetch },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    window.history.pushState({}, "", "/runs/new?template=eth-usd&revision=1&step=source");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(await screen.findByLabelText(/source url/i)).toHaveValue(ethUsdManifest.request.url);
    delayedOpenMeteo.resolve(Response.json(openMeteoTemplateDetail));
    await act(async () => await Promise.resolve());
    expect(screen.getByLabelText(/source url/i)).toHaveValue(ethUsdManifest.request.url);
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null").fields.sourceUrl)
      .toBe(ethUsdManifest.request.url);
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("keeps direct, back and forward template routes stable without external requests", async () => {
    window.history.replaceState({}, "", "/templates");
    window.history.pushState({}, "", "/templates/open-meteo-current-weather");
    const fixture = renderPath("/templates/open-meteo-current-weather");
    expect(await screen.findByRole("heading", { name: "Berlin current temperature" })).toBeVisible();

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/templates"));
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(await screen.findByRole("heading", { name: "Start from a template" })).toBeVisible();

    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/templates/open-meteo-current-weather"));
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(await screen.findByRole("heading", { name: "Berlin current temperature" })).toBeVisible();
    expectOnlyTemplateApiRequests(fixture.fetch);
  });

  it("is keyboard reachable, mobile-safe and has no serious/critical axe findings", async () => {
    browserWindow.happyDOM.setViewport({ width: 390, height: 844 });
    const user = userEvent.setup();
    const rendered = renderPath("/templates");
    const heading = await screen.findByRole("heading", { name: "Start from a template" });
    expect(heading).toBeVisible();
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
    expect(stylesSource).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.template-(?:gallery|grid)[\s\S]*(?:grid-template-columns:\s*1fr|display:\s*block)/);
    const report = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(report.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    expectOnlyTemplateApiRequests(rendered.fetch);
  });
});
