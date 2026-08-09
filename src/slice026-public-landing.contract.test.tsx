import axe from "axe-core";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Web2JsonTemplateCatalogV1Schema } from "@proofline/contracts/templates";
import { App } from "./App";
import { makeCanonicalUrlAttackDemoSummaryFixture } from "./test/slice024b-demo-fixture";
import { templateCatalog } from "../test/slice025-template-fixtures";
import type { WalletAccessServices } from "./services/wallet-access-client";
import type { ProductAnalyticsPort } from "./services/product-analytics";
import type { RunSurfaceServices } from "./services/run-surface";
import templateSurfaceSource from "./components/TemplateCatalogSurface.tsx?raw";

type Handler = () => Promise<Response>;

const landingModules = import.meta.glob("./components/PublicLanding.tsx", {
  eager: true,
  import: "default",
  query: "?raw",
});
const landingSource = Object.values(landingModules)[0] as string | undefined ?? "";

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => { resolve = next; });
  return { promise, resolve };
}

function runServices(): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockReturnValue(new Promise(() => undefined)),
    hydrateRun: vi.fn().mockReturnValue(new Promise(() => undefined)),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
  } as unknown as RunSurfaceServices;
}

function walletServices(): WalletAccessServices {
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

function featuredCatalog() {
  const value = structuredClone(templateCatalog);
  return Web2JsonTemplateCatalogV1Schema.parse({
    ...value,
    templates: [
      {
        ...value.templates[0],
        title: "Response-derived starting point",
        summary: "A response-derived summary used only by this contract test.",
        provider: "Response provider",
      },
      value.templates[1],
    ],
  });
}

function renderPath(input: {
  path?: string;
  catalog?: Handler;
  demo?: Handler;
  runId?: string;
  projectToken?: string;
  analytics?: ProductAnalyticsPort;
} = {}) {
  window.history.replaceState({}, "", input.path ?? "/");
  const catalog = input.catalog ?? (async () => Response.json(featuredCatalog()));
  const demo = input.demo ?? (async () =>
    Response.json(makeCanonicalUrlAttackDemoSummaryFixture()));
  const fetch = vi.fn(async (target: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(
      target instanceof Request ? target.url : String(target),
      window.location.origin,
    );
    if (url.pathname === "/api/v1/templates") return catalog();
    if (url.pathname === "/api/v1/demo/canonical-url") return demo();
    throw new Error(`Unexpected request ${url.pathname}${url.search}`);
  });
  vi.stubGlobal("fetch", fetch);
  const services = runServices();
  const wallet = walletServices();
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  const rendered = render(
    <App
      runId={input.runId}
      projectToken={input.projectToken}
      services={services}
      analytics={input.analytics}
      walletAccess={{ services: wallet, storage }}
    />,
  );
  return { ...rendered, fetch, services, wallet, storage };
}

function expectNoPrivatePorts(fixture: ReturnType<typeof renderPath>) {
  for (const port of Object.values(fixture.services)) {
    if (typeof port === "function") expect(port).not.toHaveBeenCalled();
  }
  for (const port of Object.values(fixture.wallet)) {
    expect(port).not.toHaveBeenCalled();
  }
}

async function expectReadyLanding() {
  expect(
    await screen.findByRole("heading", {
      name: "Trust the intended URL, not only a valid proof.",
    }),
  ).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "Response-derived starting point" }),
  ).toBeVisible();
  expect(await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" })).toBeVisible();
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Slice 026 public landing", () => {
  it("owns root with the exact public shell, hero and neutral journey", async () => {
    renderPath();
    await expectReadyLanding();

    expect(screen.getByText("Coston2 · Web2Json consumer assurance")).toBeVisible();
    expect(screen.getByText(
      "Proofline verifies the consumer’s scheme, host, path, and query, then packages reproducible evidence and safe Solidity.",
    )).toBeVisible();
    expect(screen.getByRole("link", { name: "Browse templates" })).toHaveAttribute("href", "/templates");
    expect(screen.getByRole("link", { name: "Open runs" })).toHaveAttribute("href", "/runs");
    expect(screen.getByRole("heading", { name: "From proof to integration evidence" })).toBeVisible();

    const journey = [
      ["Proof available", "Shown only after the persisted proof stage completes."],
      ["Verify consumer", "Check scheme, host, path, and query invariants."],
      ["Generate safe consumer", "Turn evidence-backed findings into deterministic Solidity."],
      ["Open integration package", "Export the receipt, bundle, manifest, and consumer together."],
    ];
    const items = document.querySelectorAll("main ol > li");
    expect(items).toHaveLength(4);
    journey.forEach(([title, description], index) => {
      expect(items[index]).toHaveTextContent(title);
      expect(items[index]).toHaveTextContent(description);
      expect(items[index]).not.toHaveAttribute("aria-current");
      expect(items[index]).not.toHaveClass("is-completed");
    });

    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Proofline home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Runs" })).toHaveAttribute("href", "/runs");
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent(/^Overview$/);
    expect(screen.getByRole("button", { name: "Network: Coston2" })).toBeVisible();
    expect(document.querySelector(".attestation-type")).toHaveTextContent("Web2Json");
    expect(screen.queryByText("Run status unavailable")).not.toBeInTheDocument();
  });

  it("renders only response-derived featured summary and bounded persisted-demo metadata", async () => {
    const summary = makeCanonicalUrlAttackDemoSummaryFixture();
    renderPath({ demo: async () => Response.json(summary) });
    await expectReadyLanding();

    expect(screen.getByRole("heading", { name: "Featured starting point" })).toBeVisible();
    expect(screen.getByText("Response provider")).toBeVisible();
    expect(screen.getByText("A response-derived summary used only by this contract test.")).toBeVisible();
    expect(screen.getByRole("link", { name: /use template/i })).toHaveAttribute(
      "href",
      "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
    );
    expect(screen.getByText("Canonical URL attack")).toBeVisible();
    expect(screen.getByText("Persisted evidence available")).toBeVisible();
    expect(screen.getByRole("link", { name: "Inspect evidence" })).toHaveAttribute(
      "href",
      "/demo/canonical-url",
    );
    expect(document.body).toHaveTextContent("2026");
    expect(document.body).toHaveTextContent("2");
    expect(document.body).toHaveTextContent("3");
    expect(document.body.textContent).not.toMatch(/sha256:[a-f0-9]{64}|0x[a-f0-9]{64}/i);
    expect(document.body).not.toHaveTextContent(summary.runs.attack.requestedUrl);
  });

  it("performs exactly two independent anonymous same-origin summary reads", async () => {
    const fixture = renderPath();
    await expectReadyLanding();

    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    const ledger = fixture.fetch.mock.calls.map(([target, init]) => {
      const url = new URL(target instanceof Request ? target.url : String(target), window.location.origin);
      const options = init as RequestInit | undefined;
      return {
        origin: url.origin,
        path: `${url.pathname}${url.search}`,
        method: options?.method,
        credentials: options?.credentials,
        authorization: new Headers(options?.headers).get("authorization"),
        body: options?.body,
      };
    }).sort((left, right) => left.path.localeCompare(right.path));
    expect(ledger).toEqual([
      {
        origin: window.location.origin,
        path: "/api/v1/demo/canonical-url",
        method: "GET",
        credentials: "omit",
        authorization: null,
        body: undefined,
      },
      {
        origin: window.location.origin,
        path: "/api/v1/templates",
        method: "GET",
        credentials: "omit",
        authorization: null,
        body: undefined,
      },
    ]);
    expectNoPrivatePorts(fixture);
    expect(fixture.storage.getItem).not.toHaveBeenCalled();
    expect(fixture.storage.setItem).not.toHaveBeenCalled();
    expect(document.querySelector('a[href*="/recording"]')).toBeNull();
    expect(document.querySelector('a[href^="https://"]')).toBeNull();
  });

  it("settles catalog and demo loading independently", async () => {
    const catalog = deferredResponse();
    const demo = deferredResponse();
    renderPath({
      catalog: async () => catalog.promise,
      demo: async () => demo.promise,
    });

    expect(screen.getAllByRole("status").some((node) =>
      node.textContent?.includes("Loading featured template…"),
    )).toBe(true);
    expect(screen.getAllByRole("status").some((node) =>
      node.textContent?.includes("Checking canonical attack evidence…"),
    )).toBe(true);

    await act(async () => { catalog.resolve(Response.json(featuredCatalog())); });
    expect(await screen.findByRole("heading", { name: "Response-derived starting point" })).toBeVisible();
    expect(screen.getByText("Checking canonical attack evidence…")).toBeVisible();

    await act(async () => { demo.resolve(Response.json(makeCanonicalUrlAttackDemoSummaryFixture())); });
    expect(await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" })).toBeVisible();
  });

  it("keeps verified demo evidence when the catalog is unavailable", async () => {
    renderPath({ catalog: async () => new Response(null, { status: 503 }) });
    expect(await screen.findByRole("heading", { name: "Featured template unavailable" })).toBeVisible();
    expect(screen.getByText(
      "The built-in catalog could not be verified. No template manifest was substituted.",
    )).toBeVisible();
    expect(screen.getByRole("link", { name: "Open blank Composer" })).toHaveAttribute(
      "href",
      "/runs/new?step=source",
    );
    expect(await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" })).toBeVisible();
  });

  it("keeps the featured template when persisted demo evidence is unavailable", async () => {
    renderPath({ demo: async () => new Response(null, { status: 503 }) });
    expect(await screen.findByRole("heading", { name: "Response-derived starting point" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Verified recording unavailable" })).toBeVisible();
    expect(screen.getByText(
      "No verified persisted recording is available for this deployment. Proofline does not substitute a fixture or synthetic result.",
    )).toBeVisible();
    expect(screen.getByRole("link", { name: "View availability details" })).toHaveAttribute(
      "href",
      "/demo/canonical-url",
    );
    expect(screen.queryByText("Persisted evidence available")).not.toBeInTheDocument();
  });

  it("shows two neutral unavailable states without substituting claims", async () => {
    renderPath({
      catalog: async () => new Response(null, { status: 503 }),
      demo: async () => new Response(null, { status: 503 }),
    });
    expect(await screen.findByRole("heading", { name: "Featured template unavailable" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Verified recording unavailable" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/live demo|production ready|hosted|deployed/i);
  });

  it.each([
    ["catalog", async () => Response.json({ version: "1", templates: [], fixture: "FABRICATED_FIXTURE_PAYLOAD" })],
    ["demo", async () => Response.json({ version: "1", status: "available", fixture: "FABRICATED_FIXTURE_PAYLOAD" })],
  ] as const)("normalizes a malformed %s response without coupling the other region", async (kind, invalid) => {
    renderPath(kind === "catalog" ? { catalog: invalid } : { demo: invalid });
    if (kind === "catalog") {
      expect(await screen.findByRole("heading", { name: "Featured template unavailable" })).toBeVisible();
      expect(await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" })).toBeVisible();
    } else {
      expect(await screen.findByRole("heading", { name: "Response-derived starting point" })).toBeVisible();
      expect(await screen.findByRole("heading", { name: "Verified recording unavailable" })).toBeVisible();
      expect(screen.getByText(
        "No verified persisted recording is available for this deployment. Proofline does not substitute a fixture or synthetic result.",
      )).toBeVisible();
      expect(screen.queryByText("Persisted evidence available")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Inspect evidence" })).not.toBeInTheDocument();
      expect(document.querySelector('a[href*="/recording"]')).toBeNull();
      expect(document.body.textContent).not.toMatch(/sha256:[a-f0-9]{64}|0x[a-f0-9]{64}/i);
    }
    expect(document.body).not.toHaveTextContent("FABRICATED_FIXTURE_PAYLOAD");
  });

  it("scrubs root search and hash before reads, storage or analytics", async () => {
    const emit = vi.fn<ProductAnalyticsPort["emit"]>();
    const analytics: ProductAnalyticsPort = { emit };
    const sessionGet = vi.spyOn(Storage.prototype, "getItem");
    const sessionSet = vi.spyOn(Storage.prototype, "setItem");
    const fixture = renderPath({
      path: `/?ignored=1#share=share_${"f".repeat(64)}`,
      analytics,
    });
    await expectReadyLanding();

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/");
    for (const [target] of fixture.fetch.mock.calls) {
      expect(String(target)).not.toMatch(/ignored|share_/);
    }
    expect(document.body.textContent).not.toMatch(/ignored|share_/);
    expect(sessionGet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores injected project authority and never restores wallet state on root", async () => {
    const fixture = renderPath({ projectToken: `project_${"a".repeat(64)}` });
    await expectReadyLanding();
    expectNoPrivatePorts(fixture);
    expect(fixture.storage.getItem).not.toHaveBeenCalled();
    expect(fixture.storage.setItem).not.toHaveBeenCalled();
    expect(screen.queryByText(/sign in|connect wallet/i)).not.toBeInTheDocument();
  });

  it("preserves explicit injected run identity as the test composition authority", async () => {
    const fixture = renderPath({
      runId: "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
      projectToken: `project_${"a".repeat(64)}`,
    });
    expect(
      await screen.findByRole("heading", { name: /loading run|run unavailable|run not found/i }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", {
      name: "Trust the intended URL, not only a valid proof.",
    })).not.toBeInTheDocument();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "/home",
    "/templates/open-meteo-current-weather/extra",
    "/demo/canonical-url/",
    "/not-a-proofline-route",
  ])("fails an unknown or alias route honestly without private or public reads: %s", async (path) => {
    const fixture = renderPath({ path });
    expect(screen.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
    expect(screen.getByText("This Proofline route is not available in this build.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Open runs" })).toHaveAttribute("href", "/runs");
    expect(fixture.fetch).not.toHaveBeenCalled();
    expectNoPrivatePorts(fixture);
    expect(fixture.storage.getItem).not.toHaveBeenCalled();
  });

  it("reuses App-owned root reads across landing, templates and demo popstate navigation", async () => {
    const fixture = renderPath();
    await expectReadyLanding();

    window.history.pushState({}, "", "/templates");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(await screen.findByRole("heading", { name: "Start from a template" })).toBeVisible();

    window.history.pushState({}, "", "/");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await expectReadyLanding();

    window.history.pushState({}, "", "/demo/canonical-url");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(await screen.findByRole("heading", { name: "Valid proof ≠ trusted URL" })).toBeVisible();

    window.history.pushState({}, "", "/");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await expectReadyLanding();

    const paths = fixture.fetch.mock.calls.map(([target]) =>
      new URL(target instanceof Request ? target.url : String(target), window.location.origin).pathname,
    );
    expect(paths.filter((path) => path === "/api/v1/templates")).toHaveLength(2);
    expect(paths.filter((path) => path === "/api/v1/demo/canonical-url")).toHaveLength(1);
  });

  it("shares template presentation without shipping a second manifest or provider authority", () => {
    expect(landingSource).not.toBe("");
    expect(landingSource).not.toContain("/runs/new?template=");
    expect(landingSource).toMatch(/Template(?:Card|Summary)/);
    expect(landingSource).toMatch(
      /from\s+["']\.\/(?:TemplateCatalogSurface|TemplateSummaryCard)["']/,
    );
    expect(templateSurfaceSource).toMatch(/Template(?:Card|Summary)/);
    expect(landingSource).not.toMatch(/api\.open-meteo\.com|api\.coinbase\.com/);
    expect(landingSource).not.toMatch(/Berlin current temperature|Open-Meteo|Coinbase|ETH\/USD spot price/);
    expect(landingSource).not.toMatch(/sha256:[a-f0-9]{64}|abiSignature|expectedHost|\.temperature_2m/);
    expect(landingSource).not.toMatch(/wallet|WalletSession|listNetworks|createRun|hydrateRun/);
  });

  it("has no serious or critical accessibility violations in the ready state", async () => {
    const rendered = renderPath();
    await expectReadyLanding();
    const result = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter(({ impact }) =>
      impact === "serious" || impact === "critical",
    )).toEqual([]);
  });
});
