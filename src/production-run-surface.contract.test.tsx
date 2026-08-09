import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";
import { createProjectWalletAccessFixture } from "./test/wallet-access-fixture";

const projectToken = `project_${"a".repeat(64)}`;
const deepRunId = "run_01DEEPJYXW5ZC6K9JSGG0TQ7V8";

function services(overrides: Record<string, unknown> = {}) {
  return {
    verifyConsumer: vi.fn().mockResolvedValue({
      summary: "Consumer invariants verified",
      code: "CONSUMER_VERIFIED",
      checks: [],
    }),
    generateConsumer: vi.fn().mockResolvedValue({ source: "contract Safe {}" }),
    exportBundle: vi.fn().mockResolvedValue('{"version":"1"}'),
    replayBundle: vi.fn().mockResolvedValue({ byteIdentical: true }),
    resume: vi.fn().mockReturnValue(null),
    hydrateRun: vi.fn().mockResolvedValue({
      runId: deepRunId,
      title: "BTC/USD oracle",
      attestationType: "Web2Json",
      network: "Coston2",
      sequence: 7,
      terminal: true,
      stages: {
        preflight: "completed",
        request: "completed",
        round: "completed",
        proof: "completed",
        verify: "completed",
        consumer: "completed",
      },
      diagnostics: [],
      evidence: {
        transactionHash: `0x${"c".repeat(64)}`,
        votingRound: "42871",
        fee: "0.012345 ETH",
        elapsed: "1m 57s",
      },
    }),
    ...overrides,
  };
}

function asSurface(value: ReturnType<typeof services>): RunSurfaceServices {
  return value as unknown as RunSurfaceServices;
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("production run route and hydration", () => {
  it("selects the persisted run from a deep /runs/:id route", async () => {
    window.history.replaceState({}, "", `/runs/${deepRunId}`);
    sessionStorage.setItem("proofline:project-token", projectToken);
    const ports = services();
    const wallet = createProjectWalletAccessFixture(projectToken);
    const user = userEvent.setup();
    render(<App services={asSurface(ports)} walletAccess={wallet.walletAccess} />);

    await waitFor(() =>
      expect(ports.hydrateRun).toHaveBeenCalledWith({
        runId: deepRunId,
        projectToken,
        after: 0,
      }),
    );
    await user.click(screen.getByRole("button", { name: /export bundle/i }));
    expect(ports.exportBundle).toHaveBeenCalledWith({ runId: deepRunId, projectToken });
  });

  it("hydrates title, projection, diagnostics, and evidence from the API", async () => {
    window.history.replaceState({}, "", `/runs/${deepRunId}`);
    sessionStorage.setItem("proofline:project-token", projectToken);
    const ports = services();
    const wallet = createProjectWalletAccessFixture(projectToken);
    render(<App services={asSurface(ports)} walletAccess={wallet.walletAccess} />);

    expect(await screen.findByRole("heading", { name: "BTC/USD oracle" })).toBeVisible();
    expect(screen.getByLabelText(/consumer: completed/i)).toBeVisible();
    expect(screen.getByText(/0xcccc/i)).toBeVisible();
    expect(screen.queryByText("ETH/USD snapshot")).not.toBeInTheDocument();
  });

  it("renders an evidence-backed failed terminal state without falling back to pending", async () => {
    window.history.replaceState({}, "", `/runs/${deepRunId}`);
    sessionStorage.setItem("proofline:project-token", projectToken);
    const ports = services({
      hydrateRun: vi.fn().mockResolvedValue({
        runId: deepRunId,
        title: "Failed consumer run",
        sequence: 7,
        terminal: true,
        stages: {
          preflight: "completed",
          request: "completed",
          round: "completed",
          proof: "completed",
          verify: "completed",
          consumer: "failed",
        },
        diagnostics: [
          {
            code: "CONSUMER_HOST_MISMATCH",
            severity: "error",
            confidence: "high",
            summary: "Expected host is not enforced",
          },
        ],
        evidence: { transactionHash: `0x${"d".repeat(64)}` },
      }),
    });
    const wallet = createProjectWalletAccessFixture(projectToken);
    render(<App services={asSurface(ports)} walletAccess={wallet.walletAccess} />);

    expect(await screen.findByLabelText(/consumer: failed/i)).toBeVisible();
    expect(screen.getByText(/expected host is not enforced/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /resume consumer lab/i })).toBeVisible();
  });
});

describe("session-only wallet onboarding", () => {
  it("blocks deep hydration until explicit wallet sign-in without changing the URL", async () => {
    window.history.replaceState({}, "", `/runs/${deepRunId}`);
    const ports = services();
    const user = userEvent.setup();
    render(<App services={asSurface(ports)} />);

    expect(screen.getByRole("heading", { name: /sign in to open run/i })).toBeVisible();
    const opener = screen.getByRole("button", { name: /^sign in with wallet$/i });
    expect(screen.getByRole("link", { name: /back to runs/i })).toHaveAttribute("href", "/runs");
    expect(window.location.pathname).toBe(`/runs/${deepRunId}`);
    expect(document.body).not.toHaveTextContent(/project token|connect project/i);
    expect(ports.hydrateRun).not.toHaveBeenCalled();
    await user.click(opener);

    expect(screen.getByRole("dialog", { name: /sign in with wallet/i })).toBeVisible();
    expect(ports.hydrateRun).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/runs/${deepRunId}`);
  });
});
