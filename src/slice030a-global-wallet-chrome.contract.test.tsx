import { readFile } from "node:fs/promises";
import { join } from "node:path";
import axe from "axe-core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountV1, WalletSessionV1 } from "@proofline/contracts";
import { App } from "./App";
import type { WalletAccessServices } from "./services/wallet-access-client";
import type { StorageLike } from "./services/wallet-session-controller";
import type { RunSurfaceServices } from "./services/run-surface";
import { WalletAccessError } from "./services/wallet-access-client";

const TOKEN = `project_${"a".repeat(64)}`;
const ADDRESS = "0x66ecf6be8c2fe4e2060da4884e475c94cbca42dd";
const account: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: "11111111-1111-4111-8111-111111111111" },
  tokens: [],
};
const session: WalletSessionV1 = {
  version: "1",
  wallet: account.wallet,
  project: account.project,
  projectToken: TOKEN,
  issuedAt: "2026-08-13T00:00:00.000Z",
  expiresAt: "2026-08-13T12:00:00.000Z",
};

function storage(initial: string | null): StorageLike {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key, next) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
  };
}

function walletServices(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
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
    createRun: vi.fn(),
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

describe("Slice 030A global wallet session chrome", () => {
  function topbar(): HTMLElement {
    const element = document.querySelector<HTMLElement>(".topbar");
    if (!element) throw new Error("Topbar is unavailable");
    return element;
  }

  it("offers one persistent public sign-in action without loading a wallet provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    render(<App walletAccess={{ services: walletServices(), storage: storage(null) }} />);

    const banner = topbar();
    expect(within(banner).getByRole("button", { name: "Sign in with wallet" })).toBeVisible();
    expect(banner).not.toHaveTextContent(TOKEN);
  });

  it("restores one verified profile on a public route and exposes accessible account actions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const revokeCurrentSession = vi.fn(async () => undefined);
    const stored = storage(TOKEN);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<App walletAccess={{
      services: walletServices({ revokeCurrentSession }),
      storage: stored,
    }} />);

    const profile = await within(topbar()).findByRole("button", {
      name: /wallet profile.*0x66ec.*42dd/i,
    });
    expect(profile).toBeVisible();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    await user.click(profile);
    const menu = screen.getByRole("menu", { name: "Wallet profile" });
    const popover = menu.closest<HTMLElement>(".wallet-profile-menu");
    expect(popover).toHaveTextContent("Verified wallet");
    expect(popover).toHaveTextContent(ADDRESS);
    expect(within(menu).getByRole("menuitem", { name: "Account settings" })).toHaveAttribute("href", "/app/settings");

    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Copy address" })).toHaveFocus());
    await user.click(within(menu).getByRole("menuitem", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(within(menu).getByRole("menuitem", { name: "Address copied" })).toBeVisible();
    await user.tab();
    expect(within(menu).getByRole("menuitem", { name: "Account settings" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Wallet profile" })).not.toBeInTheDocument();
    expect(profile).toHaveFocus();
    await user.click(profile);
    await user.click(document.body);
    expect(screen.queryByRole("menu", { name: "Wallet profile" })).not.toBeInTheDocument();
    await user.click(profile);

    await user.click(within(screen.getByRole("menu", { name: "Wallet profile" })).getByRole("menuitem", { name: "Sign out" }));
    expect(screen.getByRole("dialog", { name: "Sign out this browser?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm sign out" }));
    await waitFor(() => expect(revokeCurrentSession).toHaveBeenCalledWith({ projectToken: TOKEN }));
    expect(stored.removeItem).toHaveBeenCalledWith("proofline:project-token");
    const successor = await within(topbar()).findByRole("button", { name: "Sign in with wallet" });
    expect(successor).toBeVisible();
    expect(successor).toHaveFocus();
  });

  it("uses the restored wallet authority in Composer without a duplicate sign-in action", async () => {
    window.history.replaceState({}, "", "/app/runs/new?step=source");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    render(<App
      services={surfaces()}
      walletAccess={{ services: walletServices(), storage: storage(TOKEN) }}
    />);

    expect(await within(topbar()).findByRole("button", {
      name: /wallet profile.*0x66ec.*42dd/i,
    })).toBeVisible();
    const composer = screen.getByRole("region", { name: "Choose the public response" });
    expect(within(composer).queryByRole("button", { name: "Sign in with wallet" }))
      .not.toBeInTheDocument();
    expect(within(composer).getByRole("link", { name: "Browse templates" }))
      .toHaveAttribute("href", "/templates");
  });

  it("shows restoring and retry states without mistaking them for an authenticated identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    let rejectRestore!: (cause: unknown) => void;
    const getAccount = vi.fn(() => new Promise<AccountV1>((_resolve, reject) => {
      rejectRestore = reject;
    }));
    render(<App walletAccess={{
      services: walletServices({ getAccount }),
      storage: storage(TOKEN),
    }} />);

    expect(await within(topbar()).findByRole("status")).toHaveTextContent("Restoring");
    rejectRestore(new WalletAccessError({
      kind: "transport",
      status: 0,
      code: "TRANSPORT_UNAVAILABLE",
      retryable: true,
    }));
    expect(await within(topbar()).findByRole("button", { name: "Retry session" })).toBeVisible();
    expect(within(topbar()).queryByRole("button", { name: /wallet profile/i })).not.toBeInTheDocument();
  });

  it("keeps failed sign-out explicit until retry or local browser forgetting", async () => {
    window.history.replaceState({}, "", "/app/settings");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const revokeCurrentSession = vi.fn(async () => {
      throw new WalletAccessError({
        kind: "transport",
        status: 0,
        code: "TRANSPORT_UNAVAILABLE",
        retryable: true,
      });
    });
    const user = userEvent.setup();
    render(<App walletAccess={{
      services: walletServices({ revokeCurrentSession }),
      storage: storage(TOKEN),
    }} />);

    const profile = await within(topbar()).findByRole("button", { name: /wallet profile/i });
    await user.click(profile);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Confirm sign out" }));
    const dialog = screen.getByRole("dialog", { name: "Sign out this browser?" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Server sign out is unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry sign-out" })).toBeVisible();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.click(within(dialog).getByRole("button", { name: "Forget this browser" }));
    const successor = await within(topbar()).findByRole("button", { name: "Sign in with wallet" });
    expect(successor).toBeVisible();
    expect(successor).toHaveFocus();
  });

  it("keeps the authenticated wallet menu free of serious or critical axe violations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const user = userEvent.setup();
    render(<App walletAccess={{ services: walletServices(), storage: storage(TOKEN) }} />);

    await user.click(await within(topbar()).findByRole("button", { name: /wallet profile/i }));
    const menu = screen.getByRole("menu", { name: "Wallet profile" });
    const results = await axe.run(menu);
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });

  it("traps forward and reverse Tab focus inside the sign-out confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const user = userEvent.setup();
    render(<App walletAccess={{ services: walletServices(), storage: storage(TOKEN) }} />);

    await user.click(await within(topbar()).findByRole("button", { name: /wallet profile/i }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    const dialog = screen.getByRole("dialog", { name: "Sign out this browser?" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("keeps caller project-token authority neutral and never restores or exposes the wallet profile", async () => {
    window.history.replaceState({}, "", "/app/runs");
    const getAccount = vi.fn(async () => account);
    render(<App
      projectToken={TOKEN}
      services={surfaces()}
      walletAccess={{ services: walletServices({ getAccount }), storage: storage(TOKEN) }}
    />);

    expect(await within(topbar()).findByText("Token access")).toBeVisible();
    expect(within(topbar()).queryByRole("button", { name: /wallet profile|sign in/i })).not.toBeInTheDocument();
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("switches ordinary caller-token authority without attempting browser restoration", async () => {
    window.history.replaceState({}, "", "/app/runs");
    const getAccount = vi.fn(async () => account);
    const fixture = render(<App
      services={surfaces()}
      walletAccess={{ services: walletServices({ getAccount }), storage: storage(TOKEN) }}
    />);

    expect(await within(topbar()).findByRole("button", { name: /wallet profile/i })).toBeVisible();
    expect(getAccount).toHaveBeenCalledOnce();
    fixture.rerender(<App
      projectToken={TOKEN}
      services={surfaces()}
      walletAccess={{ services: walletServices({ getAccount }), storage: storage(TOKEN) }}
    />);
    expect(within(topbar()).queryByRole("button", { name: /wallet profile|sign in/i })).not.toBeInTheDocument();
    expect(await within(topbar()).findByText("Token access")).toBeVisible();
    expect(within(topbar()).queryByRole("button", { name: /wallet profile|sign in/i })).not.toBeInTheDocument();
  });

  it("keeps share authority neutral and excludes wallet restoration and secret text", async () => {
    const shareToken = `share_${"b".repeat(64)}`;
    const runId = "11111111-1111-4111-8111-111111111111";
    window.history.replaceState({}, "", `/app/runs/${runId}#share=${shareToken}`);
    const getAccount = vi.fn(async () => account);
    render(<App
      services={surfaces()}
      walletAccess={{ services: walletServices({ getAccount }), storage: storage(TOKEN) }}
    />);

    expect(await within(topbar()).findByText("Shared access")).toBeVisible();
    expect(getAccount).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(shareToken);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("restores ordinary wallet authority after history leaves an exact share run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const shareToken = `share_${"c".repeat(64)}`;
    const runId = "11111111-1111-4111-8111-111111111111";
    window.history.replaceState({}, "", `/app/runs/${runId}#share=${shareToken}`);
    const getAccount = vi.fn(async () => account);
    render(<App
      services={surfaces()}
      walletAccess={{ services: walletServices({ getAccount }), storage: storage(TOKEN) }}
    />);

    expect(await within(topbar()).findByText("Shared access")).toBeVisible();
    expect(getAccount).not.toHaveBeenCalled();
    window.history.pushState({}, "", "/");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(await within(topbar()).findByRole("button", { name: /wallet profile/i })).toBeVisible();
    expect(getAccount).toHaveBeenCalledOnce();
  });

  it("freezes separate wide and mobile layout contracts for the wallet-security CTA", async () => {
    const css = await readFile(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\.landing-wallet-security\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/s);
    expect(css).toMatch(/\.landing-wallet-security\s+\.entry-primary\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.landing-wallet-security\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.wallet-profile-address\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*\.topbar-right\s*\{[^}]*display:\s*flex/s);
  });
});
