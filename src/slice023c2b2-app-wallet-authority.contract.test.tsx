import React, { type ComponentType } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

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

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 023C2B2 production wallet authority composition", () => {
  it("uses the accepted session provider/client and removes manual project-token UI and copy", () => {
    expect(appSource).toMatch(/WalletSessionProvider/);
    expect(appSource).toMatch(/WalletSignInDialog/);
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
      expect(window.location.pathname).toBe("/runs");
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
});
