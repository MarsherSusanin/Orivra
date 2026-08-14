import React, { type ComponentType } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountV1, WalletSessionV1 } from "@proofline/contracts";
import { RUN_ID } from "../packages/contracts/test/fixtures";
import appSource from "./App.tsx?raw";
import runsSource from "./components/RunsIndex.tsx?raw";
import composerSource from "./components/ManifestComposer.tsx?raw";
import { App, type AppProps } from "./App";
import type { WalletAccessServices } from "./services/wallet-access-client";
import {
  PROJECT_TOKEN_SESSION_KEY,
  type StorageLike,
} from "./services/wallet-session-controller";
import type { HydratedRunView, RunSurfaceServices } from "./services/run-surface";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const RESTORED_SHARE_TOKEN = `share_${"c".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SHARE_SESSION_KEY = `proofline:share-token:${RUN_ID}`;

type WalletAccessInjection = {
  services: WalletAccessServices;
  storage: StorageLike;
  dialog?: Record<string, unknown>;
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

const terminalRun = {
  runId: RUN_ID,
  title: "Shared evidence",
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

function memory(initial: string | null = null): StorageLike {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
  };
}

function access(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
  return {
    listNetworks: vi.fn(),
    createWalletChallenge: vi.fn(),
    createWalletSession: vi.fn(async () => session),
    getAccount: vi.fn(async () => account),
    createAccountToken: vi.fn(),
    revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function surfaces(overrides: Partial<RunSurfaceServices> = {}): RunSurfaceServices {
  return {
    listRuns: vi.fn(async () => ({ version: "1", runs: [] })),
    hydrateRun: vi.fn(async () => terminalRun),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn(() => null),
    ...overrides,
  } as unknown as RunSurfaceServices;
}

function injectedProjectSession(wallet: WalletAccessServices) {
  const loadProviderAdapter = vi.fn();
  return {
    loadProviderAdapter,
    walletAccess: {
      services: wallet,
      storage: sessionStorage,
      dialog: { loadProviderAdapter },
    } as WalletAccessInjection,
  };
}

async function flushWalletRestore() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 023C2B2 production wallet authority composition", () => {
  it("uses the accepted session provider/client and removes manual project-token UI and copy", () => {
    expect(appSource).toMatch(/WalletSessionProvider/);
    expect(appSource).toMatch(/WalletChromeProvider/);
    expect(appSource).toMatch(/createWalletAccessClient/);
    expect(appSource).not.toMatch(/ProjectTokenDialog/);

    for (const source of [appSource, runsSource, composerSource]) {
      expect(source).not.toMatch(/connect project|reconnect project|project token/i);
    }
    expect(`${appSource}\n${runsSource}\n${composerSource}`).toMatch(
      /Sign in with wallet/,
    );
    expect(`${appSource}\n${runsSource}`).toMatch(/Reconnect wallet session/);
  });

  it("keeps an explicit AppProps project token authoritative without restoring or prompting a wallet", async () => {
    window.history.replaceState({}, "", "/runs");
    const wallet = access();
    const listRuns = vi.fn(async () => ({ version: "1" as const, runs: [] }));

    render(
      <WalletAwareApp
        projectToken={PROJECT_TOKEN}
        services={surfaces({ listRuns })}
        walletAccess={{ services: wallet, storage: memory(PROJECT_TOKEN) }}
      />,
    );

    await waitFor(() => expect(listRuns).toHaveBeenCalledOnce());
    expect(listRuns).toHaveBeenCalledWith({
      projectToken: PROJECT_TOKEN,
      status: undefined,
      limit: 20,
    });
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /sign in with wallet/i })).not.toBeInTheDocument();
  });

  it("restores a browser session into /runs without loading or reading a wallet provider", async () => {
    window.history.replaceState({}, "", "/runs");
    const wallet = access();
    const listRuns = vi.fn(async () => ({ version: "1" as const, runs: [] }));
    const providerRequest = vi.fn();
    let providerReads = 0;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ethereum");
    Object.defineProperty(globalThis, "ethereum", {
      configurable: true,
      get() {
        providerReads += 1;
        return { request: providerRequest };
      },
    });

    try {
      const first = render(
        <WalletAwareApp
          services={surfaces({ listRuns })}
          walletAccess={{ services: wallet, storage: memory(PROJECT_TOKEN) }}
        />,
      );
      await waitFor(() => expect(listRuns).toHaveBeenCalledOnce());
      expect(wallet.getAccount).toHaveBeenCalledOnce();
      expect(providerReads).toBe(0);
      expect(providerRequest).not.toHaveBeenCalled();
      expect(document.body.innerHTML).not.toContain(PROJECT_TOKEN);

      first.unmount();
      expect(window.location.pathname).toBe("/app/runs");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "ethereum", descriptor);
      else Reflect.deleteProperty(globalThis, "ethereum");
    }
  });

  it("keeps a share fragment read-only even when a browser project session already exists", async () => {
    sessionStorage.setItem(PROJECT_TOKEN_SESSION_KEY, PROJECT_TOKEN);
    window.history.replaceState({}, "", `/runs/${RUN_ID}#share=${SHARE_TOKEN}`);
    const wallet = access();
    const hydrateRun = vi.fn(async () => terminalRun);

    render(
      <WalletAwareApp
        services={surfaces({ hydrateRun })}
        walletAccess={{ services: wallet, storage: sessionStorage }}
      />,
    );

    expect(window.location.hash).toBe("");
    await waitFor(() => expect(hydrateRun).toHaveBeenCalledOnce());
    expect(hydrateRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      projectToken: SHARE_TOKEN,
    }));
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /sign in with wallet/i })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PROJECT_TOKEN_SESSION_KEY)).toBe(PROJECT_TOKEN);
  });

  it("uses a valid current share in memory when run-scoped session persistence is denied", async () => {
    sessionStorage.setItem(PROJECT_TOKEN_SESSION_KEY, PROJECT_TOKEN);
    window.history.replaceState({}, "", `/runs/${RUN_ID}#share=${SHARE_TOKEN}`);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === SHARE_SESSION_KEY) throw new DOMException("denied", "SecurityError");
      return originalSetItem.call(this, key, value);
    });
    const wallet = access();
    const injection = injectedProjectSession(wallet);
    const hydrateRun = vi.fn(async () => terminalRun);

    render(
      <WalletAwareApp
        services={surfaces({ hydrateRun })}
        walletAccess={injection.walletAccess}
      />,
    );

    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(hydrateRun).toHaveBeenCalledOnce());
    expect(hydrateRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      projectToken: SHARE_TOKEN,
    }));
    expect(sessionStorage.getItem(SHARE_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(PROJECT_TOKEN_SESSION_KEY)).toBe(PROJECT_TOKEN);
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(injection.loadProviderAdapter).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(SHARE_TOKEN);
    expect(document.body.textContent).not.toContain(PROJECT_TOKEN);
  });

  it("scrubs an invalid share fragment and stays anonymous instead of restoring the project", async () => {
    sessionStorage.setItem(PROJECT_TOKEN_SESSION_KEY, PROJECT_TOKEN);
    window.history.replaceState(
      {},
      "",
      `/runs/${RUN_ID}?panel=diagnostics#share=share_deadbeef`,
    );
    const wallet = access();
    const injection = injectedProjectSession(wallet);
    const hydrateRun = vi.fn(async () => terminalRun);

    render(
      <WalletAwareApp
        services={surfaces({ hydrateRun })}
        walletAccess={injection.walletAccess}
      />,
    );
    await flushWalletRestore();

    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(window.location.search).toBe("?panel=diagnostics");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("heading", { name: /sign in to open run/i })).toBeVisible();
    expect(hydrateRun).not.toHaveBeenCalled();
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(injection.loadProviderAdapter).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PROJECT_TOKEN_SESSION_KEY)).toBe(PROJECT_TOKEN);
    expect(document.body.textContent).not.toMatch(/project_[a-f0-9]{64}|share_[a-f0-9]+/i);
  });

  it("scrubs a query share attempt and stays anonymous instead of restoring the project", async () => {
    sessionStorage.setItem(PROJECT_TOKEN_SESSION_KEY, PROJECT_TOKEN);
    window.history.replaceState(
      {},
      "",
      `/runs/${RUN_ID}?share=${SHARE_TOKEN}&status=active#ignored`,
    );
    const wallet = access();
    const injection = injectedProjectSession(wallet);
    const hydrateRun = vi.fn(async () => terminalRun);

    render(
      <WalletAwareApp
        services={surfaces({ hydrateRun })}
        walletAccess={injection.walletAccess}
      />,
    );
    await flushWalletRestore();

    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(window.location.search).toBe("?status=active");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("heading", { name: /sign in to open run/i })).toBeVisible();
    expect(hydrateRun).not.toHaveBeenCalled();
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(injection.loadProviderAdapter).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PROJECT_TOKEN_SESSION_KEY)).toBe(PROJECT_TOKEN);
    expect(document.body.textContent).not.toContain(PROJECT_TOKEN);
  });

  it("uses a restored valid run share after scrubbing a malformed current attempt", async () => {
    sessionStorage.setItem(PROJECT_TOKEN_SESSION_KEY, PROJECT_TOKEN);
    sessionStorage.setItem(SHARE_SESSION_KEY, RESTORED_SHARE_TOKEN);
    window.history.replaceState({}, "", `/runs/${RUN_ID}#share=share_deadbeef`);
    const wallet = access();
    const injection = injectedProjectSession(wallet);
    const hydrateRun = vi.fn(async () => terminalRun);

    render(
      <WalletAwareApp
        services={surfaces({ hydrateRun })}
        walletAccess={injection.walletAccess}
      />,
    );

    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(hydrateRun).toHaveBeenCalledOnce());
    expect(hydrateRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      projectToken: RESTORED_SHARE_TOKEN,
    }));
    expect(sessionStorage.getItem(SHARE_SESSION_KEY)).toBe(RESTORED_SHARE_TOKEN);
    expect(sessionStorage.getItem(PROJECT_TOKEN_SESSION_KEY)).toBe(PROJECT_TOKEN);
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(injection.loadProviderAdapter).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(RESTORED_SHARE_TOKEN);
    expect(document.body.textContent).not.toContain(PROJECT_TOKEN);
  });

  it("preserves a write-denied current share across the StrictMode initializer replay without leaking it to another run", async () => {
    sessionStorage.setItem(PROJECT_TOKEN_SESSION_KEY, PROJECT_TOKEN);
    window.history.replaceState({}, "", `/runs/${RUN_ID}#share=${SHARE_TOKEN}`);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === SHARE_SESSION_KEY) throw new DOMException("denied", "SecurityError");
      return originalSetItem.call(this, key, value);
    });
    const wallet = access();
    const injection = injectedProjectSession(wallet);
    const hydrateRun = vi.fn(async () => terminalRun);

    const shared = render(
      <React.StrictMode>
        <WalletAwareApp
          services={surfaces({ hydrateRun })}
          walletAccess={injection.walletAccess}
        />
      </React.StrictMode>,
    );

    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(hydrateRun).toHaveBeenCalledOnce());
    expect(hydrateRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      projectToken: SHARE_TOKEN,
    }));
    expect(sessionStorage.getItem(SHARE_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(PROJECT_TOKEN_SESSION_KEY)).toBe(PROJECT_TOKEN);
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(injection.loadProviderAdapter).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(SHARE_TOKEN);
    expect(document.body.textContent).not.toContain(PROJECT_TOKEN);

    shared.unmount();
    window.history.replaceState({}, "", "/runs/run_other");
    const nextWallet = access();
    const nextInjection = injectedProjectSession(nextWallet);
    const hydrateOther = vi.fn(async () => ({ ...terminalRun, runId: "run_other" }));
    render(
      <React.StrictMode>
        <WalletAwareApp
          services={surfaces({ hydrateRun: hydrateOther })}
          walletAccess={nextInjection.walletAccess}
        />
      </React.StrictMode>,
    );

    await waitFor(() => expect(hydrateOther).toHaveBeenCalledOnce());
    expect(hydrateOther).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run_other",
      projectToken: PROJECT_TOKEN,
    }));
    expect(hydrateOther).not.toHaveBeenCalledWith(expect.objectContaining({
      projectToken: SHARE_TOKEN,
    }));
    expect(nextWallet.getAccount).toHaveBeenCalledOnce();
    expect(nextWallet.listNetworks).not.toHaveBeenCalled();
    expect(nextInjection.loadProviderAdapter).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "invalid fragment",
      initial: `/runs/${RUN_ID}?panel=diagnostics#share=share_deadbeef`,
      search: "?panel=diagnostics",
    },
    {
      label: "query attempt",
      initial: `/runs/${RUN_ID}?share=${SHARE_TOKEN}&status=active#ignored`,
      search: "?status=active",
    },
  ])("keeps a $label suppressive across the StrictMode initializer replay", async ({ initial, search }) => {
    sessionStorage.setItem(PROJECT_TOKEN_SESSION_KEY, PROJECT_TOKEN);
    window.history.replaceState({}, "", initial);
    const wallet = access();
    const injection = injectedProjectSession(wallet);
    const hydrateRun = vi.fn(async () => terminalRun);

    render(
      <React.StrictMode>
        <WalletAwareApp
          services={surfaces({ hydrateRun })}
          walletAccess={injection.walletAccess}
        />
      </React.StrictMode>,
    );
    await flushWalletRestore();

    expect(window.location.pathname).toBe(`/app/runs/${RUN_ID}`);
    expect(window.location.search).toBe(search);
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("heading", { name: /sign in to open run/i })).toBeVisible();
    expect(hydrateRun).not.toHaveBeenCalled();
    expect(wallet.getAccount).not.toHaveBeenCalled();
    expect(wallet.listNetworks).not.toHaveBeenCalled();
    expect(injection.loadProviderAdapter).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PROJECT_TOKEN_SESSION_KEY)).toBe(PROJECT_TOKEN);
    expect(document.body.textContent).not.toMatch(/project_[a-f0-9]{64}|share_[a-f0-9]+/i);
  });
});
