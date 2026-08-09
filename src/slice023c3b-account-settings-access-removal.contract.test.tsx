import React, { type ComponentType, type ReactNode } from "react";
import axe from "axe-core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountTokenCreatedV1,
  AccountTokenRevokedV1,
  AccountTokenSummaryV1,
  AccountV1,
  WalletSessionV1,
} from "@proofline/contracts";
import {
  WalletAccessError,
  type WalletAccessServices,
} from "./services/wallet-access-client";
import {
  PROJECT_TOKEN_SESSION_KEY,
  type StorageLike,
  type WalletSessionSnapshot,
} from "./services/wallet-session-controller";
import stylesSource from "./styles.css?raw";

const SETTINGS_PATH = "./components/AccountSettings";
const CONTEXT_PATH = "./wallet-session-context";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const RAW_TOKEN = `project_${"d".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const active: AccountTokenSummaryV1 = {
  version: "1",
  tokenId: `token_${"1".repeat(32)}`,
  kind: "action",
  label: "Release gate",
  createdAt: "2026-08-09T01:00:00.000Z",
  expiresAt: "2999-08-09T01:00:00.000Z",
  revokedAt: null,
};
const expired: AccountTokenSummaryV1 = {
  version: "1",
  tokenId: `token_${"2".repeat(32)}`,
  kind: "cli",
  label: "Old workstation",
  createdAt: "2026-08-08T01:00:00.000Z",
  expiresAt: "2000-08-09T01:00:00.000Z",
  revokedAt: null,
};
const alreadyRevoked: AccountTokenSummaryV1 = {
  version: "1",
  tokenId: `token_${"3".repeat(32)}`,
  kind: "cli",
  label: "Former laptop",
  createdAt: "2026-08-07T01:00:00.000Z",
  expiresAt: "2999-08-09T01:00:00.000Z",
  revokedAt: "2026-08-08T02:00:00.000Z",
};
const account: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: PROJECT_ID },
  tokens: [active, expired, alreadyRevoked],
};
const revokedAccount: AccountV1 = {
  ...account,
  tokens: account.tokens.map((token) =>
    token.tokenId === active.tokenId
      ? { ...token, revokedAt: "2026-08-09T04:00:00.000Z" }
      : token
  ),
};
const session: WalletSessionV1 = {
  version: "1",
  wallet: account.wallet,
  project: account.project,
  projectToken: PROJECT_TOKEN,
  issuedAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-09T12:00:00.000Z",
};
const revokedResult: AccountTokenRevokedV1 = {
  version: "1",
  tokenId: active.tokenId,
  revoked: true,
};
const created: AccountTokenCreatedV1 = {
  version: "1",
  token: RAW_TOKEN,
  item: {
    ...active,
    tokenId: `token_${"4".repeat(32)}`,
    label: "Late secret",
  },
};

type SettingsModule = {
  AccountSettings: ComponentType<{ onRequireWallet(): void }>;
};
type ContextModule = {
  WalletSessionProvider: ComponentType<{
    services: WalletAccessServices;
    storage: StorageLike;
    children: ReactNode;
  }>;
  useWalletSession(): {
    snapshot: WalletSessionSnapshot;
    signOut(): Promise<void>;
    retry(): Promise<void>;
    forgetBrowser(): void;
  };
};

function storage() {
  let value: string | null = PROJECT_TOKEN;
  const writes: string[] = [];
  return {
    port: {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => { value = next; writes.push(next); }),
      removeItem: vi.fn(() => { value = null; }),
    } satisfies StorageLike,
    read: () => value,
    values: () => [value, ...writes].filter((item): item is string => item !== null),
  };
}

function services(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
  return {
    listNetworks: vi.fn(),
    createWalletChallenge: vi.fn(),
    createWalletSession: vi.fn(async () => session),
    getAccount: vi.fn(async () => account),
    createAccountToken: vi.fn(async () => created),
    revokeAccountToken: vi.fn(async () => revokedResult),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function renderSettings(access = services(), stored = storage()) {
  const [settings, context] = await Promise.all([
    import(SETTINGS_PATH) as Promise<SettingsModule>,
    import(CONTEXT_PATH) as Promise<ContextModule>,
  ]);
  const requireWallet = vi.fn();
  let sessionControl: ReturnType<ContextModule["useWalletSession"]> | null = null;
  function CaptureSession() {
    sessionControl = context.useWalletSession();
    return null;
  }
  const rendered = render(
    <context.WalletSessionProvider services={access} storage={stored.port}>
      <CaptureSession />
      <settings.AccountSettings onRequireWallet={requireWallet} />
    </context.WalletSessionProvider>,
  );
  expect(await screen.findByRole("heading", { name: "Account settings" })).toBeVisible();
  await screen.findByText(ADDRESS);
  return {
    ...rendered,
    access,
    requireWallet,
    stored,
    session: () => {
      if (sessionControl === null) throw new Error("wallet session was not captured");
      return sessionControl;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function failure(input: {
  kind?: "transport" | "http";
  status?: number;
  code?: string;
  retryable?: boolean;
} = {}) {
  return new WalletAccessError({
    kind: input.kind ?? "transport",
    status: input.status ?? 0,
    code: input.code ?? "TRANSPORT_UNAVAILABLE",
    retryable: input.retryable ?? true,
  });
}

async function openSignOut(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { name: "Sign out" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Sign out this browser?" });
  return { dialog, trigger };
}

afterEach(() => {
  window.history.replaceState({}, "", "/settings");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 023C3B Settings access removal", () => {
  it("offers revoke only for non-revoked credentials and exposes one sign-out action without provider work", async () => {
    const rendered = await renderSettings();
    expect(screen.getByRole("button", { name: "Revoke Release gate" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Revoke Old workstation" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Revoke Former laptop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(rendered.access.listNetworks).not.toHaveBeenCalled();
    expect(rendered.access.createWalletChallenge).not.toHaveBeenCalled();
    expect(rendered.access.createWalletSession).not.toHaveBeenCalled();
    const result = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  });

  it("cancels revoke with Escape, restores focus and requires an explicit destructive confirmation", async () => {
    const user = userEvent.setup();
    await renderSettings();
    const trigger = screen.getByRole("button", { name: "Revoke Release gate" });
    await user.click(trigger);
    let dialog = screen.getByRole("dialog", { name: "Revoke Release gate?" });
    expect(within(dialog).getByText(/cannot be used again/i)).toBeVisible();
    expect(dialog).toHaveAccessibleDescription(/cannot be used again/i);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    const openResult = await axe.run(dialog, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(openResult.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Revoke Release gate?" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    dialog = screen.getByRole("dialog", { name: "Revoke Release gate?" });
    const backdrop = document.querySelector(".settings-confirm-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(dialog).toBeVisible();
  });

  it("submits one revoke, waits for refreshed evidence and renders the direct revoked status", async () => {
    const revoked = deferred<AccountTokenRevokedV1>();
    const revokeAccountToken = vi.fn(() => revoked.promise);
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(revokedAccount);
    const user = userEvent.setup();
    const rendered = await renderSettings(services({ getAccount, revokeAccountToken }));
    await user.click(screen.getByRole("button", { name: "Revoke Release gate" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke Release gate?" });
    await user.dblClick(within(dialog).getByRole("button", { name: "Revoke token" }));
    expect(revokeAccountToken).toHaveBeenCalledOnce();
    expect(revokeAccountToken).toHaveBeenCalledWith({
      projectToken: PROJECT_TOKEN,
      tokenId: active.tokenId,
    });
    expect(within(dialog).getByRole("button", { name: "Revoking…" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Revoke Release gate?" })).toBeVisible();

    await act(async () => revoked.resolve(revokedResult));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Revoke Release gate?" })).not.toBeInTheDocument());
    const item = screen.getByText("Release gate").closest("li");
    expect(item).not.toBeNull();
    expect(item).toHaveTextContent(/revoked/i);
    expect(within(item!).queryByRole("button", { name: "Revoke Release gate" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Issued credentials" })).toHaveFocus();
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(rendered.access.createWalletChallenge).not.toHaveBeenCalled();
  });

  it("keeps a failed revoke confirmation retryable with fixed copy and no secret leakage", async () => {
    const revokeAccountToken = vi.fn()
      .mockRejectedValueOnce(new Error(`upstream echo ${RAW_TOKEN}`))
      .mockResolvedValueOnce(revokedResult);
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(revokedAccount);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    const rendered = await renderSettings(services({ getAccount, revokeAccountToken }));
    await user.click(screen.getByRole("button", { name: "Revoke Release gate" }));
    await user.click(screen.getByRole("button", { name: "Revoke token" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Token could not be revoked. Retry safely.");
    expect(alert).not.toHaveTextContent(RAW_TOKEN);
    expect(screen.getByRole("dialog", { name: "Revoke Release gate?" })).toBeVisible();
    const failureResult = await axe.run(screen.getByRole("dialog", { name: "Revoke Release gate?" }), {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(failureResult.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Retry revoke" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Revoke Release gate?" })).not.toBeInTheDocument());
    expect(revokeAccountToken).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    expect(rendered.stored.values()).not.toContain(RAW_TOKEN);
    expect(Object.values(sessionStorage)).not.toContain(RAW_TOKEN);
    expect(Object.values(localStorage)).not.toContain(RAW_TOKEN);
    expect(window.location.href).not.toContain(RAW_TOKEN);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain(RAW_TOKEN);
  });

  it.each(["204", "401", "403"] as const)(
    "clears the current browser authority after a confirmed %s sign-out",
    async (outcome) => {
      const revokeCurrentSession = outcome === "204"
        ? vi.fn(async () => undefined)
        : vi.fn(async () => {
          const status = Number(outcome) as 401 | 403;
          throw failure({
            kind: "http",
            status,
            code: status === 401 ? "UNAUTHORIZED" : "ACCOUNT_SESSION_REQUIRED",
            retryable: false,
          });
        });
      const user = userEvent.setup();
      const rendered = await renderSettings(services({ revokeCurrentSession }));
      const { dialog } = await openSignOut(user);
      expect(dialog).toHaveAccessibleDescription(/browser session|account access/i);
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
      const openResult = await axe.run(dialog, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(openResult.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
      await user.dblClick(within(dialog).getByRole("button", { name: "Sign out browser" }));

      expect(await screen.findByRole("heading", { name: "Sign in to manage access" })).toBeVisible();
      expect(revokeCurrentSession).toHaveBeenCalledOnce();
      expect(revokeCurrentSession).toHaveBeenCalledWith({ projectToken: PROJECT_TOKEN });
      expect(rendered.stored.read()).toBeNull();
      expect(rendered.stored.port.removeItem).toHaveBeenCalledWith(PROJECT_TOKEN_SESSION_KEY);
      expect(rendered.access.listNetworks).not.toHaveBeenCalled();
      expect(rendered.access.createWalletChallenge).not.toHaveBeenCalled();
      expect(rendered.requireWallet).not.toHaveBeenCalled();
    },
  );

  it("cancels sign-out with Escape, keeps the backdrop inert and restores its trigger", async () => {
    const user = userEvent.setup();
    const rendered = await renderSettings();
    let opened = await openSignOut(user);
    expect(within(opened.dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Sign out this browser?" })).not.toBeInTheDocument();
    expect(opened.trigger).toHaveFocus();
    expect(rendered.access.revokeCurrentSession).not.toHaveBeenCalled();

    opened = await openSignOut(user);
    const backdrop = document.querySelector(".settings-confirm-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(opened.dialog).toBeVisible();
    expect(rendered.access.revokeCurrentSession).not.toHaveBeenCalled();
  });

  it("retains authority after transport failure and retries the same sign-out without a wallet prompt", async () => {
    const revokeCurrentSession = vi.fn()
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    const rendered = await renderSettings(services({ revokeCurrentSession }));
    const { dialog } = await openSignOut(user);
    await user.click(within(dialog).getByRole("button", { name: "Sign out browser" }));

    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveTextContent("Sign-out could not be completed. This browser still has account access.");
    expect(rendered.stored.read()).toBe(PROJECT_TOKEN);
    expect(rendered.session().snapshot).toMatchObject({
      status: "unavailable",
      operation: "sign-out",
      reason: "offline",
      safeAction: "retry",
    });
    expect(screen.getByRole("button", { name: "Retry sign-out" })).toHaveFocus();
    const recoveryResult = await axe.run(recovery.closest("main") ?? document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(recoveryResult.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Retry sign-out" }));

    expect(await screen.findByRole("heading", { name: "Sign in to manage access" })).toBeVisible();
    expect(revokeCurrentSession).toHaveBeenCalledTimes(2);
    expect(rendered.stored.read()).toBeNull();
    expect(rendered.access.createWalletChallenge).not.toHaveBeenCalled();
    expect(rendered.access.createWalletSession).not.toHaveBeenCalled();
  });

  it("retains authority after server failure until explicit Forget this browser clears it locally", async () => {
    const revokeCurrentSession = vi.fn(async () => {
      throw failure({ kind: "http", status: 503, code: "HTTP_503" });
    });
    const user = userEvent.setup();
    const rendered = await renderSettings(services({ revokeCurrentSession }));
    const { dialog } = await openSignOut(user);
    await user.click(within(dialog).getByRole("button", { name: "Sign out browser" }));
    expect(await screen.findByText("Sign-out could not be completed. This browser still has account access.")).toBeVisible();
    expect(rendered.stored.read()).toBe(PROJECT_TOKEN);

    await user.click(screen.getByRole("button", { name: "Forget this browser" }));
    expect(await screen.findByRole("heading", { name: "Sign in to manage access" })).toBeVisible();
    expect(rendered.stored.read()).toBeNull();
    expect(revokeCurrentSession).toHaveBeenCalledOnce();
    expect(rendered.access.createWalletChallenge).not.toHaveBeenCalled();
    expect(rendered.access.createWalletSession).not.toHaveBeenCalled();
  });

  it("retains authority after an origin-forbidden 403 sign-out until the user retries or forgets explicitly", async () => {
    const revokeCurrentSession = vi.fn(async () => {
      throw failure({
        kind: "http",
        status: 403,
        code: "AUTH_ORIGIN_FORBIDDEN",
        retryable: false,
      });
    });
    const user = userEvent.setup();
    const rendered = await renderSettings(services({ revokeCurrentSession }));
    const { dialog } = await openSignOut(user);
    await user.click(within(dialog).getByRole("button", { name: "Sign out browser" }));

    expect(await screen.findByText("Sign-out could not be completed. This browser still has account access.")).toBeVisible();
    expect(rendered.session().snapshot).toMatchObject({
      status: "unavailable",
      operation: "sign-out",
      reason: "server",
      code: "AUTH_ORIGIN_FORBIDDEN",
    });
    expect(rendered.stored.read()).toBe(PROJECT_TOKEN);
    expect(screen.getByRole("button", { name: "Retry sign-out" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Forget this browser" })).toBeVisible();
  });

  it("never reveals a late issued secret after sign-out starts even when remote sign-out fails", async () => {
    const issued = deferred<AccountTokenCreatedV1>();
    const revokeCurrentSession = vi.fn(async () => { throw failure(); });
    const browserStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    const rendered = await renderSettings(services({
      createAccountToken: vi.fn(() => issued.promise),
      revokeCurrentSession,
    }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Late secret");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    const { dialog } = await openSignOut(user);
    await user.click(within(dialog).getByRole("button", { name: "Sign out browser" }));
    expect(await screen.findByText("Sign-out could not be completed. This browser still has account access.")).toBeVisible();
    await act(async () => issued.resolve(created));
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole("dialog", { name: "Save this token now" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    expect(rendered.stored.values()).not.toContain(RAW_TOKEN);
    expect(Object.values(sessionStorage)).not.toContain(RAW_TOKEN);
    expect(Object.values(localStorage)).not.toContain(RAW_TOKEN);
    expect(window.location.href).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(browserStorageWrite.mock.calls)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain(RAW_TOKEN);
  });

  it("clears an already visible raw reveal permanently when sign-out starts and then fails", async () => {
    const revokeCurrentSession = vi.fn(async () => { throw failure(); });
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(account);
    const user = userEvent.setup();
    const rendered = await renderSettings(services({ getAccount, revokeCurrentSession }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Visible secret");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("dialog", { name: "Save this token now" })).toHaveTextContent(RAW_TOKEN);

    await act(async () => { await rendered.session().signOut(); });
    expect(await screen.findByText("Sign-out could not be completed. This browser still has account access.")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Save this token now" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    await user.click(screen.getByRole("button", { name: "Retry sign-out" }));
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
  });

  it("keeps destructive token and recovery actions stacked and bounded at the accepted mobile width", () => {
    expect(stylesSource).toMatch(/\.settings-token-actions/);
    expect(stylesSource).toMatch(/\.settings-confirm-actions/);
    expect(stylesSource).toMatch(/\.settings-signout-recovery/);
    expect(stylesSource).toMatch(/\.settings-token-actions[\s\S]*min-height:\s*44px/);
    expect(stylesSource).toMatch(/\.settings-access-confirm[\s\S]*max-height:\s*91dvh[\s\S]*overflow-y:\s*auto/);
    const mobile = stylesSource.match(/@media\s*\(max-width:\s*720px\)[^{]*\{([\s\S]*)$/)?.[1] ?? "";
    expect(mobile).toMatch(/\.settings-token-list\s+li[\s\S]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
    expect(mobile).toMatch(/\.settings-token-actions[\s\S]*grid-column:\s*2\s*\/\s*-1/);
    expect(mobile).toMatch(/\.settings-token-actions[\s\S]*(?:grid-template-columns:\s*1fr|flex-direction:\s*column)/);
    expect(mobile).toMatch(/\.settings-panel-heading[\s\S]*flex-wrap:\s*wrap/);
    expect(mobile).toMatch(/\.settings-confirm-actions[\s\S]*flex-direction:\s*column/);
    expect(mobile).toMatch(/\.settings-signout-recovery[\s\S]*flex-direction:\s*column/);
    expect(mobile).toMatch(/\.settings-confirm-actions\s*>\s*\*[\s\S]*width:\s*100%/);
  });
});
