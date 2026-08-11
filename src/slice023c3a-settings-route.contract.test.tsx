import axe from "axe-core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountV1, WalletSessionV1 } from "@proofline/contracts";
import appSource from "./App.tsx?raw";
import contextSource from "./wallet-session-context.tsx?raw";
import stylesSource from "./styles.css?raw";
import { App } from "./App";
import { Sidebar } from "./components/Sidebar";
import type { WalletAccessServices } from "./services/wallet-access-client";
import type { StorageLike } from "./services/wallet-session-controller";
import type { RunSurfaceServices } from "./services/run-surface";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

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

function memory(initial: string | null = null): StorageLike {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
  };
}

function wallet(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
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

function surfaces(): RunSurfaceServices {
  return {
    listRuns: vi.fn(async () => ({ version: "1", runs: [] })),
    hydrateRun: vi.fn(),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn(() => null),
  } as unknown as RunSurfaceServices;
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 023C3A Settings route and authority", () => {
  it("makes Settings a real active route backed by account-only context transitions", () => {
    expect(appSource).toMatch(/AccountSettings/);
    expect(appSource).toMatch(/pathname\s*===\s*["']\/app\/settings["']/);
    expect(contextSource).toMatch(/createAccountToken/);
    expect(contextSource).toMatch(/refreshAccount/);
    expect(contextSource).not.toMatch(/wallet-provider-adapter/);

    render(<Sidebar active="Settings" />);
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("href", "/app/settings");
    expect(settings).toHaveAttribute("aria-current", "page");
  });

  it("shows one anonymous wallet entry and reuses the shared sign-in dialog", async () => {
    window.history.replaceState({}, "", "/settings");
    const access = wallet();
    const loadProviderAdapter = vi.fn();
    const user = userEvent.setup();
    const rendered = render(
      <App
        services={surfaces()}
        walletAccess={{
          services: access,
          storage: memory(),
          dialog: { loadProviderAdapter },
        }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Account settings" })).toBeVisible();
    const card = screen.getByRole("region", { name: "Wallet session required" });
    const opener = within(card).getByRole("button", { name: "Sign in with wallet" });
    expect(screen.getAllByRole("button", { name: "Sign in with wallet" })).toHaveLength(1);
    expect(access.getAccount).not.toHaveBeenCalled();
    expect(loadProviderAdapter).not.toHaveBeenCalled();

    await user.click(opener);
    expect(screen.getAllByRole("dialog", { name: "Sign in with wallet" })).toHaveLength(1);
    const result = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  });

  it("restores one browser account on /settings without prompting or loading a wallet", async () => {
    window.history.replaceState({}, "", "/settings");
    const access = wallet();
    const loadProviderAdapter = vi.fn();
    const runServices = surfaces();
    render(
      <App
        services={runServices}
        walletAccess={{
          services: access,
          storage: memory(PROJECT_TOKEN),
          dialog: { loadProviderAdapter },
        }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Account settings" })).toBeVisible();
    await waitFor(() => expect(access.getAccount).toHaveBeenCalledOnce());
    expect(access.listNetworks).not.toHaveBeenCalled();
    expect(loadProviderAdapter).not.toHaveBeenCalled();
    expect(runServices.listRuns).not.toHaveBeenCalled();
    expect(screen.getByText(ADDRESS)).toBeVisible();
  });

  it.each([
    ["explicit CLI/Action/legacy capability", PROJECT_TOKEN],
    ["share capability", SHARE_TOKEN],
  ])("does not grant Settings management to an %s", async (_label, token) => {
    window.history.replaceState({}, "", "/settings");
    const access = wallet();
    const runServices = surfaces();
    render(
      <App
        projectToken={token}
        services={runServices}
        walletAccess={{ services: access, storage: memory(PROJECT_TOKEN) }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Browser wallet session required" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
    expect(access.getAccount).not.toHaveBeenCalled();
    expect(access.createAccountToken).not.toHaveBeenCalled();
    expect(runServices.listRuns).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(token);
  });

  it("keeps the Settings form stacked and bounded at the accepted mobile width", () => {
    expect(stylesSource).toMatch(/\.settings-account/);
    expect(stylesSource).toMatch(/\.settings-token-form/);
    const mobile = stylesSource.match(/@media\s*\(max-width:\s*720px\)[^{]*\{([\s\S]*)$/)?.[1] ?? "";
    expect(mobile).toMatch(/\.settings-token-form[\s\S]*grid-template-columns:\s*1fr/);
    expect(mobile).toMatch(/\.settings-reveal-token[\s\S]*(?:max-width:\s*100%|overflow-wrap:\s*anywhere)/);
  });
});
