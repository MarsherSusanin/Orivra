import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { HydratedRunView, RunSurfaceServices } from "./services/run-surface";

const RUN_ID = "run_stage_content_routing";
const PROJECT_TOKEN = `project_${"d".repeat(64)}`;

const RUN: HydratedRunView = {
  runId: RUN_ID,
  title: "Open-Meteo template run",
  attestationType: "Web2Json",
  network: "coston2",
  startedAt: "2026-08-15T04:56:13.000Z",
  sequence: 9,
  terminal: false,
  submissionMode: "wallet",
  stages: {
    preflight: "completed",
    request: "completed",
    round: "completed",
    proof: "completed",
    verify: "completed",
    consumer: "active",
  },
  stageDetails: {
    preflight: { time: "14:56:13", duration: "—" },
    request: { time: "14:56:28", duration: "15s" },
    round: { time: "14:58:37", duration: "2m 9s" },
    proof: { time: "14:58:37", duration: "0s" },
    verify: { time: "14:58:37", duration: "0s" },
  },
  diagnostics: [],
  evidence: {
    transactionHash: `0x${"a".repeat(64)}`,
    votingRound: "1425302",
    fee: "0.000000 ETH",
    elapsed: "2m 24s",
    explorerUrl: `https://coston2-explorer.flare.network/tx/0x${"a".repeat(64)}`,
  },
};

function services(run: HydratedRunView = RUN): RunSurfaceServices {
  return {
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    hydrateRun: vi.fn().mockResolvedValue(run),
    resume: vi.fn().mockReturnValue(null),
  };
}

function renderStage(step?: string, run: HydratedRunView = RUN) {
  window.history.replaceState(
    {},
    "",
    `/runs/${RUN_ID}${step ? `?step=${step}` : ""}`,
  );
  return render(
    <App runId={RUN_ID} projectToken={PROJECT_TOKEN} services={services(run)} />,
  );
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Run Cockpit lifecycle content routing", () => {
  it.each([
    ["request", "Request was submitted.", /Wallet/, /0xaaaaaaaa/],
    ["round", "Voting round was finalized.", /1425302/, /Coston2/],
    ["proof", "Proof is available.", /Web2Json/, /Coston2/],
    ["verify", "Proof verification passed.", /Verified/, /14:58:37/],
    ["consumer", "Consumer is in progress.", /In progress/, /Persisting consumer evidence/],
  ])(
    "renders persisted %s content instead of the generic next action",
    async (step, heading, firstEvidence, secondEvidence) => {
      renderStage(step);

      const stageHeading = await screen.findByRole("heading", { name: heading });
      const panel = stageHeading.closest("section");
      expect(panel).not.toBeNull();
      expect(within(panel!).getAllByText(firstEvidence)[0]).toBeVisible();
      expect(within(panel!).getAllByText(secondEvidence)[0]).toBeVisible();
      expect(screen.getByRole("link", { name: new RegExp(`open ${step} stage`, "i") }))
        .toHaveAttribute("aria-current", "step");
      expect(screen.queryByRole("button", { name: /^verify consumer/i })).not.toBeInTheDocument();
    },
  );

  it("keeps the actionable Consumer Lab entry on the current active stage", async () => {
    renderStage();

    expect(await screen.findByRole("heading", { name: "Proof is ready." })).toBeVisible();
    expect(screen.getByRole("button", { name: /^verify consumer/i })).toBeEnabled();
  });

  it("keeps the verification action on the actual pending Verify stage", async () => {
    renderStage(undefined, {
      ...RUN,
      stages: { ...RUN.stages, verify: "pending", consumer: "pending" },
    });

    expect(await screen.findByRole("heading", { name: "Proof is ready." })).toBeVisible();
    expect(screen.getByRole("button", { name: /^verify consumer/i })).toBeEnabled();
  });
});
