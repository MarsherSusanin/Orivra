import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductEventV1 } from "../packages/contracts/src";
import { App } from "./App";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EvidenceStrip } from "./components/EvidenceStrip";
import { Topbar } from "./components/Topbar";
import type {
  ConsumerVerificationResult,
  HydratedRunView,
  RunSurfaceServices,
} from "./services/run-surface";

const projectToken = `project_${"a".repeat(64)}`;
const runId = "run_product_truth";

function hydratedRun(
  overrides: Partial<HydratedRunView> = {},
): HydratedRunView {
  return {
    runId,
    title: "Persisted Web2Json run",
    attestationType: "Web2Json",
    network: "coston2",
    startedAt: "2026-08-02T01:00:00.000Z",
    sequence: 5,
    terminal: true,
    stages: {
      preflight: "completed",
      request: "completed",
      round: "completed",
      proof: "completed",
      verify: "active",
      consumer: "pending",
    },
    diagnostics: [],
    evidence: {},
    ...overrides,
  };
}

function surfaceServices(
  overrides: Partial<RunSurfaceServices> = {},
): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [] }),
    verifyConsumer: vi.fn().mockResolvedValue({
      summary: "Consumer invariants verified",
      code: "CONSUMER_VERIFIED",
      checks: [{ label: "Source host invariant", status: "passed" }],
    }),
    generateConsumer: vi.fn().mockResolvedValue({
      source: "contract SafeConsumer {}",
      sha256: "a".repeat(64),
    }),
    exportBundle: vi.fn().mockResolvedValue('{"version":"1"}'),
    replayBundle: vi.fn().mockResolvedValue({ byteIdentical: true }),
    hydrateRun: vi.fn().mockResolvedValue(hydratedRun()),
    resume: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function collector() {
  const events: ProductEventV1[] = [];
  return {
    events,
    port: {
      emit: vi.fn((event: ProductEventV1) => {
        events.push(event);
      }),
    },
  };
}

function eventsNamed(events: readonly ProductEventV1[], name: ProductEventV1["name"]) {
  return events.filter((event) => event.name === name);
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("production truth at unhydrated component boundaries", () => {
  it("never invents a run title when the Topbar receives no title", () => {
    render(
      <Topbar
        title={undefined as never}
        network="Coston2"
        attestationType="Web2Json"
      />,
    );

    expect(screen.queryByText("ETH/USD snapshot")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent(/unavailable/i);
  });

  it("renders unavailable evidence without falling back to sample transaction data", () => {
    render(<EvidenceStrip items={undefined as never} />);

    const evidence = screen.getByRole("region", { name: /run evidence/i });
    expect(evidence).toHaveTextContent(/evidence (?:is )?(?:unavailable|pending)/i);
    expect(evidence).not.toHaveTextContent(/0\.012345 ETH|42871|0x9f3e/i);
  });

  it("distinguishes unavailable diagnostics from a confirmed empty result", () => {
    const { rerender } = render(
      <DiagnosticsPanel
        diagnostics={undefined}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );

    const diagnostics = screen.getByRole("complementary", { name: /diagnostics/i });
    expect(diagnostics).toHaveTextContent(/diagnostics (?:are )?(?:unavailable|pending)/i);
    expect(diagnostics).not.toHaveTextContent(
      /missing consumer host invariant|CONSUMER_INVARIANT_MISSING|api\.example\.com/i,
    );
    expect(diagnostics).not.toHaveTextContent(/no invariant findings/i);

    rerender(
      <DiagnosticsPanel diagnostics={[]} expanded={false} onToggle={vi.fn()} />,
    );
    expect(diagnostics).toHaveTextContent(/no invariant findings/i);
  });
});

describe("ProductEventV1 journey instrumentation", () => {
  it("emits RUN_RESUMED once and only when a resumable run is explicitly opened", async () => {
    window.history.replaceState({}, "", "/runs");
    const analytics = collector();
    const runs = [
      {
        version: "1" as const,
        runId: "run_resume_me",
        network: "coston2" as const,
        sourceHost: "resume.example.org",
        submissionMode: "wallet" as const,
        currentStage: "proof" as const,
        status: "active" as const,
        createdAt: "2026-08-02T01:00:00.000Z",
        updatedAt: "2026-08-02T02:00:00.000Z",
        lastSequence: 5,
        resumable: true,
      },
      {
        version: "1" as const,
        runId: "run_complete",
        network: "coston2" as const,
        sourceHost: "complete.example.org",
        submissionMode: "replay" as const,
        currentStage: "consumer" as const,
        status: "completed" as const,
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T01:00:00.000Z",
        lastSequence: 8,
        resumable: false,
      },
    ];
    render(
      <App
        projectToken={projectToken}
        services={surfaceServices({
          listRuns: vi.fn().mockResolvedValue({ version: "1", runs }),
        })}
        analytics={analytics.port}
      />,
    );

    const recent = await screen.findByRole("region", { name: /recent runs/i });
    expect(eventsNamed(analytics.events, "RUN_RESUMED")).toHaveLength(0);

    fireEvent.click(within(recent).getByRole("link", { name: /complete\.example\.org/i }));
    expect(eventsNamed(analytics.events, "RUN_RESUMED")).toHaveLength(0);

    fireEvent.click(within(recent).getByRole("link", { name: /resume\.example\.org/i }));
    expect(eventsNamed(analytics.events, "RUN_RESUMED")).toEqual([
      expect.objectContaining({
        name: "RUN_RESUMED",
        metadata: { priorStatus: "active" },
      }),
    ]);
  });

  it("emits one PROOF_AVAILABLE for repeated confirmed hydration in StrictMode", async () => {
    const analytics = collector();
    const hydrateRun = vi.fn().mockResolvedValue(
      hydratedRun({ terminal: false }),
    );
    const services = surfaceServices({ hydrateRun });

    const view = render(
      <StrictMode>
        <App
          runId={runId}
          projectToken={projectToken}
          services={services}
          analytics={analytics.port}
        />
      </StrictMode>,
    );

    expect(eventsNamed(analytics.events, "PROOF_AVAILABLE")).toHaveLength(0);
    await screen.findByRole("heading", { name: "Persisted Web2Json run" });
    await waitFor(
      () => expect(hydrateRun.mock.calls.length).toBeGreaterThanOrEqual(3),
      { timeout: 2_800 },
    );
    view.rerender(
      <StrictMode>
        <App
          runId={runId}
          projectToken={projectToken}
          services={services}
          analytics={analytics.port}
        />
      </StrictMode>,
    );

    expect(eventsNamed(analytics.events, "PROOF_AVAILABLE")).toEqual([
      expect.objectContaining({
        name: "PROOF_AVAILABLE",
        metadata: { source: "live" },
      }),
    ]);
  });

  it("records an actual invariant failure and successful safe codegen exactly once", async () => {
    const user = userEvent.setup();
    const analytics = collector();
    const failedResult: ConsumerVerificationResult = {
      summary: "Consumer needs one fix",
      code: "EXPECTED_HOST_NOT_ENFORCED",
      checks: [
        { label: "Cryptographic proof", status: "passed" },
        { label: "Source host invariant", status: "failed" },
      ],
    };
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={surfaceServices({
          verifyConsumer: vi.fn().mockResolvedValue(failedResult),
        })}
        analytics={analytics.port}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /verify consumer/i }));
    const dialog = screen.getByRole("dialog", { name: /consumer verification/i });
    await user.click(within(dialog).getByRole("button", { name: /run verification/i }));
    await within(dialog).findByText("Consumer needs one fix");

    expect(eventsNamed(analytics.events, "CONSUMER_VERIFICATION_FAILED")).toEqual([
      expect.objectContaining({
        name: "CONSUMER_VERIFICATION_FAILED",
        metadata: { category: "consumer-invariant" },
      }),
    ]);
    expect(eventsNamed(analytics.events, "SAFE_CODEGEN_GENERATED")).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: /generate safe consumer/i }),
    );
    await within(dialog).findByText(/safe consumer generated/i);
    expect(eventsNamed(analytics.events, "SAFE_CODEGEN_GENERATED")).toEqual([
      expect.objectContaining({
        name: "SAFE_CODEGEN_GENERATED",
        metadata: { target: "solidity" },
      }),
    ]);
  });

  it("does not report a consumer invariant failure for success or transport rejection", async () => {
    const successAnalytics = collector();
    const successUser = userEvent.setup();
    const successView = render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={surfaceServices()}
        analytics={successAnalytics.port}
      />,
    );
    await successUser.click(await screen.findByRole("button", { name: /verify consumer/i }));
    await successUser.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /run verification/i }),
    );
    await within(screen.getByRole("dialog")).findByText("Consumer invariants verified");
    expect(eventsNamed(successAnalytics.events, "CONSUMER_VERIFICATION_FAILED")).toHaveLength(0);
    successView.unmount();

    const rejectedAnalytics = collector();
    const rejectedUser = userEvent.setup();
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={surfaceServices({
          verifyConsumer: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
        })}
        analytics={rejectedAnalytics.port}
      />,
    );
    await rejectedUser.click(await screen.findByRole("button", { name: /verify consumer/i }));
    await rejectedUser.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /run verification/i }),
    );
    await within(screen.getByRole("dialog")).findByRole("alert");
    expect(eventsNamed(rejectedAnalytics.events, "CONSUMER_VERIFICATION_FAILED")).toHaveLength(0);
  });

  it("does not report safe codegen when generation fails", async () => {
    const user = userEvent.setup();
    const analytics = collector();
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={surfaceServices({
          verifyConsumer: vi.fn().mockResolvedValue({
            summary: "Consumer needs one fix",
            code: "EXPECTED_HOST_NOT_ENFORCED",
            checks: [{ label: "Source host invariant", status: "failed" }],
          }),
          generateConsumer: vi.fn().mockRejectedValue(new Error("Compiler unavailable")),
        })}
        analytics={analytics.port}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /verify consumer/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /run verification/i }));
    await within(dialog).findByText("Consumer needs one fix");
    await user.click(
      within(dialog).getByRole("button", { name: /generate safe consumer/i }),
    );
    await within(dialog).findByRole("alert");

    expect(eventsNamed(analytics.events, "SAFE_CODEGEN_GENERATED")).toHaveLength(0);
  });

  it.each([
    {
      label: "byte-identical replay",
      replay: vi.fn().mockResolvedValue({ byteIdentical: true }),
      exportBundle: vi.fn().mockResolvedValue('{"version":"1"}'),
      outcome: "byte-identical",
    },
    {
      label: "replay mismatch",
      replay: vi.fn().mockResolvedValue({ byteIdentical: false }),
      exportBundle: vi.fn().mockResolvedValue('{"version":"1"}'),
      outcome: "mismatch",
    },
    {
      label: "replay rejection",
      replay: vi.fn().mockRejectedValue(new Error("Replay rejected")),
      exportBundle: vi.fn().mockResolvedValue('{"version":"1"}'),
      outcome: "rejected",
    },
    {
      label: "export rejection",
      replay: vi.fn(),
      exportBundle: vi.fn().mockRejectedValue(new Error("Export rejected")),
      outcome: "rejected",
    },
  ] as const)("emits BUNDLE_REPLAYED once for $label", async ({ replay, exportBundle, outcome }) => {
    const user = userEvent.setup();
    const analytics = collector();
    render(
      <App
        runId={runId}
        projectToken={projectToken}
        services={surfaceServices({ replayBundle: replay, exportBundle })}
        analytics={analytics.port}
      />,
    );

    expect(eventsNamed(analytics.events, "BUNDLE_REPLAYED")).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: /export bundle/i }));
    if (outcome === "byte-identical") {
      await screen.findByText(/bundle verified/i);
    } else {
      await screen.findByRole("alert");
    }

    expect(eventsNamed(analytics.events, "BUNDLE_REPLAYED")).toEqual([
      expect.objectContaining({
        name: "BUNDLE_REPLAYED",
        metadata: { outcome },
      }),
    ]);
  });
});
