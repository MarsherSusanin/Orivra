import React, { type ComponentType } from "react";
import axe from "axe-core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_CAPABILITIES_V1,
  type AccountV1,
  type ProductEventV1,
  type WalletChallengeV1,
  type WalletSessionV1,
  type Web2JsonManifestDraftV1,
} from "@proofline/contracts";
import { validComposerDraft, RUN_ID } from "../packages/contracts/test/fixtures";
import { finalizeWeb2JsonManifestDraft } from "../packages/domain/src";
import { App, type AppProps } from "./App";
import type { WalletAccessServices } from "./services/wallet-access-client";
import type {
  BrowserPort,
  ProviderOption,
  WalletProviderAdapter,
} from "./services/wallet-provider-adapter";
import type { StorageLike } from "./services/wallet-session-controller";
import type { HydratedRunView, RunSurfaceServices } from "./services/run-surface";

const DRAFT_KEY = "proofline:composer-draft:v1";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CHALLENGE_ID = `challenge_${"b".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;

type AdapterModule = typeof import("./services/wallet-provider-adapter");
type WalletAccessInjection = {
  services: WalletAccessServices;
  storage: StorageLike;
  dialog?: {
    loadProviderAdapter?: () => Promise<AdapterModule>;
    browser?: BrowserPort;
    clock?: { wait(milliseconds: number): Promise<void> };
  };
};
const WalletAwareApp = App as ComponentType<
  AppProps & { walletAccess?: WalletAccessInjection }
>;

const account: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: PROJECT_ID },
  tokens: [],
};
const session: WalletSessionV1 = {
  version: "1",
  wallet: account.wallet,
  project: account.project,
  projectToken: PROJECT_TOKEN,
  issuedAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-09T12:00:00.000Z",
};
const challenge: WalletChallengeV1 = {
  version: "1",
  challengeId: CHALLENGE_ID,
  address: ADDRESS,
  purpose: "browser-session",
  network: "coston2",
  chainId: 114,
  message: "Sign the exact Proofline browser-session challenge.",
  issuedAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-09T00:05:00.000Z",
};

function memory(initial: string | null = null) {
  let value = initial;
  return {
    storage: {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => { value = next; }),
      removeItem: vi.fn(() => { value = null; }),
    } satisfies StorageLike,
    read: () => value,
  };
}

function access(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
  return {
    listNetworks: vi.fn(async () => NETWORK_CAPABILITIES_V1),
    createWalletChallenge: vi.fn(async () => challenge),
    createWalletSession: vi.fn(async () => session),
    getAccount: vi.fn(async () => account),
    createAccountToken: vi.fn(),
    revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function walletAdapter(): WalletProviderAdapter {
  const provider = { request: vi.fn() };
  const option: ProviderOption = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test Wallet",
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    rdns: "wallet.example",
    source: "eip6963",
    provider,
  };
  return {
    discoverProviders: vi.fn(async () => [option]),
    connect: vi.fn(async () => ({ address: ADDRESS, chainId: "0x72" as const })),
    signMessage: vi.fn(async () => ({ address: ADDRESS, signature: SIGNATURE })),
    cancelPending: vi.fn(),
    close: vi.fn(),
  };
}

function walletInjection() {
  const stored = memory();
  const services = access();
  const adapter = walletAdapter();
  const createWalletProviderAdapter = vi.fn(() => adapter);
  const loadProviderAdapter = vi.fn(async () => ({
    EIP6963_DISCOVERY_WINDOW_MS: 50,
    createWalletProviderAdapter,
  } as unknown as AdapterModule));
  const browser: BrowserPort = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  return {
    stored,
    services,
    adapter,
    loadProviderAdapter,
    config: {
      services,
      storage: stored.storage,
      dialog: {
        loadProviderAdapter,
        browser,
        clock: { wait: vi.fn(async () => undefined) },
      },
    } satisfies WalletAccessInjection,
  };
}

function surfaces(overrides: Partial<RunSurfaceServices> = {}): RunSurfaceServices {
  return {
    listRuns: vi.fn(async () => ({ version: "1", runs: [] })),
    hydrateRun: vi.fn(),
    createRun: vi.fn(),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn(() => null),
    ...overrides,
  } as unknown as RunSurfaceServices;
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const topbar = document.querySelector<HTMLElement>(".topbar");
  if (!topbar) throw new Error("Topbar is unavailable");
  const opener = within(topbar).getByRole("button", {
    name: /^sign in with wallet$/i,
  });
  await user.click(opener);
  const dialog = await screen.findByRole("dialog", { name: /sign in with wallet/i });
  return { opener, dialog };
}

async function authenticateOpenDialog(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  await user.click(within(dialog).getByRole("button", { name: /^sign in with wallet$/i }));
  await user.click(await within(dialog).findByRole("option", { name: "Test Wallet" }));
}

function persistSubmitDraft(): Web2JsonManifestDraftV1 {
  const draft = {
    ...structuredClone(validComposerDraft),
    step: "submit" as const,
    fields: {
      ...structuredClone(validComposerDraft.fields),
      expectedQueryRows: [
        ...structuredClone(validComposerDraft.fields.expectedQueryRows),
        { id: "expected_window", key: "window", value: "1h" },
      ],
    },
  } as unknown as Web2JsonManifestDraftV1;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  return draft;
}

function collector() {
  const events: ProductEventV1[] = [];
  return {
    events,
    port: { emit: vi.fn((event: ProductEventV1) => events.push(event)) },
  };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 023C2B2 integrated Runs and deep-route sign-in", () => {
  it("opens one accessible dialog, restores opener focus on Escape, then lists runs once after authentication", async () => {
    window.history.replaceState({}, "", "/runs");
    const wallet = walletInjection();
    const listRuns = vi.fn(async () => ({ version: "1" as const, runs: [] }));
    const user = userEvent.setup();
    const rendered = render(
      <WalletAwareApp
        services={surfaces({ listRuns })}
        walletAccess={wallet.config}
      />,
    );

    expect(listRuns).not.toHaveBeenCalled();
    expect(wallet.loadProviderAdapter).not.toHaveBeenCalled();
    const first = await openDialog(user);
    expect(screen.getAllByRole("dialog", { name: /sign in with wallet/i })).toHaveLength(1);
    const axeResult = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(axeResult.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /sign in with wallet/i })).not.toBeInTheDocument();
    expect(first.opener).toHaveFocus();
    expect(listRuns).not.toHaveBeenCalled();

    const second = await openDialog(user);
    await authenticateOpenDialog(user, second.dialog);
    expect(await within(second.dialog).findByRole("heading", { name: "Signed in" })).toBeVisible();
    expect(second.dialog).toHaveTextContent("0x1111…1111");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (!topbar) throw new Error("Topbar is unavailable");
    expect(within(topbar).getByRole("button", {
      name: /wallet profile.*0x1111.*1111/i,
    })).toBeVisible();
    await user.click(within(second.dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(listRuns).toHaveBeenCalledOnce());
    expect(listRuns).toHaveBeenCalledWith({
      projectToken: PROJECT_TOKEN,
      status: undefined,
      limit: 20,
    });
    expect(wallet.stored.read()).toBe(PROJECT_TOKEN);
    expect(document.body.innerHTML).not.toContain(PROJECT_TOKEN);
  });

  it("hydrates the same deep URL once after sign-in and never creates a replacement route", async () => {
    window.history.replaceState({}, "", `/runs/${RUN_ID}?panel=diagnostics`);
    const wallet = walletInjection();
    const hydrated = {
      runId: RUN_ID,
      title: "Persisted signed-in run",
      network: "coston2",
      sequence: 7,
      terminal: true,
      stages: {
        preflight: "completed",
        request: "completed",
        round: "completed",
        proof: "completed",
        verify: "completed",
        consumer: "completed",
      },
      evidence: {},
    } as HydratedRunView;
    const hydrateRun = vi.fn(async () => hydrated);
    const user = userEvent.setup();
    render(
      <WalletAwareApp
        services={surfaces({ hydrateRun })}
        walletAccess={wallet.config}
      />,
    );

    expect(hydrateRun).not.toHaveBeenCalled();
    const { dialog } = await openDialog(user);
    await authenticateOpenDialog(user, dialog);
    expect(await screen.findByRole("heading", { name: "Persisted signed-in run" })).toBeVisible();
    expect(hydrateRun).toHaveBeenCalledOnce();
    expect(hydrateRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      projectToken: PROJECT_TOKEN,
      after: 0,
    }));
    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(window.location.search).toBe("?panel=diagnostics");
  });
});

describe("Slice 023C2B2 Composer pending authentication intent", () => {
  it("validates once before sign-in, survives cancellation, and resumes one exact create with the saved identity", async () => {
    window.history.replaceState({}, "", "/runs/new?step=submit");
    const draft = persistSubmitDraft();
    const finalized = finalizeWeb2JsonManifestDraft(draft);
    expect(finalized.valid).toBe(true);
    if (!finalized.valid) throw new Error("fixture must finalize");
    const wallet = walletInjection();
    const createRun = vi.fn(async () => ({
      status: "accepted" as const,
      runId: RUN_ID,
      location: `/v1/runs/${RUN_ID}`,
    }));
    const analytics = collector();
    const user = userEvent.setup();
    render(
      <WalletAwareApp
        services={surfaces({ createRun })}
        analytics={analytics.port}
        walletAccess={wallet.config}
      />,
    );

    const composerActions = document.querySelector<HTMLElement>(".composer-actions");
    if (!composerActions) throw new Error("Composer actions are unavailable");
    const submit = within(composerActions).getByRole("button", {
      name: /create preflight run|sign in with wallet/i,
    });
    await user.dblClick(submit);
    const firstDialog = await screen.findByRole("dialog", { name: /sign in with wallet/i });
    expect(analytics.events.filter(({ name }) => name === "MANIFEST_VALIDATED")).toEqual([
      expect.objectContaining({ metadata: { outcome: "accepted" } }),
    ]);
    expect(analytics.events.filter(({ name }) => name === "COMPOSER_STARTED")).toHaveLength(1);
    expect(createRun).not.toHaveBeenCalled();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(screen.getAllByRole("dialog", { name: /sign in with wallet/i })).toHaveLength(1);

    await user.click(within(firstDialog).getByRole("button", { name: /close wallet sign in/i }));
    expect(screen.queryByRole("dialog", { name: /sign in with wallet/i })).not.toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(createRun).not.toHaveBeenCalled();

    await user.click(within(composerActions).getByRole("button", { name: /sign in with wallet/i }));
    const secondDialog = await screen.findByRole("dialog", { name: /sign in with wallet/i });
    expect(analytics.events.filter(({ name }) => name === "MANIFEST_VALIDATED")).toHaveLength(1);
    expect(analytics.events.filter(({ name }) => name === "COMPOSER_STARTED")).toHaveLength(1);
    await authenticateOpenDialog(user, secondDialog);

    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    expect(createRun).toHaveBeenCalledWith({
      projectToken: PROJECT_TOKEN,
      manifest: finalized.manifest,
      idempotencyKey: draft.createIdempotencyKey,
    });
    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(new URLSearchParams(window.location.search).get("step")).toBe("preflight");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
