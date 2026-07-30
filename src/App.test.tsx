import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("Proofline Run Cockpit", () => {
  it("makes the active attestation state and next action obvious", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "ETH/USD snapshot" })).toBeVisible();
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
    render(<App />);

    const details = screen.getByRole("button", { name: /view details/i });
    expect(details).toHaveAttribute("aria-expanded", "false");

    await user.click(details);

    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CONSUMER_INVARIANT_MISSING")).toBeVisible();
    expect(screen.getByText(/proof request host is api\.example\.com/i)).toBeVisible();
  });

  it("runs consumer verification and turns the failure into a safe next step", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /verify consumer/i }));

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
