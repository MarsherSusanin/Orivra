import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { TEST_RUN_ID, withHydratedRun } from "./test/cockpit-fixture";

function services() {
  return {
    verifyConsumer: vi.fn().mockResolvedValue({
      summary: "Consumer needs one fix",
      code: "EXPECTED_HOST_NOT_ENFORCED",
      checks: [
        { label: "Cryptographic proof", status: "passed" as const },
        { label: "Source host invariant", status: "failed" as const },
      ],
    }),
    generateConsumer: vi.fn().mockResolvedValue({
      source: "contract ProoflineSafeWeb2JsonConsumer {}",
      sha256: "a".repeat(64),
    }),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
  };
}

async function generateSafeConsumer() {
  const user = userEvent.setup();
  render(
    <App
      runId={TEST_RUN_ID}
      projectToken={`project_${"a".repeat(64)}`}
      services={withHydratedRun(services())}
    />,
  );
  const trigger = await screen.findByRole("button", { name: /verify consumer/i });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: /consumer verification/i });
  await user.click(
    within(dialog).getByRole("button", { name: /run verification/i }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: /generate safe consumer/i,
    }),
  );
  expect(await within(dialog).findByText(/safe consumer generated/i)).toBeVisible();
  return { user, trigger, dialog };
}

describe("Slice 007 Consumer Lab focus ownership after codegen", () => {
  it("retains a focused interactive control inside the dialog", async () => {
    const { dialog } = await generateSafeConsumer();
    const active = document.activeElement as HTMLElement | null;

    expect(active).not.toBeNull();
    expect(dialog).toContainElement(active);
    expect(
      active?.matches(
        "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ).toBe(true);
  });

  it("closes from generated state with Escape and restores the current trigger", async () => {
    const { user, trigger } = await generateSafeConsumer();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
