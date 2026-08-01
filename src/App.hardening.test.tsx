import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { EvidenceStrip } from "./components/EvidenceStrip";
import { RunTimeline } from "./components/RunTimeline";
import { evidenceItems, initialRunStages } from "./data/run";
import {
  TEST_HYDRATED_RUN,
  TEST_RUN_ID,
} from "./test/cockpit-fixture";

const projectToken = `project_${"a".repeat(64)}`;

function services(overrides: Record<string, unknown> = {}) {
  return {
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
    exportBundle: vi.fn().mockResolvedValue('{"version":"1"}'),
    replayBundle: vi.fn().mockResolvedValue({ byteIdentical: true }),
    hydrateRun: vi.fn().mockResolvedValue(TEST_HYDRATED_RUN),
    resume: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("Run Cockpit bundle and session hardening", () => {
  it("rejects a non-byte-identical replay instead of offering a download", async () => {
    const user = userEvent.setup();
    render(
      <App
        runId={TEST_RUN_ID}
        projectToken={projectToken}
        services={services({
          replayBundle: vi.fn().mockResolvedValue({ byteIdentical: false }),
        })}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /export bundle/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/bytes differ/i);
    expect(screen.queryByText(/bundle verified/i)).not.toBeInTheDocument();
  });

  it("redacts opaque tokens from bundle errors", async () => {
    const user = userEvent.setup();
    render(
      <App
        runId={TEST_RUN_ID}
        projectToken={projectToken}
        services={services({
          exportBundle: vi
            .fn()
            .mockRejectedValue(new Error(`Bearer ${projectToken} rejected`)),
        })}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /export bundle/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent(projectToken);
    expect(alert).toHaveTextContent(/\[REDACTED\]/);
  });

  it("uses the session-scoped project token and resumed run without persisting it", async () => {
    sessionStorage.setItem("proofline:project-token", projectToken);
    const ports = services({
      resume: vi.fn().mockReturnValue({ runId: "run_resumed", after: 8 }),
    });
    const user = userEvent.setup();
    render(<App runId="run_resumed" services={ports} />);

    await user.click(await screen.findByRole("button", { name: /export bundle/i }));
    expect(ports.exportBundle).toHaveBeenCalledWith({
      runId: "run_resumed",
      projectToken,
    });
    expect(sessionStorage.getItem("proofline:project-token")).toBe(projectToken);
    expect(localStorage.getItem("proofline:project-token")).toBeNull();
  });

  it("continues rendering when sessionStorage access is denied", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage denied");
      });
    expect(() => render(
      <App
        runId={TEST_RUN_ID}
        projectToken={projectToken}
        services={services()}
      />,
    )).not.toThrow();
    expect(await screen.findByRole("heading", { name: "ETH/USD snapshot" })).toBeVisible();
    getItem.mockRestore();
  });
});

describe("Consumer Lab error and focus boundaries", () => {
  it("keeps generation retryable and redacts service credentials", async () => {
    const user = userEvent.setup();
    const generateConsumer = vi
      .fn()
      .mockRejectedValueOnce(new Error(`Bearer ${projectToken} compiler failed`))
      .mockResolvedValueOnce({ source: "contract Safe {}" });
    render(
      <App
        runId={TEST_RUN_ID}
        projectToken={projectToken}
        services={services({ generateConsumer })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /verify consumer/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /run verification/i }));
    await within(dialog).findByText("Consumer needs one fix");
    await user.click(
      within(dialog).getByRole("button", { name: /generate safe consumer/i }),
    );

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/compiler failed/i);
    expect(alert).not.toHaveTextContent(projectToken);
    await user.click(
      within(dialog).getByRole("button", { name: /generate safe consumer/i }),
    );
    expect(await within(dialog).findByText(/safe consumer generated/i)).toBeVisible();
    expect(generateConsumer).toHaveBeenCalledTimes(2);
  });

  it("uses a safe fallback message for non-Error verification failures", async () => {
    const user = userEvent.setup();
    render(
      <App
        runId={TEST_RUN_ID}
        projectToken={projectToken}
        services={services({
          verifyConsumer: vi.fn().mockRejectedValue("upstream rejected"),
        })}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /verify consumer/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /run verification/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /consumer verification failed/i,
    );
  });

  it("wraps forward Tab from the last action to the close control", async () => {
    const user = userEvent.setup();
    render(<App runId={TEST_RUN_ID} projectToken={projectToken} services={services()} />);
    await user.click(await screen.findByRole("button", { name: /verify consumer/i }));
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", {
      name: /close consumer verification/i,
    });
    const run = within(dialog).getByRole("button", { name: /run verification/i });
    run.focus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("restores focus when the explicit close control is clicked", async () => {
    const user = userEvent.setup();
    render(<App runId={TEST_RUN_ID} projectToken={projectToken} services={services()} />);
    const trigger = await screen.findByRole("button", { name: /verify consumer/i });
    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /close consumer verification/i,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("cockpit evidence and timeline interactions", () => {
  it("copies the full transaction hash and exposes transient confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<EvidenceStrip items={evidenceItems} />);
    await user.click(screen.getByRole("button", { name: /copy transaction hash/i }));
    expect(writeText).toHaveBeenCalledWith(
      "0x9f3e0000000000000000000000007ab2c1d4",
    );
    expect(
      screen.getByRole("button", { name: /copy transaction hash/i }).querySelector("svg"),
    ).toBeTruthy();
  });

  it("scrolls the lifecycle to the active proof on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
    });
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      value: scrollTo,
      configurable: true,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(
      <RunTimeline
        stages={[
          ...initialRunStages.slice(0, -1),
          {
            key: "consumer",
            label: "Consumer",
            state: "failed",
            status: "Failed",
            time: "12:06:11",
            duration: "3s",
          },
        ]}
      />,
    );
    expect(scrollTo).toHaveBeenCalledWith({ left: 220, behavior: "auto" });
    expect(
      screen.getByLabelText("Consumer: Failed"),
    ).toBeVisible();
  });
});
