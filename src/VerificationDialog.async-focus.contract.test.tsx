import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { TEST_RUN_ID, withHydratedRun } from "./test/cockpit-fixture";

function resolvedServices() {
  return {
    verifyConsumer: vi.fn().mockResolvedValue({
      summary: "Consumer needs one fix",
      code: "EXPECTED_HOST_NOT_ENFORCED",
      checks: [
        { label: "Cryptographic proof", status: "passed" },
        { label: "Source host invariant", status: "failed" },
      ],
    }),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
  };
}

async function openCompletedVerification() {
  const user = userEvent.setup();
  render(
    <App
      runId={TEST_RUN_ID}
      projectToken={`project_${"a".repeat(64)}`}
      services={withHydratedRun(resolvedServices())}
    />,
  );
  const trigger = await screen.findByRole("button", { name: /verify consumer/i });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "Consumer verification",
  });
  await user.click(
    within(dialog).getByRole("button", { name: /run verification/i }),
  );
  const resultAction = await within(dialog).findByRole("button", {
    name: /generate safe consumer/i,
  });
  return { user, trigger, dialog, resultAction };
}

describe("VerificationDialog async focus ownership", () => {
  it("moves focus to the meaningful result action after verification resolves", async () => {
    const { resultAction } = await openCompletedVerification();

    expect(resultAction).toHaveFocus();
  });

  it("closes an async result with Escape and restores the opening trigger", async () => {
    const { user, trigger } = await openCompletedVerification();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
