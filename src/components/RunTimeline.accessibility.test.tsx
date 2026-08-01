import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TEST_RUN_STAGES } from "../test/cockpit-fixture";
import { RunTimeline } from "./RunTimeline";

function renderTimelineScroller() {
  const { container } = render(<RunTimeline stages={TEST_RUN_STAGES} />);
  const scroller = container.querySelector<HTMLElement>(".timeline-scroller");

  expect(scroller).not.toBeNull();
  return scroller!;
}

describe("RunTimeline horizontal scroller accessibility", () => {
  it("gives the scrollable lifecycle a useful accessible name", () => {
    const scroller = renderTimelineScroller();

    expect(scroller).toHaveAccessibleName("Attestation lifecycle timeline");
  });

  it("puts the scrollable lifecycle in the keyboard tab order", async () => {
    const user = userEvent.setup();
    const scroller = renderTimelineScroller();

    expect(scroller).toHaveAttribute("tabindex", "0");
    await user.tab();
    expect(scroller).toHaveFocus();
  });
});
