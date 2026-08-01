import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { App } from "./App";
import {
  TEST_PROJECT_TOKEN,
  TEST_RUN_ID,
  withHydratedRun,
} from "./test/cockpit-fixture";

function services() {
  return withHydratedRun({
    verifyConsumer: vi.fn().mockResolvedValue({
      summary: "Consumer needs one fix",
      code: "EXPECTED_HOST_NOT_ENFORCED",
      checks: [
        { label: "Cryptographic proof", status: "passed" as const },
        { label: "Source host invariant", status: "failed" as const },
      ],
    }),
    generateConsumer: vi.fn().mockResolvedValue({
      source: "requireHost(requestUrl, EXPECTED_HOST);",
    }),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
  });
}

function renderCockpit() {
  return render(
    <App
      runId={TEST_RUN_ID}
      projectToken={TEST_PROJECT_TOKEN}
      services={services()}
    />,
  );
}

describe("Proofline Run Cockpit", () => {
  it("makes the active attestation state and next action obvious", async () => {
    renderCockpit();

    expect(await screen.findByRole("heading", { name: "ETH/USD snapshot" })).toBeVisible();
    expect(screen.getByText("Proof available")).toBeVisible();
    expect(screen.getByRole("button", { name: /verify consumer/i })).toBeEnabled();

    const timeline = screen.getByLabelText("Attestation lifecycle");
    for (const stage of ["Preflight", "Request", "Round", "Proof", "Verify", "Consumer"]) {
      expect(within(timeline).getByText(stage)).toBeVisible();
    }

    expect(screen.getByText("Missing consumer host invariant")).toBeVisible();
    expect(screen.getByText("High")).toBeVisible();
    expect(screen.getByText("0.012345 ETH")).toBeVisible();
  });

  it("reveals diagnostic evidence on demand", async () => {
    const user = userEvent.setup();
    renderCockpit();

    const details = await screen.findByRole("button", { name: /view details/i });
    expect(details).toHaveAttribute("aria-expanded", "false");

    await user.click(details);

    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CONSUMER_INVARIANT_MISSING")).toBeVisible();
    expect(screen.getByText(/proof request host is api\.example\.com/i)).toBeVisible();
  });

  it("runs consumer verification and turns the failure into a safe next step", async () => {
    const user = userEvent.setup();
    renderCockpit();

    await user.click(await screen.findByRole("button", { name: /verify consumer/i }));

    const lab = screen.getByRole("dialog", { name: "Consumer verification" });
    expect(within(lab).getByDisplayValue("0x71C4...9A2E")).toBeVisible();

    await user.click(within(lab).getByRole("button", { name: /run verification/i }));

    expect(await within(lab).findByText("Consumer needs one fix")).toBeVisible();
    expect(within(lab).getByText("EXPECTED_HOST_NOT_ENFORCED")).toBeVisible();

    await user.click(within(lab).getByRole("button", { name: /generate safe consumer/i }));

    expect(within(lab).getByText(/requireHost\(requestUrl, EXPECTED_HOST\)/i)).toBeVisible();
    expect(within(lab).getByText("Safe consumer generated")).toBeVisible();
  });
});
