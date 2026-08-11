import React, { useRef, useState, type ComponentType, type ReactNode } from "react";
import axe from "axe-core";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_CAPABILITIES_V1,
  type AccountV1,
  type NetworkCapabilitiesV1,
  type WalletChallengeV1,
  type WalletSessionV1,
} from "@proofline/contracts";
import {
  WalletAccessError,
  type WalletAccessServices,
} from "./services/wallet-access-client";
import type { StorageLike } from "./services/wallet-session-controller";
import {
  WalletProviderError,
  type BrowserPort,
  type Eip1193Provider,
  type ProviderOption,
  type WalletProviderAdapter,
} from "./services/wallet-provider-adapter";

const CONTEXT_PATH = "./wallet-session-context";
const DIALOG_PATH = "./components/WalletSignInDialog";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const CHALLENGE_ID = `challenge_${"b".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;

type ContextModule = {
  WalletSessionProvider: ComponentType<{
    services: WalletAccessServices;
    storage: StorageLike;
    children: ReactNode;
  }>;
};

type AdapterModule = typeof import("./services/wallet-provider-adapter");

type DialogModule = {
  WalletSignInDialog: ComponentType<{
    onClose(): void;
    onAuthenticated?(): void;
    loadProviderAdapter?: () => Promise<AdapterModule>;
    browser?: BrowserPort;
    clock?: { wait(milliseconds: number): Promise<void> };
  }>;
};

async function loadUi() {
  const [context, dialog] = await Promise.all([
    import(CONTEXT_PATH) as Promise<ContextModule>,
    import(DIALOG_PATH) as Promise<DialogModule>,
  ]);
  return { ...context, ...dialog };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function storage() {
  let value: string | null = null;
  return {
    port: {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => { value = next; }),
      removeItem: vi.fn(() => { value = null; }),
    } satisfies StorageLike,
    read: () => value,
  };
}

const networks: NetworkCapabilitiesV1 = NETWORK_CAPABILITIES_V1;

const challenge: WalletChallengeV1 = {
  version: "1",
  challengeId: CHALLENGE_ID,
  address: ADDRESS,
  purpose: "browser-session",
  network: "coston2",
  chainId: 114,
  message: "proofline.example asks for the exact server-authored signature",
  issuedAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-09T00:05:00.000Z",
};

const session: WalletSessionV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: PROJECT_ID },
  projectToken: PROJECT_TOKEN,
  issuedAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-09T12:00:00.000Z",
};

function services(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
  const account: AccountV1 = {
    version: "1",
    wallet: session.wallet,
    project: session.project,
    tokens: [],
  };
  return {
    listNetworks: vi.fn(async () => networks),
    createWalletChallenge: vi.fn(async () => challenge),
    createWalletSession: vi.fn(async () => session),
    getAccount: vi.fn(async () => account),
    createAccountToken: vi.fn(),
    revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function rawProvider(): Eip1193Provider {
  return { request: vi.fn() };
}

function option(id: string, name: string): ProviderOption {
  return {
    id,
    name,
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    rdns: `example.${name.toLowerCase().replaceAll(" ", "-")}`,
    source: "eip6963",
    provider: rawProvider(),
  };
}

const walletA = option("11111111-1111-4111-8111-111111111111", "Wallet A");
const walletB = option("22222222-2222-4222-8222-222222222222", "Wallet B");

function providerAdapter(overrides: Partial<WalletProviderAdapter> = {}): WalletProviderAdapter {
  return {
    discoverProviders: vi.fn(async () => [walletA, walletB]),
    connect: vi.fn(async () => ({ address: ADDRESS, chainId: "0x72" as const })),
    signMessage: vi.fn(async () => ({ address: ADDRESS, signature: SIGNATURE })),
    cancelPending: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function adapterLoader(wallet: WalletProviderAdapter) {
  const createWalletProviderAdapter = vi.fn(() => wallet);
  return {
    load: vi.fn(async () => ({
      EIP6963_DISCOVERY_WINDOW_MS: 50,
      createWalletProviderAdapter,
      WalletProviderError,
    } as unknown as AdapterModule)),
    createWalletProviderAdapter,
  };
}

const browser: BrowserPort = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
};
const clock = { wait: vi.fn(async () => undefined) };

async function renderDialog(input: {
  access?: WalletAccessServices;
  stored?: ReturnType<typeof storage>;
  wallet?: WalletProviderAdapter;
  loader?: ReturnType<typeof adapterLoader>;
  onClose?: () => void;
  onAuthenticated?: () => void;
}) {
  const { WalletSessionProvider, WalletSignInDialog } = await loadUi();
  const stored = input.stored ?? storage();
  const access = input.access ?? services();
  const wallet = input.wallet ?? providerAdapter();
  const loader = input.loader ?? adapterLoader(wallet);
  const rendered = render(
    <WalletSessionProvider services={access} storage={stored.port}>
      <WalletSignInDialog
        onClose={input.onClose ?? vi.fn()}
        onAuthenticated={input.onAuthenticated}
        loadProviderAdapter={loader.load}
        browser={browser}
        clock={clock}
      />
    </WalletSessionProvider>,
  );
  await screen.findByRole("button", { name: "Sign in with wallet" });
  return { ...rendered, access, stored, wallet, loader };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Slice 023C2B1 lazy dialog discovery", () => {
  it("does nothing on render, then starts networks and dynamic provider discovery without a waterfall", async () => {
    const accessNetworks = deferred<NetworkCapabilitiesV1>();
    const moduleLoad = deferred<AdapterModule>();
    const discovery = deferred<readonly ProviderOption[]>();
    const wallet = providerAdapter({ discoverProviders: vi.fn(() => discovery.promise) });
    const factory = vi.fn(() => wallet);
    const load = vi.fn(() => moduleLoad.promise);
    const access = services({ listNetworks: vi.fn(() => accessNetworks.promise) });
    const user = userEvent.setup();
    await renderDialog({ access, wallet, loader: { load, createWalletProviderAdapter: factory } });

    expect(load).not.toHaveBeenCalled();
    expect(access.listNetworks).not.toHaveBeenCalled();
    expect(wallet.discoverProviders).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sign in with wallet" }));

    expect(screen.getByText("Discovering wallets…")).toHaveAttribute("aria-live", "polite");
    expect(load).toHaveBeenCalledOnce();
    expect(access.listNetworks).toHaveBeenCalledOnce();
    moduleLoad.resolve({
      EIP6963_DISCOVERY_WINDOW_MS: 50,
      createWalletProviderAdapter: factory,
      WalletProviderError,
    } as unknown as AdapterModule);
    await waitFor(() => expect(wallet.discoverProviders).toHaveBeenCalledOnce());
    expect(accessNetworks.promise).toBeInstanceOf(Promise);
    discovery.resolve([walletA, walletB]);
    accessNetworks.resolve(networks);

    const chooser = await screen.findByRole("listbox", { name: "Available wallets" });
    const choices = within(chooser).getAllByRole("option");
    expect(choices.map((choice) => choice.textContent)).toEqual(["Wallet A", "Wallet B"]);
    expect(choices.every((choice) => Boolean(choice.textContent?.trim()))).toBe(true);
    choices[0]!.focus();
    await user.keyboard("{ArrowDown}");
    expect(choices[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(choices[0]).toHaveFocus();
  });

  it("runs the exact staged Coston2 EOA, challenge, signature and session journey", async () => {
    const connection = deferred<{ address: string; chainId: "0x72" }>();
    const challengeResult = deferred<WalletChallengeV1>();
    const signature = deferred<{ address: string; signature: string }>();
    const sessionResult = deferred<WalletSessionV1>();
    const wallet = providerAdapter({
      connect: vi.fn(() => connection.promise),
      signMessage: vi.fn(() => signature.promise),
    });
    const access = services({
      createWalletChallenge: vi.fn(() => challengeResult.promise),
      createWalletSession: vi.fn(() => sessionResult.promise),
    });
    const stored = storage();
    const authenticated = vi.fn();
    const user = userEvent.setup();
    await renderDialog({ access, stored, wallet, onAuthenticated: authenticated });

    await user.click(screen.getByRole("button", { name: "Sign in with wallet" }));
    await user.click(await screen.findByRole("option", { name: "Wallet B" }));
    expect(screen.getByText("Connecting to Wallet B…")).toHaveAttribute("aria-live", "polite");
    expect(wallet.connect).toHaveBeenCalledWith({
      provider: walletB.provider,
      networkCapability: networks.networks[0],
    });

    await act(async () => connection.resolve({ address: ADDRESS, chainId: "0x72" }));
    expect(await screen.findByText("Creating secure challenge…")).toBeVisible();
    expect(access.createWalletChallenge).toHaveBeenCalledWith({ version: "1", address: ADDRESS });

    await act(async () => challengeResult.resolve(challenge));
    expect(await screen.findByText("Confirm the signature in Wallet B…")).toBeVisible();
    expect(wallet.signMessage).toHaveBeenCalledWith({ message: challenge.message });

    await act(async () => signature.resolve({ address: ADDRESS, signature: SIGNATURE }));
    expect(await screen.findByText("Creating Orivra session…")).toBeVisible();
    expect(access.createWalletSession).toHaveBeenCalledWith({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: SIGNATURE,
    });

    await act(async () => sessionResult.resolve(session));
    expect(await screen.findByText("Signed in")).toBeVisible();
    expect(stored.read()).toBe(PROJECT_TOKEN);
    expect(authenticated).toHaveBeenCalledOnce();
    expect(document.body.innerHTML).not.toContain(PROJECT_TOKEN);
  });
});

describe("Slice 023C2B1 bounded failure states", () => {
  it("maps unavailable, unsupported, contract, invalid challenge and API failures to one safe primary action", async () => {
    const cases: Array<{
      name: string;
      access?: Partial<WalletAccessServices>;
      wallet?: Partial<WalletProviderAdapter>;
      expected: string;
      chooseProvider?: boolean;
    }> = [
      {
        name: "no provider",
        wallet: { discoverProviders: vi.fn(async () => []) },
        expected: "Wallet unavailable",
        chooseProvider: false,
      },
      {
        name: "unsupported network",
        access: { listNetworks: vi.fn(async () => ({ version: "1", networks: [networks.networks[1]] } as unknown as NetworkCapabilitiesV1)) },
        expected: "Coston2 unavailable",
        chooseProvider: false,
      },
      {
        name: "rejected",
        wallet: { connect: vi.fn(async () => { throw new WalletProviderError({ kind: "rejected", code: "WALLET_REQUEST_REJECTED", retryable: true }); }) },
        expected: "Wallet request rejected",
      },
      {
        name: "contract wallet",
        wallet: { connect: vi.fn(async () => { throw new WalletProviderError({ kind: "unsupported", code: "CONTRACT_WALLET_UNSUPPORTED", retryable: false }); }) },
        expected: "Contract wallet unsupported",
      },
      {
        name: "challenge address mismatch",
        access: { createWalletChallenge: vi.fn(async () => ({ ...challenge, address: OTHER_ADDRESS })) },
        expected: "Challenge could not be verified",
      },
      {
        name: "challenge network mismatch",
        access: { createWalletChallenge: vi.fn(async () => ({ ...challenge, network: "flare" as never })) },
        expected: "Challenge could not be verified",
      },
      {
        name: "challenge chain mismatch",
        access: { createWalletChallenge: vi.fn(async () => ({ ...challenge, chainId: 14 as never })) },
        expected: "Challenge could not be verified",
      },
      {
        name: "challenge purpose mismatch",
        access: { createWalletChallenge: vi.fn(async () => ({ ...challenge, purpose: "cli-token" as never })) },
        expected: "Challenge could not be verified",
      },
      {
        name: "expired challenge",
        access: { createWalletSession: vi.fn(async () => { throw new WalletAccessError({ kind: "http", status: 409, code: "CHALLENGE_UNAVAILABLE", retryable: false }); }) },
        expected: "Challenge expired",
      },
      {
        name: "invalid signature",
        access: { createWalletSession: vi.fn(async () => { throw new WalletAccessError({ kind: "http", status: 401, code: "WALLET_SIGNATURE_INVALID", retryable: false }); }) },
        expected: "Signature invalid",
      },
      {
        name: "offline",
        access: { listNetworks: vi.fn(async () => { throw new WalletAccessError({ kind: "transport", status: 0, code: "TRANSPORT_UNAVAILABLE", retryable: true }); }) },
        expected: "Orivra is offline",
        chooseProvider: false,
      },
    ];

    for (const item of cases) {
      const user = userEvent.setup();
      const access = services(item.access);
      const wallet = providerAdapter(item.wallet);
      await renderDialog({ access, wallet });
      await user.click(screen.getByRole("button", { name: "Sign in with wallet" }));
      if (item.chooseProvider !== false) {
        await user.click(await screen.findByRole("option", { name: "Wallet A" }));
      }
      expect(await screen.findByRole("heading", { name: item.expected })).toBeVisible();
      const dialog = screen.getByRole("dialog", { name: "Sign in with wallet" });
      expect(dialog.querySelectorAll(".dialog-primary")).toHaveLength(1);
      cleanup();
    }
  });
});

describe("Slice 023C2B1 cancellation, focus and accessibility", () => {
  it("traps and restores focus; Escape cancels late session creation before token persistence", async () => {
    const { WalletSessionProvider, WalletSignInDialog } = await loadUi();
    const sessionResult = deferred<WalletSessionV1>();
    const access = services({ createWalletSession: vi.fn(() => sessionResult.promise) });
    const stored = storage();
    const wallet = providerAdapter();
    const loader = adapterLoader(wallet);
    const authenticated = vi.fn();
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      const trigger = useRef<HTMLButtonElement>(null);
      return (
        <WalletSessionProvider services={access} storage={stored.port}>
          <button ref={trigger} type="button" onClick={() => setOpen(true)}>Open wallet sign in</button>
          {open ? (
            <WalletSignInDialog
              onClose={() => setOpen(false)}
              onAuthenticated={authenticated}
              loadProviderAdapter={loader.load}
              browser={browser}
              clock={clock}
            />
          ) : null}
        </WalletSessionProvider>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open wallet sign in" });
    await user.click(trigger);
    const start = screen.getByRole("button", { name: "Sign in with wallet" });
    const close = screen.getByRole("button", { name: "Close wallet sign in" });
    expect(start).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(start).toHaveFocus();

    await user.click(start);
    await user.click(await screen.findByRole("option", { name: "Wallet A" }));
    expect(await screen.findByText("Creating Orivra session…")).toBeVisible();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Sign in with wallet" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(wallet.cancelPending).toHaveBeenCalled();
    expect(wallet.close).toHaveBeenCalled();
    await act(async () => sessionResult.resolve(session));
    expect(stored.read()).toBeNull();
    expect(authenticated).not.toHaveBeenCalled();
  });

  it("has no serious or critical axe violations in idle and provider-choice states", async () => {
    const user = userEvent.setup();
    const rendered = await renderDialog({});
    const initial = await axe.run(rendered.container, { rules: { "color-contrast": { enabled: false } } });
    expect(initial.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Sign in with wallet" }));
    await screen.findByRole("listbox", { name: "Available wallets" });
    const chooser = await axe.run(rendered.container, { rules: { "color-contrast": { enabled: false } } });
    expect(chooser.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
});
