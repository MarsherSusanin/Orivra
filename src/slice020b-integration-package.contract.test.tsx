import axe from "axe-core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeBundleInput, RUN_ID, validManifest } from "../packages/contracts/test/fixtures";
import {
  canonicalSerializeEvidenceReceipt,
  canonicalSerializeProofBundle,
  createEvidenceReceipt,
  createProofBundle,
  generateSafeWeb2JsonConsumer,
} from "../packages/domain/src";
import { App } from "./App";
import type { HydratedRunView, RunSurfaceServices } from "./services/run-surface";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const SHARE_LINK = {
  version: "1",
  runId: RUN_ID,
  url: `https://proofline.test/runs/${RUN_ID}#share=${SHARE_TOKEN}`,
} as const;
const consumerLabReport = {
  version: "1",
  runId: RUN_ID,
  statement: "Valid proof ≠ trusted URL",
  proofValid: true,
  consumerIdentity: "canonical-vulnerable",
  passed: false,
  checks: (["scheme", "host", "path", "query"] as const).map((invariant) => ({
    invariant,
    expected: `expected-${invariant}`,
    observed: `observed-${invariant}`,
    enforced: false,
    passed: false,
  })),
  diagnostics: [{
    version: "1",
    code: "MISSING_CONSUMER_HOST_INVARIANT",
    severity: "warning",
    confidence: "high",
    summary: "Missing URL checks",
    evidence: { missingChecks: ["scheme", "host", "path", "query"] },
    remediation: "Use the generated safe consumer.",
  }],
  safeConsumer: {
    identity: "canonical-safe",
    contractName: "ProoflineSafeWeb2JsonConsumer",
    compilerVersion: "solc-0.8.36",
    compileStatus: "passed",
    sha256: `sha256:${"a".repeat(64)}`,
    source: "contract ProoflineSafeWeb2JsonConsumer {}\n",
    diff: "--- canonical-vulnerable\n+++ ProoflineSafeWeb2JsonConsumer\n",
  },
  verdict: { state: "needs-fixes", missingChecks: 4 },
} as const;
const bundle = canonicalSerializeProofBundle(createProofBundle(makeBundleInput()));
const receipt = createEvidenceReceipt(bundle);
const receiptBytes = canonicalSerializeEvidenceReceipt(receipt);
const manifestBytes = JSON.stringify(validManifest);
const safeSource = generateSafeWeb2JsonConsumer(validManifest, {
  contractName: "ProoflineSafeWeb2JsonConsumer",
});
const safeReport = {
  ...consumerLabReport,
  runId: RUN_ID,
  consumerIdentity: "canonical-safe" as const,
  passed: true,
  checks: consumerLabReport.checks.map((check) => ({
    ...check,
    observed: check.expected,
    enforced: true,
    passed: true,
  })) as typeof consumerLabReport.checks,
  diagnostics: [],
  safeConsumer: {
    ...consumerLabReport.safeConsumer,
    source: safeSource,
    sha256: receipt.safeConsumerChecksum,
  },
  verdict: { state: "safe-to-integrate" as const, missingChecks: 0 },
};

const terminalRun = {
  runId: RUN_ID,
  title: "Evidence handoff",
  attestationType: "Web2Json",
  network: "coston2",
  sequence: 7,
  terminal: true,
  manifest: validManifest,
  stages: {
    preflight: "completed",
    request: "completed",
    round: "completed",
    proof: "completed",
    verify: "completed",
    consumer: "completed",
  },
  diagnostics: [],
  evidence: { votingRound: "42871" },
} as HydratedRunView;

function services(overrides: Record<string, unknown> = {}) {
  return {
    hydrateRun: vi.fn().mockResolvedValue(terminalRun),
    getEvidenceReceipt: vi.fn().mockResolvedValue(receipt),
    getConsumerLabReport: vi.fn().mockResolvedValue(safeReport),
    exportBundle: vi.fn().mockResolvedValue(bundle),
    createShare: vi.fn().mockResolvedValue(SHARE_LINK),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as RunSurfaceServices & Record<string, ReturnType<typeof vi.fn>>;
}

function decodedDownload(link: HTMLElement): string {
  const href = link.getAttribute("href") ?? "";
  expect(href).toMatch(/^data:/);
  return decodeURIComponent(href.slice(href.indexOf(",") + 1));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("Slice 020B Integration Package surface", () => {
  it("keeps share-reader cockpit export and replay mutations unavailable", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    const ports = services();
    const user = userEvent.setup();
    render(<App projectToken={SHARE_TOKEN} services={ports} />);

    const handoff = await screen.findByRole("button", {
      name: /open integration package/i,
    });
    expect(
      screen.queryByRole("button", { name: /export bundle/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /bundle verified/i }),
    ).not.toBeInTheDocument();
    expect(ports.exportBundle).not.toHaveBeenCalled();
    expect(ports.replayBundle).not.toHaveBeenCalled();

    await user.click(handoff);
    const dialog = await screen.findByRole("dialog", {
      name: /integration package/i,
    });
    expect(
      await within(dialog).findByRole("link", { name: /download bundle/i }),
    ).toBeVisible();
    expect(ports.exportBundle).toHaveBeenCalledOnce();
    expect(ports.replayBundle).not.toHaveBeenCalled();
  });

  it("replaces the completed journey with one dominant evidence handoff action", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    const user = userEvent.setup();
    render(<App projectToken={PROJECT_TOKEN} services={services()} />);

    const action = await screen.findByRole("button", { name: /open integration package/i });
    expect(screen.getAllByRole("button", { name: /open integration package/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^verify consumer$/i })).not.toBeInTheDocument();
    await user.click(action);
    const dialog = await screen.findByRole("dialog", { name: /integration package/i });
    expect(within(dialog).getByRole("button", { name: /close integration package/i })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /integration package/i })).not.toBeInTheDocument();
    expect(action).toHaveFocus();
  });

  it("downloads exact evidence bytes and emits repository-local integration instructions", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}?panel=integration`);
    render(<App projectToken={PROJECT_TOKEN} services={services()} />);
    const dialog = await screen.findByRole("dialog", { name: /integration package/i });

    const expected = [
      ["receipt", `${RUN_ID}.receipt.json`, receiptBytes],
      ["bundle", `${RUN_ID}.proofline.json`, bundle],
      ["manifest", `${RUN_ID}.manifest.json`, manifestBytes],
      ["Solidity", "ProoflineSafeWeb2JsonConsumer.sol", safeReport.safeConsumer.source],
    ] as const;
    for (const [label, filename, bytes] of expected) {
      const link = await within(dialog).findByRole("link", {
        name: new RegExp(`download ${label}`, "i"),
      });
      expect(link).toHaveAttribute("download", filename);
      expect(decodedDownload(link)).toBe(bytes);
    }

    expect(dialog).toHaveTextContent(
      `node packages/cli/dist/index.js replay ${RUN_ID}.proofline.json`,
    );
    expect(dialog).toHaveTextContent("uses: ./packages/action");
    expect(dialog).toHaveTextContent(`manifest: ${RUN_ID}.manifest.json`);
    expect(dialog).toHaveTextContent(`bundle: ${RUN_ID}.proofline.json`);
    expect(within(dialog).getByText(/next integration step/i)).toBeVisible();
    expect(within(dialog).getByText(/add the generated workflow to your repository/i)).toBeVisible();
    expect(dialog).not.toHaveTextContent(PROJECT_TOKEN);
  });

  it("uses one idempotent project action to create the fragment share link", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}?panel=integration`);
    const createShare = vi.fn().mockImplementation(
      () => new Promise((resolve) => globalThis.setTimeout(() => resolve(SHARE_LINK), 5)),
    );
    const ports = services({ createShare });
    const user = userEvent.setup();
    render(<App projectToken={PROJECT_TOKEN} services={ports} />);
    const dialog = await screen.findByRole("dialog", { name: /integration package/i });
    const share = await within(dialog).findByRole("button", { name: /create read-only share link/i });
    await user.dblClick(share);

    await waitFor(() => expect(createShare).toHaveBeenCalledOnce());
    expect(createShare).toHaveBeenCalledWith({
      runId: RUN_ID,
      projectToken: PROJECT_TOKEN,
      idempotencyKey: `share-${RUN_ID}`,
    });
    expect(await within(dialog).findByRole("link", { name: /open read-only share/i })).toHaveAttribute(
      "href",
      SHARE_LINK.url,
    );
  });

  it("restores panel=integration and gives share readers no mutation controls", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}?panel=integration`);
    const ports = services();
    render(<App projectToken={SHARE_TOKEN} services={ports} />);
    const dialog = await screen.findByRole("dialog", { name: /integration package/i });

    expect(within(dialog).queryByRole("button", { name: /create.*share/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /verify|generate|replay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^verify consumer$/i })).not.toBeInTheDocument();
    expect(ports.createShare).not.toHaveBeenCalled();
    expect(ports.replayBundle).not.toHaveBeenCalled();
    expect(ports.verifyConsumer).not.toHaveBeenCalled();
    expect(ports.generateConsumer).not.toHaveBeenCalled();

    window.history.replaceState({}, "", `/runs/${RUN_ID}`);
    fireEvent(window, new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /integration package/i })).not.toBeInTheDocument(),
    );
    window.history.replaceState({}, "", `/runs/${RUN_ID}?panel=integration`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(await screen.findByRole("dialog", { name: /integration package/i })).toBeVisible();
  });

  it.each([
    {
      name: "the Consumer Lab pass verdict",
      report: { ...safeReport, passed: false },
    },
    {
      name: "the canonical diagnostic code set",
      report: {
        ...safeReport,
        diagnostics: [{
          ...consumerLabReport.diagnostics[0],
          code: "MISSING_CONSUMER_PATH_INVARIANT",
        }],
      },
    },
  ])("fails closed when $name disagrees with the receipt", async ({ report }) => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}?panel=integration`);
    render(
      <App
        projectToken={PROJECT_TOKEN}
        services={services({
          getConsumerLabReport: vi.fn().mockResolvedValue(report),
        })}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: /integration package/i,
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /integration package unavailable|does not agree/i,
    );
    expect(
      within(dialog).queryByRole("link", { name: /download bundle/i }),
    ).not.toBeInTheDocument();
  });

  it("has no serious or critical accessibility violations in the completed handoff", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}?panel=integration`);
    const { container } = render(
      <App projectToken={PROJECT_TOKEN} services={services()} />,
    );
    const dialog = await screen.findByRole("dialog", { name: /integration package/i });
    await within(dialog).findByRole("link", { name: /download receipt/i });

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });
});
