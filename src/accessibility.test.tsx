import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

const services = {
  verifyConsumer: vi.fn().mockResolvedValue({
    summary: "Consumer needs one fix",
    code: "EXPECTED_HOST_NOT_ENFORCED",
    checks: [
      { label: "Cryptographic proof", status: "passed" as const },
      { label: "Source host invariant", status: "failed" as const },
    ],
  }),
  generateConsumer: vi.fn().mockResolvedValue({ source: "contract Safe {}" }),
  exportBundle: vi.fn().mockResolvedValue('{"version":"1"}'),
  replayBundle: vi.fn().mockResolvedValue({ byteIdentical: true }),
  resume: vi.fn().mockReturnValue(null),
};

async function seriousOrCriticalViolations(root: Element | Document) {
  const result = await axe.run(root, {
    rules: {
      "color-contrast": { enabled: false },
    },
  });
  return result.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
}

describe("Run Cockpit accessible DOM", () => {
  it("has no serious or critical axe violations in the primary cockpit", async () => {
    const { container } = render(
      <App
        projectToken={`project_${"a".repeat(64)}`}
        services={services}
      />,
    );
    expect(await seriousOrCriticalViolations(container)).toEqual([]);
  });

  it("has no serious or critical axe violations with Consumer Lab open", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <App
        projectToken={`project_${"a".repeat(64)}`}
        services={services}
      />,
    );
    await user.click(screen.getByRole("button", { name: /verify consumer/i }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(await seriousOrCriticalViolations(container)).toEqual([]);
  });
});
