import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductEventV1, PreflightReportV1 } from "../packages/contracts/src";
import {
  blockedPreflightReport,
  RUN_ID,
  validPreflightReport,
} from "../packages/contracts/test/fixtures";
import { App } from "./App";
import type {
  HydratedRunView,
  RunSurfaceServices,
  SubmissionModeView,
} from "./services/run-surface";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const FDC_HUB = validPreflightReport.registrySnapshot.resolvedContracts.FdcHub;

function run(mode: SubmissionModeView, input: {
  terminal?: boolean;
  preflight?: HydratedRunView["stages"]["preflight"];
  request?: HydratedRunView["stages"]["request"];
  evidence?: HydratedRunView["evidence"];
} = {}): HydratedRunView {
  return {
    runId: RUN_ID,
    title: "ETH/USD persisted request",
    attestationType: "Web2Json",
    network: "coston2",
    startedAt: "2026-08-02T01:00:00.000Z",
    sequence: 2,
    terminal: input.terminal ?? false,
    submissionMode: mode,
    stages: {
      preflight: input.preflight ?? "completed",
      request: input.request ?? "pending",
      round: "pending",
      proof: "pending",
      verify: "pending",
      consumer: "pending",
    },
    diagnostics: [],
    evidence: input.evidence ?? {},
  };
}

type ConfirmSubmission = (context: {
  runId: string;
  projectToken: string;
  mode: SubmissionModeView;
  idempotencyKey: string;
}) => Promise<Record<string, unknown>>;

type SubmissionSurface = RunSurfaceServices & {
  confirmSubmission: ReturnType<typeof vi.fn>;
};

function services(input: {
  mode?: SubmissionModeView;
  report?: PreflightReportV1;
  terminal?: boolean;
  preflight?: HydratedRunView["stages"]["preflight"];
  request?: HydratedRunView["stages"]["request"];
  evidence?: HydratedRunView["evidence"];
  confirmSubmission?: ReturnType<typeof vi.fn>;
} = {}): SubmissionSurface {
  const mode = input.mode ?? "replay";
  return {
    hydrateRun: vi.fn().mockResolvedValue(run(mode, input)),
    getPreflightReport: vi.fn().mockResolvedValue(
      structuredClone(input.report ?? validPreflightReport),
    ),
    confirmSubmission:
      input.confirmSubmission ??
      vi.fn<ConfirmSubmission>().mockResolvedValue({
        version: "1",
        runId: RUN_ID,
        mode,
        effectOwner: mode === "wallet" ? "wallet" : mode === "relayer" ? "worker" : "none",
        ...(mode === "wallet"
          ? {
              transaction: {
                chainId: "0x72",
                to: FDC_HUB,
                data: "0xfeedcafe",
                value: "0x3039",
              },
            }
          : { commandId: `command_${mode}` }),
      }),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
  } as unknown as SubmissionSurface;
}

function analytics() {
  const events: ProductEventV1[] = [];
  return {
    events,
    port: { emit: vi.fn((event: ProductEventV1) => events.push(event)) },
  };
}

async function renderDecision(input: {
  mode?: SubmissionModeView;
  report?: PreflightReportV1;
  terminal?: boolean;
  preflight?: HydratedRunView["stages"]["preflight"];
  token?: string;
  surface?: SubmissionSurface;
  events?: ReturnType<typeof analytics>;
} = {}) {
  window.history.replaceState(
    {},
    "",
    `/runs/${RUN_ID}?step=submission&status=active&panel=diagnostics#submission`,
  );
  const surface = input.surface ?? services(input);
  render(
    <App
      runId={RUN_ID}
      projectToken={input.token ?? PROJECT_TOKEN}
      services={surface}
      analytics={input.events?.port}
    />,
  );
  await screen.findByRole("heading", { name: "ETH/USD persisted request" });
  return surface;
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "ethereum");
});

describe("Slice 017 immutable submission decision evidence", () => {
  it.each([
    ["wallet", /connected wallet/i, /wallet pays/i, /broadcasts.*Coston2/i, /never receives.*key/i],
    ["relayer", /Proofline relayer/i, /relayer pays/i, /worker broadcasts.*Coston2/i, /project authorization.*policy/i],
    ["replay", /no signer/i, /no payer/i, /no network effect/i, /recorded evidence/i],
  ] as const)(
    "explains signer, payer, network effect and trust model for %s",
    async (mode, signer, payer, effect, trust) => {
      const surface = await renderDecision({ mode });
      const decision = await screen.findByRole("region", { name: /submission decision/i });
      expect(decision).toHaveTextContent(new RegExp(mode, "i"));
      expect(decision).toHaveTextContent(signer);
      expect(decision).toHaveTextContent(payer);
      expect(decision).toHaveTextContent(effect);
      expect(decision).toHaveTextContent(trust);
      expect(decision).toHaveTextContent(/Coston2/i);
      expect(decision).toHaveTextContent(/chain\s*114/i);
      expect(decision).toHaveTextContent(FDC_HUB);
      expect(decision).toHaveTextContent(validPreflightReport.requestIdentitySha256);
      expect(decision).toHaveTextContent(validPreflightReport.fee.quotedWei);
      expect(decision).toHaveTextContent(validPreflightReport.fee.capWei);
      expect(within(decision).queryByRole("combobox")).not.toBeInTheDocument();
      expect(within(decision).queryByRole("radio")).not.toBeInTheDocument();
      expect(within(decision).getByRole("link", { name: /change mode.*new run/i }))
        .toHaveAttribute("href", expect.stringMatching(/^\/runs\/new/));
      expect(surface.confirmSubmission).not.toHaveBeenCalled();
    },
  );

  it("loads persisted decision evidence directly on reload and keeps URL state", async () => {
    const surface = await renderDecision({ mode: "replay" });
    expect(await screen.findByRole("region", { name: /submission decision/i })).toBeVisible();
    expect(surface.getPreflightReport).toHaveBeenCalledOnce();
    const url = new URL(window.location.href);
    expect(url.searchParams.get("step")).toBe("submission");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("panel")).toBe("diagnostics");
    expect(url.hash).toBe("#submission");
  });
});

describe("Slice 017 confirmation policy and analytics", () => {
  it("creates no submission effect or analytics event from hydration, report load or render", async () => {
    const surface = services({ mode: "relayer" });
    const events = analytics();
    await renderDecision({ surface, events });
    expect(surface.confirmSubmission).not.toHaveBeenCalled();
    expect(events.events.filter((event) => event.name === "SUBMISSION_REQUESTED"))
      .toHaveLength(0);
  });

  it("hydrates a persisted wallet submission as submitted and never offers rebroadcast on reload", async () => {
    const transactionHash = `0x${"9".repeat(64)}`;
    const walletRequest = vi.fn();
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: { request: walletRequest },
    });
    const surface = services({
      mode: "wallet",
      request: "completed",
      evidence: { transactionHash },
    });

    await renderDecision({ surface });
    expect(
      screen.getByRole("img", { name: /request: submitted/i }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: /run evidence/i })).getByText(
        "0x999999…99999999",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
    expect(surface.confirmSubmission).not.toHaveBeenCalled();
    expect(walletRequest).not.toHaveBeenCalled();

    cleanup();
    await renderDecision({ surface });
    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
    expect(surface.hydrateRun).toHaveBeenCalledTimes(2);
    expect(surface.confirmSubmission).not.toHaveBeenCalled();
    expect(walletRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["share", { token: SHARE_TOKEN }],
    ["blocked", { report: structuredClone(blockedPreflightReport) as unknown as PreflightReportV1, preflight: "failed" as const, terminal: true }],
    ["terminal", { terminal: true }],
  ] as const)("does not expose confirmation for %s access/state", async (_label, input) => {
    const surface = await renderDecision({ mode: "replay", ...input });
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(surface.confirmSubmission).not.toHaveBeenCalled();
  });

  it("deduplicates double click and emits SUBMISSION_REQUESTED once from explicit confirmation", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    const pending = new Promise<Record<string, unknown>>((done) => { resolve = done; });
    const confirmSubmission = vi.fn<ConfirmSubmission>().mockReturnValue(pending);
    const surface = services({ mode: "replay", confirmSubmission });
    const events = analytics();
    const user = userEvent.setup();
    await renderDecision({ surface, events });

    const action = await screen.findByRole("button", { name: /confirm.*replay/i });
    await user.dblClick(action);
    expect(confirmSubmission).toHaveBeenCalledOnce();
    expect(confirmSubmission).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      projectToken: PROJECT_TOKEN,
      mode: "replay",
      idempotencyKey: expect.any(String),
    }));
    expect(events.events.filter((event) => event.name === "SUBMISSION_REQUESTED"))
      .toEqual([expect.objectContaining({ metadata: { mode: "replay" } })]);

    await act(async () => resolve({
      version: "1",
      runId: RUN_ID,
      mode: "replay",
      effectOwner: "none",
      commandId: "command_replay",
    }));
    expect(confirmSubmission).toHaveBeenCalledOnce();
  });

  it("shows one safe retryable error without leaking bearer, tx hash or stack", async () => {
    const secretHash = `0x${"d".repeat(64)}`;
    const confirmSubmission = vi.fn<ConfirmSubmission>().mockRejectedValue(
      Object.assign(
        new Error(`Bearer ${PROJECT_TOKEN} failed for ${secretHash}\n at unsafe-stack`),
        { status: 503, code: "TRANSPORT_UNAVAILABLE" },
      ),
    );
    const surface = services({ mode: "replay", confirmSubmission });
    const user = userEvent.setup();
    await renderDecision({ surface });
    await user.click(await screen.findByRole("button", { name: /confirm.*replay/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/temporarily unavailable|try again/i);
    expect(alert.textContent).not.toContain(PROJECT_TOKEN);
    expect(alert.textContent).not.toContain(secretHash);
    expect(alert.textContent).not.toMatch(/unsafe-stack|\bat\s/i);
    expect(screen.getByRole("button", { name: /confirm.*replay|try again/i })).toBeEnabled();
  });

  it("restores submission with Back/Forward and never confirms during render or navigation", async () => {
    const surface = await renderDecision({ mode: "relayer" });
    expect(await screen.findByRole("region", { name: /submission decision/i })).toBeVisible();
    const back = screen.getByRole("button", { name: /review preflight evidence/i });
    fireEvent.click(back);
    expect(new URL(window.location.href).searchParams.get("step")).toBe("preflight");
    expect(await screen.findByRole("region", { name: /preflight workbench/i })).toBeVisible();

    window.history.forward();
    fireEvent(window, new PopStateEvent("popstate"));
    window.history.replaceState(
      {},
      "",
      `/runs/${RUN_ID}?step=submission&status=active&panel=diagnostics#submission`,
    );
    fireEvent(window, new PopStateEvent("popstate"));
    expect(await screen.findByRole("region", { name: /submission decision/i })).toBeVisible();
    expect(surface.confirmSubmission).not.toHaveBeenCalled();
  });
});
