import React, { StrictMode, type ComponentType, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountV1,
  NetworkCapabilitiesV1,
  WalletChallengeRequestV1,
  WalletChallengeV1,
  WalletSessionRequestV1,
  WalletSessionV1,
} from "@proofline/contracts";
import type {
  StorageLike,
  WalletSessionSnapshot,
} from "./services/wallet-session-controller";
import type { WalletAccessServices } from "./services/wallet-access-client";

const MODULE_PATH = "./wallet-session-context";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

type WalletSessionContextValue = {
  snapshot: WalletSessionSnapshot;
  accessToken(): string | null;
  listNetworks(): Promise<NetworkCapabilitiesV1>;
  createWalletChallenge(request: WalletChallengeRequestV1): Promise<WalletChallengeV1>;
  createSession(request: WalletSessionRequestV1): Promise<void>;
  restore(): Promise<void>;
  signOut(): Promise<void>;
  retry(): Promise<void>;
  forgetBrowser(): void;
  cancelPending(): void;
};

type ContextModule = {
  WalletSessionProvider: ComponentType<{
    services: WalletAccessServices;
    storage: StorageLike;
    children: ReactNode;
  }>;
  useWalletSession(): WalletSessionContextValue;
};

async function loadModule(): Promise<ContextModule> {
  return import(MODULE_PATH) as Promise<ContextModule>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

function services(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
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

afterEach(() => {
  vi.restoreAllMocks();
});
describe("Slice 023C2B1 app-wide wallet session context", () => {
  it("creates one controller, restores once after mount, and never touches a wallet on render or rerender", async () => {
    const { WalletSessionProvider, useWalletSession } = await loadModule();
    const stored = memory(PROJECT_TOKEN);
    const access = services();
    const providerRequest = vi.fn();
    let providerReads = 0;
    const originalEthereum = Object.getOwnPropertyDescriptor(globalThis, "ethereum");
    Object.defineProperty(globalThis, "ethereum", {
      configurable: true,
      get() {
        providerReads += 1;
        return { request: providerRequest };
      },
    });

    function Probe() {
      const session = useWalletSession();
      return <output>{session.snapshot.status}:{session.accessToken() ? "has-access" : "no-access"}</output>;
    }

    try {
      const tree = (
        <WalletSessionProvider services={access} storage={stored.storage}>
          <Probe />
        </WalletSessionProvider>
      );
      const rendered = render(tree);
      expect(await screen.findByText("authenticated:has-access")).toBeVisible();
      rendered.rerender(tree);

      expect(access.getAccount).toHaveBeenCalledOnce();
      expect(access.getAccount).toHaveBeenCalledWith({ projectToken: PROJECT_TOKEN });
      expect(access.listNetworks).not.toHaveBeenCalled();
      expect(access.createWalletChallenge).not.toHaveBeenCalled();
      expect(access.createWalletSession).not.toHaveBeenCalled();
      expect(providerReads).toBe(0);
      expect(providerRequest).not.toHaveBeenCalled();
      expect(rendered.container.innerHTML).not.toContain(PROJECT_TOKEN);
    } finally {
      if (originalEthereum) Object.defineProperty(globalThis, "ethereum", originalEthereum);
      else Reflect.deleteProperty(globalThis, "ethereum");
    }
  });

  it("wraps accepted session creation, refreshes the safe snapshot, and never renders the bearer", async () => {
    const { WalletSessionProvider, useWalletSession } = await loadModule();
    const stored = memory();
    const access = services();
    const user = userEvent.setup();

    function Probe() {
      const wallet = useWalletSession();
      return (
        <div>
          <output>{wallet.snapshot.status}</output>
          <button type="button" onClick={() => void wallet.createSession({
            version: "1",
            challengeId: `challenge_${"b".repeat(64)}`,
            signature: `0x${"11".repeat(65)}`,
          })}>Create session</button>
        </div>
      );
    }

    const rendered = render(
      <WalletSessionProvider services={access} storage={stored.storage}>
        <Probe />
      </WalletSessionProvider>,
    );
    expect(await screen.findByText("anonymous")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create session" }));

    expect(await screen.findByText("authenticated")).toBeVisible();
    expect(stored.read()).toBe(PROJECT_TOKEN);
    expect(rendered.container.innerHTML).not.toContain(PROJECT_TOKEN);
    expect(access.createWalletSession).toHaveBeenCalledOnce();
  });

  it("closes on unmount so a late restore cannot publish state or trigger wallet work", async () => {
    const { WalletSessionProvider, useWalletSession } = await loadModule();
    const restore = deferred<AccountV1>();
    const stored = memory(PROJECT_TOKEN);
    const access = services({ getAccount: vi.fn(() => restore.promise) });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    function Probe() {
      return <output>{useWalletSession().snapshot.status}</output>;
    }

    const rendered = render(
      <StrictMode>
        <WalletSessionProvider services={access} storage={stored.storage}>
          <Probe />
        </WalletSessionProvider>
      </StrictMode>,
    );
    expect(await screen.findByText("restoring")).toBeVisible();
    rendered.unmount();
    await act(async () => restore.resolve(account));

    expect(access.getAccount).toHaveBeenCalledOnce();
    expect(access.createWalletChallenge).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
