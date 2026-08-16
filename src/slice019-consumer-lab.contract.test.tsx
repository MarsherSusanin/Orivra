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

  it("keeps generated Solidity and retries only the persisted report", async () => {
    const user = userEvent.setup();
    const sourceDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(consumerLabReport.safeConsumer.source),
    );
    const sourceSha256 = [...new Uint8Array(sourceDigest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const persistedReport = {
      ...consumerLabReport,
      safeConsumer: {
        ...consumerLabReport.safeConsumer,
        sha256: `sha256:${sourceSha256}`,
      },
    };
    const generateConsumer = vi.fn().mockResolvedValue({
      source: persistedReport.safeConsumer.source,
    });
    const getConsumerLabReport = vi.fn()
      .mockRejectedValueOnce(new Error("Orivra API 500: Request could not be completed"))
      .mockResolvedValueOnce(persistedReport);
    const onOpenIntegration = vi.fn();
    const services = {
      verifyConsumer: vi.fn().mockResolvedValue({
        summary: "Consumer needs 4 fixes",
        code: "MISSING_CONSUMER_HOST_INVARIANT",
        checks: [{ label: "Source host invariant", status: "failed" }],
      }),
      generateConsumer,
      getConsumerLabReport,
      exportBundle: vi.fn(),
      replayBundle: vi.fn(),
    };

    render(
      <VerificationDialog
        context={{ runId: consumerLabReport.runId, projectToken: `project_${"a".repeat(64)}` }}
        services={services}
        onClose={vi.fn()}
        onOpenIntegration={onOpenIntegration}
      />,
    );
    await user.click(screen.getByRole("button", { name: /run verification/i }));
    await user.click(await screen.findByRole("button", { name: /generate safe consumer/i }));

    expect(await screen.findByText("Safe consumer generated")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Consumer Lab report unavailable");
    expect(screen.getByRole("button", { name: /retry report/i })).toBeVisible();
    expect(screen.queryByText(/Orivra API 500/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry report/i }));
    expect(await screen.findByText("Tested consumer: needs fixes")).toBeVisible();
    expect(screen.getByText("Generated replacement: compiled")).toBeVisible();
    expect(generateConsumer).toHaveBeenCalledOnce();
    expect(getConsumerLabReport).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /verify generated consumer/i }));
    expect(await screen.findByText("Generated replacement: verified")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /open integration package/i }));
    expect(onOpenIntegration).toHaveBeenCalledOnce();
  });

  it.each([
    ["verified", "Deployed consumer verified"],
    ["mismatched", "Deployed bytecode mismatched"],
    ["unavailable", "Deployed code unavailable"],
    ["proxy-unsupported", "Proxy verification unsupported"],
  ] as const)("renders the honest %s deployed-bytecode result without a wallet effect", async (status, label) => {
    const user = userEvent.setup();
    const address = "0x1111111111111111111111111111111111111111";
    const digest = `sha256:${"a".repeat(64)}`;
    const evidence = {
      version: "1" as const,
      runId: consumerLabReport.runId,
      commandId: `verify-${status}`,
      chainId: 114 as const,
      address,
      status,
      observedAt: "2026-08-16T00:00:00.000Z",
      blockNumber: "1426000",
      registryAddress: "0x2222222222222222222222222222222222222222",
      codeSizeBytes: status === "unavailable" ? 0 : 5,
      observedRuntimeBytecodeSha256: status === "unavailable" ? null : digest,
      expectedRuntimeBytecodeSha256: digest,
      sourceSha256: `sha256:${"b".repeat(64)}`,
      compilerVersion: "solc-0.8.36" as const,
      diagnostics: status === "verified" ? [] : [{
        version: "1" as const,
        code: "DEPLOYED_CONSUMER_NOT_VERIFIED",
        severity: "warning" as const,
        confidence: "high" as const,
        summary: "The observed deployment does not match the canonical runtime.",
        evidence: {},
        remediation: "Review the deployment before integration.",
      }],
    };
    const verifyDeployedConsumer = vi.fn().mockResolvedValue(evidence);
    const services = {
      verifyConsumer: vi.fn(),
      generateConsumer: vi.fn(),
      getConsumerLabReport: vi.fn().mockResolvedValue(consumerLabReport),
      verifyDeployedConsumer,
      exportBundle: vi.fn(),
      replayBundle: vi.fn(),
    };

    render(
      <VerificationDialog
        context={{ runId: consumerLabReport.runId, projectToken: `project_${"a".repeat(64)}` }}
        services={services}
        onClose={vi.fn()}
        resumePersisted
      />,
    );

    const input = await screen.findByRole("textbox", { name: /contract address/i });
    expect(screen.getByText(/read-only bytecode verification at chain 114/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /verify deployed bytecode/i })).toBeDisabled();
    await user.type(input, address);
    await user.click(screen.getByRole("button", { name: /verify deployed bytecode/i }));

    expect(await screen.findByText(label)).toBeVisible();
    expect(verifyDeployedConsumer).toHaveBeenCalledWith(expect.objectContaining({ address }));
    expect(document.body).not.toHaveTextContent(/connect wallet|sign transaction|rpc url/i);
  });
});
