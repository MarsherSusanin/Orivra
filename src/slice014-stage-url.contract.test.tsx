import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { HydratedRunView, RunSurfaceServices } from "./services/run-surface";
import {
  expectOnlyTemplateCatalogFetches,
  installTemplateCatalogFetch,
} from "./test/slice025-template-fetch";

const projectToken = `project_${"b".repeat(64)}`;
const runId = "run_stage_truth";

const pendingStages: HydratedRunView["stages"] = {
  preflight: "pending",
  request: "pending",
  round: "pending",
  proof: "pending",
  verify: "pending",
  consumer: "pending",
};

function runAt(
  stages: Partial<HydratedRunView["stages"]>,
  diagnostics: HydratedRunView["diagnostics"] = [],
): HydratedRunView {
  return {
    runId,
    title: "Persisted Web2Json run",
    attestationType: "Web2Json",
    network: "coston2",
    startedAt: "2026-08-02T01:00:00.000Z",
    sequence: 3,
    terminal: false,
    stages: { ...pendingStages, ...stages },
    diagnostics,
    evidence: {},
  };
}

function services(run: HydratedRunView): RunSurfaceServices {
  return {
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    hydrateRun: vi.fn().mockResolvedValue(run),
    resume: vi.fn().mockReturnValue(null),
  };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("stage-aware Run Cockpit truth", () => {
  it.each([
    ["preflight", "active", { preflight: "active" }],
    ["request", "pending", { preflight: "completed", request: "pending" }],
    ["request", "failed", { preflight: "completed", request: "failed" }],
    ["round", "active", { preflight: "completed", request: "completed", round: "active" }],
    ["proof", "pending", { preflight: "completed", request: "completed", round: "completed", proof: "pending" }],
    ["proof", "active", { preflight: "completed", request: "completed", round: "completed", proof: "active" }],
    ["proof", "failed", { preflight: "completed", request: "completed", round: "completed", proof: "failed" }],
  ] as const)(
    "does not unlock proof actions while %s is %s",
    async (stage, state, stages) => {
      render(
        <App
          runId={runId}
          projectToken={projectToken}
          services={services(runAt(stages))}
        />,
      );
      await screen.findByRole("heading", { name: "Persisted Web2Json run" });

      const topbar = document.querySelector<HTMLElement>(".topbar");
      const nextAction = document.querySelector<HTMLElement>(".next-action");
      expect(topbar).not.toBeNull();
      expect(nextAction).not.toBeNull();
      expect(topbar!).not.toHaveTextContent(/proof available/i);
      expect(topbar!).toHaveTextContent(new RegExp(`${stage}.*${state}|${state}.*${stage}`, "i"));
      expect(nextAction!).toHaveTextContent(new RegExp(stage, "i"));
      expect(nextAction!).not.toHaveTextContent(/proof is ready/i);
      expect(screen.queryByRole("button", { name: /verify consumer/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /export bundle/i })).not.toBeInTheDocument();
    },
  );

  it("unlocks the exact consumer and bundle actions only after proof is completed", async () => {
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={services(runAt({
          preflight: "completed",
          request: "completed",
          round: "completed",
          proof: "completed",
          verify: "pending",
          consumer: "pending",
        }))}
      />,
    );
    await screen.findByRole("heading", { name: "Persisted Web2Json run" });

    expect(document.querySelector(".topbar")).toHaveTextContent(/proof available/i);
    expect(screen.getByRole("heading", { name: /proof is ready/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^verify consumer/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^export bundle/i })).toBeEnabled();
  });
});

describe("/runs/new Composer step URL contract", () => {
  it("canonicalizes an invalid step and legacy template revision in one URL replacement", async () => {
    window.history.replaceState({}, "", "/runs/new?step=unknown&template=eth-usd");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const fetch = installTemplateCatalogFetch();
    render(<App services={services(runAt({}))} />);

    const steps = await screen.findByRole("navigation", { name: /composer steps/i });
    expect(within(steps).getByRole("link", { name: /source/i })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(new URLSearchParams(window.location.search).get("step")).toBe("source");
    expect(new URLSearchParams(window.location.search).get("template")).toBe("eth-usd");
    expect(new URLSearchParams(window.location.search).get("revision")).toBe("1");
    expect(replaceState).toHaveBeenCalledTimes(1);
    expectOnlyTemplateCatalogFetches(fetch);
  });

  it("writes a real URL and restores the visible current step on popstate", async () => {
    window.history.replaceState({}, "", "/runs/new?step=source&status=active");
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    render(<App services={services(runAt({}))} />);

    const steps = screen.getByRole("navigation", { name: /composer steps/i });
    const transform = within(steps).getByRole("link", { name: /transform/i });
    const transformUrl = new URL(transform.getAttribute("href")!, window.location.origin);
    expect(transformUrl.pathname).toBe("/runs/new");
    expect(transformUrl.searchParams.get("step")).toBe("transform");
    expect(transform).not.toHaveAttribute("href", "#");
    await user.click(transform);

    expect(pushState).toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("step")).toBe("transform");
    expect(new URLSearchParams(window.location.search).get("status")).toBe("active");
    expect(transform).toHaveAttribute("aria-current", "step");

    window.history.replaceState({}, "", "/runs/new?step=trust&status=active");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(within(steps).getByRole("link", { name: /trust/i })).toHaveAttribute(
      "aria-current",
      "step",
    );

    window.history.replaceState({}, "", "/runs/new?step=submit&status=active");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(within(steps).getByRole("link", { name: /submit/i })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});

describe("/runs/:id diagnostics panel URL contract", () => {
  const diagnostic = [{
    code: "CONSUMER_HOST_MISMATCH",
    severity: "error" as const,
    confidence: "high" as const,
    summary: "Expected host is not enforced",
    evidence: { expected: "api.example.org", observed: "mirror.example.org" },
    remediation: "Enforce the exact expected host.",
  }];

  it("restores the open diagnostics panel from a reload URL", async () => {
    window.history.replaceState({}, "", `/runs/${runId}?panel=diagnostics&step=trust`);
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={services(runAt({ proof: "completed" }, diagnostic))}
      />,
    );

    const details = await screen.findByRole("button", { name: /hide details/i });
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: /diagnostic evidence/i })).toBeVisible();
  });

  it("writes and removes panel while preserving every other query param", async () => {
    window.history.replaceState({}, "", `/runs/${runId}?step=trust&status=active`);
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={services(runAt({ proof: "completed" }, diagnostic))}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /view details/i }));
    let params = new URLSearchParams(window.location.search);
    expect(params.get("panel")).toBe("diagnostics");
    expect(params.get("step")).toBe("trust");
    expect(params.get("status")).toBe("active");
    expect(pushState).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /hide details/i }));
    params = new URLSearchParams(window.location.search);
    expect(params.has("panel")).toBe(false);
    expect(params.get("step")).toBe("trust");
    expect(params.get("status")).toBe("active");
  });

  it("restores panel state on back and forward popstate", async () => {
    window.history.replaceState({}, "", `/runs/${runId}?step=trust`);
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={services(runAt({ proof: "completed" }, diagnostic))}
      />,
    );
    await screen.findByRole("button", { name: /view details/i });

    window.history.replaceState({}, "", `/runs/${runId}?step=trust&panel=diagnostics`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByRole("button", { name: /hide details/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    window.history.replaceState({}, "", `/runs/${runId}?step=trust`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByRole("button", { name: /view details/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
