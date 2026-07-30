import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { App } from "./App";

function renderWithServices(overrides: Record<string, unknown> = {}) {
  const services = {
    verifyConsumer: vi.fn().mockResolvedValue({
      summary: "Consumer needs one fix",
      code: "EXPECTED_HOST_NOT_ENFORCED",
      checks: [
        { label: "Cryptographic proof", status: "passed" },
        { label: "Source host invariant", status: "failed" },
      ],
    }),
    generateConsumer: vi.fn().mockResolvedValue({
      source: "requireHost(requestUrl, EXPECTED_HOST);",
      sha256: "a".repeat(64),
    }),
    exportBundle: vi.fn().mockResolvedValue(
      JSON.stringify({ version: "1", checksum: `sha256:${"b".repeat(64)}` }),
    ),
    replayBundle: vi.fn().mockResolvedValue({ byteIdentical: true }),
    ...overrides,
  };
  render(
    createElement(App as unknown as React.ComponentType<Record<string, unknown>>, {
      runId: "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
      projectToken: "project_" + "a".repeat(64),
      services,
    }),
  );
  return services;
}

describe("Run Cockpit live surface contract", () => {
  it("calls evidence-backed verification and safe codegen instead of the simulator", async () => {
    const user = userEvent.setup();
    const services = renderWithServices();

    await user.click(screen.getByRole("button", { name: /verify consumer/i }));
    const dialog = screen.getByRole("dialog", { name: "Consumer verification" });
    await user.click(within(dialog).getByRole("button", { name: /run verification/i }));

    expect(await within(dialog).findByText("Consumer needs one fix")).toBeVisible();
    expect(services.verifyConsumer).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
        projectToken: expect.stringMatching(/^project_/),
      }),
    );

    await user.click(within(dialog).getByRole("button", { name: /generate safe consumer/i }));
    expect(await within(dialog).findByText("Safe consumer generated")).toBeVisible();
    expect(services.generateConsumer).toHaveBeenCalledOnce();
  });

  it("moves focus into the modal, traps Tab, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    renderWithServices();
    const trigger = screen.getByRole("button", { name: /verify consumer/i });
    trigger.focus();
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Consumer verification" });
    const close = within(dialog).getByRole("button", {
      name: /close consumer verification/i,
    });
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(
      within(dialog).getByRole("button", { name: /run verification/i }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows an actionable retry without losing the run when verification transport fails", async () => {
    const user = userEvent.setup();
    const verifyConsumer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Coston2 RPC timeout"))
      .mockResolvedValueOnce({
        summary: "Consumer needs one fix",
        code: "EXPECTED_HOST_NOT_ENFORCED",
        checks: [],
      });
    renderWithServices({ verifyConsumer });

    await user.click(screen.getByRole("button", { name: /verify consumer/i }));
    const dialog = screen.getByRole("dialog", { name: "Consumer verification" });
    await user.click(within(dialog).getByRole("button", { name: /run verification/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/timeout/i);
    await user.click(within(dialog).getByRole("button", { name: /retry verification/i }));
    expect(await within(dialog).findByText("Consumer needs one fix")).toBeVisible();
    expect(verifyConsumer).toHaveBeenCalledTimes(2);
  });

  it("exports and reparses a checksummed bundle before enabling download", async () => {
    const user = userEvent.setup();
    const services = renderWithServices();

    await user.click(screen.getByRole("button", { name: /export bundle/i }));
    expect(services.exportBundle).toHaveBeenCalledOnce();
    expect(services.replayBundle).toHaveBeenCalledWith(
      expect.stringContaining("sha256:"),
    );
    expect(await screen.findByText(/bundle verified/i)).toBeVisible();
  });
});
