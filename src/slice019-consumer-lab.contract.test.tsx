import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { consumerLabReport } from "../packages/contracts/test/slice019-consumer-lab.contract.test";
import { VerificationDialog } from "./components/VerificationDialog";

describe("Slice 019 Consumer Lab surface", () => {
  it("shows four persisted invariants and exact safe artifact without an address", async () => {
    const user = userEvent.setup();
    const services = {
      verifyConsumer: vi.fn().mockResolvedValue({ summary: "Consumer needs 4 fixes", code: "MISSING_CONSUMER_HOST_INVARIANT", checks: [{ label: "Source host invariant", status: "failed" }] }),
      generateConsumer: vi.fn().mockResolvedValue({ source: consumerLabReport.safeConsumer.source }),
      getConsumerLabReport: vi.fn().mockResolvedValue(consumerLabReport),
      exportBundle: vi.fn(), replayBundle: vi.fn(),
    };
    render(<VerificationDialog context={{ runId: consumerLabReport.runId, projectToken: `project_${"a".repeat(64)}` }} services={services} onClose={vi.fn()} />);
    expect(document.body).not.toHaveTextContent("0x71C4");
    await user.click(screen.getByRole("button", { name: /run verification/i }));
    await user.click(await screen.findByRole("button", { name: /generate safe consumer/i }));
    expect(await screen.findByText("Valid proof ≠ trusted URL")).toBeVisible();
    expect(within(screen.getByRole("list", { name: /consumer url invariant/i })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Still missing 4 checks")).toBeVisible();
    const download = screen.getByRole("link", { name: /download .sol/i });
    expect(download).toHaveAttribute("download", "ProoflineSafeWeb2JsonConsumer.sol");
    expect(decodeURIComponent(download.getAttribute("href") ?? "")).toContain(consumerLabReport.safeConsumer.source);
    await waitFor(() => expect(services.getConsumerLabReport).toHaveBeenCalledOnce());
  });

  it("uses a singular verdict when exactly one invariant fails", async () => {
    const user = userEvent.setup();
    const checks = consumerLabReport.checks.map((check) => ({
      ...check,
      enforced: true,
      passed: check.invariant !== "host",
    })) as unknown as typeof consumerLabReport.checks;
    const report = {
      ...consumerLabReport,
      consumerIdentity: "canonical-safe" as const,
      checks,
      diagnostics: [],
      verdict: { state: "needs-fixes" as const, missingChecks: 1 },
    };
    const services = {
      verifyConsumer: vi.fn().mockResolvedValue({ summary: "Consumer needs 1 fix", code: "CONSUMER_HOST_MISMATCH", checks: [] }),
      generateConsumer: vi.fn().mockResolvedValue({ source: report.safeConsumer.source }),
      getConsumerLabReport: vi.fn().mockResolvedValue(report),
      exportBundle: vi.fn(), replayBundle: vi.fn(),
    };
    render(<VerificationDialog context={{ runId: report.runId, projectToken: `project_${"a".repeat(64)}` }} services={services} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /run verification/i }));
    await user.click(await screen.findByRole("button", { name: /generate safe consumer/i }));
    expect(await screen.findByText("Still missing 1 check")).toBeVisible();
    expect(screen.queryByText("Still missing 1 checks")).not.toBeInTheDocument();
  });
});
