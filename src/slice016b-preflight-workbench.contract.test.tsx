import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductEventV1, PreflightReportV1 } from "../packages/contracts/src";
import { PreflightReportV1Schema } from "../packages/contracts/src";
import {
  attentionPreflightReport,
  blockedPreflightReport,
  RUN_ID,
  validPreflightReport,
} from "../packages/contracts/test/fixtures";
import { App } from "./App";
import {
  createLiveSurfaceServices,
  type HydratedRunView,
  type RunServiceContext,
  type RunSurfaceServices,
} from "./services/run-surface";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;

type HasTypedPreflightRead = RunSurfaceServices extends {
  getPreflightReport?: (
    context: RunServiceContext,
  ) => Promise<PreflightReportV1>;
}
  ? true
  : false;

// Compile-time RED: Slice 016B exposes the persisted report through the typed
// surface port instead of letting React reach into RunClient.
const typedPreflightReadPort: HasTypedPreflightRead = true;
void typedPreflightReadPort;

function parsedReport(value: unknown = validPreflightReport): PreflightReportV1 {
  return PreflightReportV1Schema.parse(structuredClone(value));
}

function runAt(input: {
  sequence?: number;
  preflight?: HydratedRunView["stages"]["preflight"];
  terminal?: boolean;
} = {}): HydratedRunView {
  const preflight = input.preflight ?? "completed";
  return {
    runId: RUN_ID,
    title: "ETH/USD persisted request",
    attestationType: "Web2Json",
    network: "coston2",
    startedAt: "2026-08-02T01:00:00.000Z",
    sequence: input.sequence ?? 2,
    terminal: input.terminal ?? true,
    stages: {
      preflight,
      request: "pending",
      round: "pending",
      proof: "pending",
      verify: "pending",
      consumer: "pending",
    },
    diagnostics: [],
    evidence: {},
  };
}

type TestSurface = RunSurfaceServices & {
  getPreflightReport(context: RunServiceContext): Promise<PreflightReportV1>;
};

function surfaceServices(input: {
  hydrateRun?: ReturnType<typeof vi.fn>;
  getPreflightReport?: ReturnType<typeof vi.fn>;
} = {}): TestSurface {
  return {
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
    hydrateRun:
      input.hydrateRun ?? vi.fn().mockResolvedValue(runAt()),
    getPreflightReport:
      input.getPreflightReport ??
      vi.fn().mockResolvedValue(parsedReport()),
  } as unknown as TestSurface;
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

function preflightEvents(events: readonly ProductEventV1[]) {
  return events.filter((event) => event.name === "PREFLIGHT_COMPLETED");
}

function typedReportError(
  status: 409 | 500 | 503,
  code:
    | "PREFLIGHT_REPORT_PENDING"
    | "PREFLIGHT_REPORT_UNAVAILABLE"
    | "PREFLIGHT_REPORT_INVALID"
    | "TRANSPORT_UNAVAILABLE",
) {
  return Object.assign(new Error("Safe persisted report read failed"), {
    status,
    code,
  });
}

async function renderWorkbench(input: {
  token?: string;
  report?: PreflightReportV1;
  services?: TestSurface;
} = {}) {
  window.history.replaceState(
    {},
    "",
    `/runs/${RUN_ID}?step=preflight&status=active`,
  );
  const services =
    input.services ??
    surfaceServices({
      getPreflightReport: vi
        .fn()
        .mockResolvedValue(input.report ?? parsedReport()),
    });
  render(
    <App
      runId={RUN_ID}
      projectToken={input.token ?? PROJECT_TOKEN}
      services={services}
    />,
  );
  await screen.findByRole("heading", { name: "ETH/USD persisted request" });
  return services;
}

function expectBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

async function flushReactWork() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 016B persisted report surface port", () => {
  it("reads the schema-validated report through the live RunSurfaceServices port", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validPreflightReport), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const services = createLiveSurfaceServices({
      baseUrl: "https://control.proofline.test/api",
      projectToken: PROJECT_TOKEN,
      storage: { getItem: () => null, setItem: () => undefined },
    });
    const preflightServices = services as RunSurfaceServices & {
      getPreflightReport(
        context: RunServiceContext,
      ): Promise<PreflightReportV1>;
    };

    expect(preflightServices.getPreflightReport).toBeTypeOf("function");
    await expect(
      preflightServices.getPreflightReport({
        runId: RUN_ID,
        projectToken: PROJECT_TOKEN,
      }),
    ).resolves.toEqual(validPreflightReport);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://control.proofline.test/api/v1/runs/${RUN_ID}/preflight`,
    );
  });
});

describe("Slice 016B Preflight Workbench evidence", () => {
  it.each([
    ["ready", validPreflightReport, "Ready to submit"],
    ["attention", attentionPreflightReport, "Review before submission"],
    ["blocked", blockedPreflightReport, "Submission blocked"],
  ] as const)("renders the persisted %s verdict heading", async (_verdict, report, heading) => {
    await renderWorkbench({ report: parsedReport(report) });

    const workbench = screen.getByRole("region", { name: /preflight workbench/i });
    expect(within(workbench).getByRole("heading", { name: heading })).toBeVisible();
  });

  it("keeps the full evidence in the fixed reading order and renders exactly five samples", async () => {
    await renderWorkbench({ report: parsedReport(attentionPreflightReport) });

    const workbench = screen.getByRole("region", { name: /preflight workbench/i });
    const verdict = within(workbench).getByRole("heading", {
      name: "Review before submission",
    });
    const identity = within(workbench).getByRole("region", {
      name: /request identity and fee/i,
    });
    const samples = within(workbench).getByRole("region", {
      name: /determinism samples/i,
    });
    const transform = within(workbench).getByRole("region", {
      name: /transform and abi evidence/i,
    });
    const findings = within(workbench).getByRole("region", {
      name: /security findings/i,
    });

    expectBefore(verdict, identity);
    expectBefore(identity, samples);
    expectBefore(samples, transform);
    expectBefore(transform, findings);

    expect(identity).toHaveTextContent(validPreflightReport.canonicalUrl);
    expect(identity).toHaveTextContent(validPreflightReport.requestIdentitySha256);
    expect(identity).toHaveTextContent(validPreflightReport.fee.quotedWei);
    expect(identity).toHaveTextContent(validPreflightReport.fee.capWei);
    expect(identity).toHaveTextContent(/chain\s*114/i);
    expect(identity).toHaveTextContent(validPreflightReport.registrySnapshot.blockNumber);
    expect(identity).toHaveTextContent(validPreflightReport.registrySnapshot.registryAddress);
    expect(identity).toHaveTextContent(
      validPreflightReport.registrySnapshot.resolvedContracts.FdcHub,
    );

    const sampleRows = within(samples).getAllByRole("listitem");
    expect(sampleRows).toHaveLength(5);
    sampleRows.forEach((row, index) => {
      expect(row).toHaveTextContent(String(index + 1));
      expect(row).toHaveTextContent(
        attentionPreflightReport.sampleFingerprints[index]!,
      );
    });
    expect(samples).toHaveTextContent(/deterministic/i);

    expect(transform).toHaveTextContent("/price");
    expect(transform).toHaveTextContent("/value");
    expect(transform).toHaveTextContent(/ABI.*compatible|compatible.*ABI/i);
    expect(findings).toHaveTextContent("PREFLIGHT_RESPONSE_SHAPE_TRUNCATED");
    expect(findings).toHaveTextContent(/reportFields/i);
    expect(findings).toHaveTextContent(
      "Review the source schema before submission.",
    );
  });

  it.each([
    ["ready", validPreflightReport, true],
    ["attention", attentionPreflightReport, true],
    ["blocked", blockedPreflightReport, false],
  ] as const)(
    "applies the project continuation policy for %s",
    async (_verdict, report, canContinue) => {
      await renderWorkbench({ report: parsedReport(report) });
      const workbench = screen.getByRole("region", {
        name: /preflight workbench/i,
      });
      const action = within(workbench).queryByRole("button", {
        name: /continue to submission/i,
      });
      if (canContinue) expect(action).toBeEnabled();
      else expect(action).not.toBeInTheDocument();
    },
  );

  it("keeps a share reader read-only even when the persisted verdict is ready", async () => {
    await renderWorkbench({ token: SHARE_TOKEN });

    expect(
      screen.queryByRole("button", { name: /continue to submission/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /preflight workbench/i })).toHaveTextContent(
      /read.only/i,
    );
  });

  it.each([
    [
      typedReportError(409, "PREFLIGHT_REPORT_PENDING"),
      /persisted.*evidence.*(?:preparing|pending)|(?:preparing|pending).*persisted.*evidence/i,
    ],
    [
      typedReportError(409, "PREFLIGHT_REPORT_UNAVAILABLE"),
      /preflight report.*unavailable|unavailable.*preflight report/i,
    ],
    [
      typedReportError(500, "PREFLIGHT_REPORT_INVALID"),
      /preflight report.*invalid|invalid.*preflight report/i,
    ],
  ] as const)("fails closed for a typed report error", async (cause, copy) => {
    const getPreflightReport = vi.fn().mockRejectedValue(cause);
    await renderWorkbench({
      services: surfaceServices({ getPreflightReport }),
    });

    const workbench = screen.getByRole("region", { name: /preflight workbench/i });
    expect(workbench).toHaveTextContent(copy);
    expect(workbench).not.toHaveTextContent(PROJECT_TOKEN);
    expect(workbench).not.toHaveTextContent(/stack|at RunCockpit/i);
  });

  it("never fetches the manifest source host from the browser", async () => {
    const browserFetch = vi.fn(() => {
      throw new Error("The browser must not fetch a manifest source");
    });
    vi.stubGlobal("fetch", browserFetch);

    const services = await renderWorkbench();

    expect(services.getPreflightReport).toHaveBeenCalledOnce();
    expect(browserFetch).not.toHaveBeenCalled();
  });
});

describe("Slice 016B report cache and lifecycle cursor", () => {
  it("caches one valid immutable report while the run sequence advances", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/runs/${RUN_ID}?step=preflight`);
    const hydrateRun = vi
      .fn()
      .mockResolvedValueOnce(runAt({ sequence: 1, preflight: "active", terminal: false }))
      .mockResolvedValueOnce(runAt({ sequence: 2, preflight: "completed", terminal: true }));
    const getPreflightReport = vi.fn().mockResolvedValue(parsedReport());
    const services = surfaceServices({ hydrateRun, getPreflightReport });

    render(
      <App runId={RUN_ID} projectToken={PROJECT_TOKEN} services={services} />,
    );
    await flushReactWork();
    expect(screen.getByRole("heading", { name: "Ready to submit" })).toBeVisible();
    expect(getPreflightReport).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await flushReactWork();
    expect(hydrateRun).toHaveBeenCalledTimes(2);
    expect(getPreflightReport).toHaveBeenCalledOnce();
  });

  it("retries pending only after a strictly newer persisted run sequence", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/runs/${RUN_ID}?step=preflight`);
    const hydrateRun = vi
      .fn()
      .mockResolvedValueOnce(runAt({ sequence: 1, preflight: "active", terminal: false }))
      .mockResolvedValueOnce(runAt({ sequence: 1, preflight: "active", terminal: false }))
      .mockResolvedValueOnce(runAt({ sequence: 2, preflight: "completed", terminal: true }));
    const getPreflightReport = vi
      .fn()
      .mockRejectedValueOnce(typedReportError(409, "PREFLIGHT_REPORT_PENDING"))
      .mockResolvedValueOnce(parsedReport());
    const services = surfaceServices({ hydrateRun, getPreflightReport });

    render(
      <App runId={RUN_ID} projectToken={PROJECT_TOKEN} services={services} />,
    );
    await flushReactWork();
    expect(screen.getByRole("region", { name: /preflight workbench/i })).toBeVisible();
    expect(getPreflightReport).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await flushReactWork();
    expect(hydrateRun).toHaveBeenCalledTimes(2);
    expect(getPreflightReport).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await flushReactWork();
    expect(screen.getByRole("heading", { name: "Ready to submit" })).toBeVisible();
    expect(getPreflightReport).toHaveBeenCalledTimes(2);
  });
});

describe("Slice 016B route-only submission decision", () => {
  it("preserves status, diagnostics panel, and hash across step navigation and popstate", async () => {
    window.history.replaceState(
      {},
      "",
      `/runs/${RUN_ID}?step=preflight&status=active&panel=diagnostics#sample-3`,
    );
    const user = userEvent.setup();
    const services = surfaceServices();
    const analytics = collector();
    render(
      <App
        runId={RUN_ID}
        projectToken={PROJECT_TOKEN}
        services={services}
        analytics={analytics.port}
      />,
    );
    const action = await screen.findByRole("button", {
      name: /continue to submission/i,
    });

    await user.click(action);
    let url = new URL(window.location.href);
    expect(url.searchParams.get("step")).toBe("submission");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("panel")).toBe("diagnostics");
    expect(url.hash).toBe("#sample-3");
    expect(screen.queryByRole("region", { name: /preflight workbench/i })).not.toBeInTheDocument();

    window.history.replaceState(
      {},
      "",
      `/runs/${RUN_ID}?step=preflight&status=active&panel=diagnostics#sample-3`,
    );
    fireEvent(window, new PopStateEvent("popstate"));
    expect(await screen.findByRole("region", { name: /preflight workbench/i })).toBeVisible();

    expect(services.verifyConsumer).not.toHaveBeenCalled();
    expect(services.generateConsumer).not.toHaveBeenCalled();
    expect(services.exportBundle).not.toHaveBeenCalled();
    expect(services.replayBundle).not.toHaveBeenCalled();
    expect(
      analytics.events.filter((event) => event.name === "SUBMISSION_REQUESTED"),
    ).toHaveLength(0);
  });
});

describe("Slice 016B PREFLIGHT_COMPLETED observation", () => {
  it("does not emit for initial completed hydration, report render, rerender, or reload", async () => {
    const analytics = collector();
    const services = surfaceServices();
    const view = render(
      <StrictMode>
        <App
          runId={RUN_ID}
          projectToken={PROJECT_TOKEN}
          services={services}
          analytics={analytics.port}
        />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "ETH/USD persisted request" });
    view.rerender(
      <StrictMode>
        <App
          runId={RUN_ID}
          projectToken={PROJECT_TOKEN}
          services={services}
          analytics={analytics.port}
        />
      </StrictMode>,
    );
    expect(preflightEvents(analytics.events)).toHaveLength(0);

    view.unmount();
    render(
      <StrictMode>
        <App
          runId={RUN_ID}
          projectToken={PROJECT_TOKEN}
          services={services}
          analytics={analytics.port}
        />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "ETH/USD persisted request" });
    expect(preflightEvents(analytics.events)).toHaveLength(0);
  });

  it("emits accepted once only after a strictly newer completed transition", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/runs/${RUN_ID}?step=preflight`);
    const analytics = collector();
    const hydrateRun = vi
      .fn()
      .mockResolvedValueOnce(runAt({ sequence: 1, preflight: "active", terminal: false }))
      .mockResolvedValueOnce(runAt({ sequence: 1, preflight: "completed", terminal: false }))
      .mockResolvedValueOnce(runAt({ sequence: 2, preflight: "completed", terminal: true }));

    render(
      <App
        runId={RUN_ID}
        projectToken={PROJECT_TOKEN}
        services={surfaceServices({ hydrateRun })}
        analytics={analytics.port}
      />,
    );
    await flushReactWork();
    expect(screen.getByRole("heading", { name: "ETH/USD persisted request" })).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await flushReactWork();
    expect(hydrateRun).toHaveBeenCalledTimes(2);
    expect(preflightEvents(analytics.events)).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await flushReactWork();
    expect(hydrateRun).toHaveBeenCalledTimes(3);
    expect(preflightEvents(analytics.events)).toEqual([
      expect.objectContaining({
        name: "PREFLIGHT_COMPLETED",
        metadata: { outcome: "accepted" },
      }),
    ]);
  });

  it("emits rejected once for a newly observed failed transition", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/runs/${RUN_ID}?step=preflight`);
    const analytics = collector();
    const hydrateRun = vi
      .fn()
      .mockResolvedValueOnce(runAt({ sequence: 4, preflight: "active", terminal: false }))
      .mockResolvedValueOnce(runAt({ sequence: 5, preflight: "failed", terminal: true }));

    render(
      <App
        runId={RUN_ID}
        projectToken={PROJECT_TOKEN}
        services={surfaceServices({ hydrateRun })}
        analytics={analytics.port}
      />,
    );
    await flushReactWork();
    expect(screen.getByRole("heading", { name: "ETH/USD persisted request" })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    await flushReactWork();
    expect(preflightEvents(analytics.events)).toHaveLength(1);
    expect(preflightEvents(analytics.events)[0]).toMatchObject({
      name: "PREFLIGHT_COMPLETED",
      metadata: { outcome: "rejected" },
    });
  });

  it("never emits a preflight product event for share access", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/runs/${RUN_ID}?step=preflight`);
    const analytics = collector();
    const hydrateRun = vi
      .fn()
      .mockResolvedValueOnce(runAt({ sequence: 1, preflight: "active", terminal: false }))
      .mockResolvedValueOnce(runAt({ sequence: 2, preflight: "completed", terminal: true }));

    render(
      <App
        runId={RUN_ID}
        projectToken={SHARE_TOKEN}
        services={surfaceServices({ hydrateRun })}
        analytics={analytics.port}
      />,
    );
    await flushReactWork();
    expect(screen.getByRole("heading", { name: "ETH/USD persisted request" })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await flushReactWork();
    expect(hydrateRun).toHaveBeenCalledTimes(2);

    expect(preflightEvents(analytics.events)).toHaveLength(0);
  });
});
