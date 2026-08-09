import React, { type ComponentType, type ReactNode } from "react";
import axe from "axe-core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountTokenCreatedV1,
  AccountTokenSummaryV1,
  AccountV1,
  WalletSessionRequestV1,
  WalletSessionV1,
} from "@proofline/contracts";
import type { WalletAccessServices } from "./services/wallet-access-client";
import type { StorageLike } from "./services/wallet-session-controller";

const SETTINGS_PATH = "./components/AccountSettings";
const CONTEXT_PATH = "./wallet-session-context";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const RAW_TOKEN = `project_${"d".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_REQUEST: WalletSessionRequestV1 = {
  version: "1",
  challengeId: `challenge_${"e".repeat(64)}`,
  signature: `0x${"11".repeat(65)}`,
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
    snapshot: unknown;
    createSession(request: WalletSessionRequestV1): Promise<void>;
    forgetBrowser(): void;
  };
};

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
const revoked: AccountTokenSummaryV1 = {
  version: "1",
  tokenId: `token_${"3".repeat(32)}`,
  kind: "cli",
  label: "Former laptop",
  createdAt: "2026-08-07T01:00:00.000Z",
  expiresAt: "2999-08-09T01:00:00.000Z",
  revokedAt: "2026-08-08T02:00:00.000Z",
};
const createdItem: AccountTokenSummaryV1 = {
  version: "1",
  tokenId: `token_${"4".repeat(32)}`,
  kind: "action",
  label: "Release Bot",
  createdAt: "2026-08-09T02:00:00.000Z",
  expiresAt: "2026-09-23T02:00:00.000Z",
  revokedAt: null,
};

const account: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: PROJECT_ID },
  tokens: [active, expired, revoked],
};
const refreshedAccount: AccountV1 = {
  ...account,
  tokens: [createdItem, active, expired, revoked],
};
const accountB: AccountV1 = {
  ...account,
  wallet: { kind: "eoa", address: ADDRESS_B },
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
const sameBearerSessionB: WalletSessionV1 = {
  ...session,
  wallet: accountB.wallet,
  issuedAt: "2026-08-09T01:00:00.000Z",
  expiresAt: "2026-08-09T13:00:00.000Z",
};
const created: AccountTokenCreatedV1 = {
  version: "1",
  token: RAW_TOKEN,
  item: createdItem,
};

let restoreClipboardDescriptor: (() => void) | undefined;

function installClipboardWriteText(
  writeText = vi.fn(async (_value: string) => undefined),
) {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value: { writeText },
  });
  restoreClipboardDescriptor = () => {
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  };
  return writeText;
}

function installUnavailableClipboard() {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value: undefined,
  });
  restoreClipboardDescriptor = () => {
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function storage() {
  let value: string | null = PROJECT_TOKEN;
  const writes: string[] = [];
  return {
    port: {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => { value = next; writes.push(next); }),
      removeItem: vi.fn(() => { value = null; }),
    } satisfies StorageLike,
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
    revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function loadUi() {
  const [settings, context] = await Promise.all([
    import(SETTINGS_PATH) as Promise<SettingsModule>,
    import(CONTEXT_PATH) as Promise<ContextModule>,
  ]);
  return { ...settings, ...context };
}

async function renderSettings(access = services(), stored = storage()) {
  const { AccountSettings, WalletSessionProvider, useWalletSession } = await loadUi();
  const requireWallet = vi.fn();
  let sessionControl: ReturnType<ContextModule["useWalletSession"]> | null = null;
  function CaptureSession() {
    sessionControl = useWalletSession();
    return null;
  }
  const rendered = render(
    <WalletSessionProvider services={access} storage={stored.port}>
      <CaptureSession />
      <AccountSettings onRequireWallet={requireWallet} />
    </WalletSessionProvider>,
  );
  expect(await screen.findByRole("heading", { name: "Account settings" })).toBeVisible();
  return {
    ...rendered,
    access,
    stored,
    requireWallet,
    session: () => {
      if (sessionControl === null) throw new Error("wallet session was not captured");
      return sessionControl;
    },
  };
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByRole("combobox", { name: "Token kind" }), "action");
  await user.clear(screen.getByRole("textbox", { name: "Label" }));
  await user.type(screen.getByRole("textbox", { name: "Label" }), "  Release Bot  ");
  await user.clear(screen.getByRole("spinbutton", { name: "Expires in days" }));
  await user.type(screen.getByRole("spinbutton", { name: "Expires in days" }), "45");
}

afterEach(() => {
  restoreClipboardDescriptor?.();
  restoreClipboardDescriptor = undefined;
  window.history.replaceState({}, "", "/settings");
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 023C3A authenticated account Settings", () => {
  it("shows wallet identity and ordered active, expired and revoked summaries without another wallet prompt", async () => {
    const user = userEvent.setup();
    const writeText = installClipboardWriteText();
    const rendered = await renderSettings();
    expect(screen.getByText(ADDRESS)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Copy wallet address" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(ADDRESS);

    const list = screen.getByRole("list", { name: "Access tokens" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/Release gate.*action.*active/i),
      expect.stringMatching(/Old workstation.*cli.*expired/i),
      expect.stringMatching(/Former laptop.*cli.*revoked/i),
    ]);
    expect(screen.queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    const result = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  });

  it("validates locally, trims the label and submits one stable exact idempotent attempt", async () => {
    const pending = deferred<AccountTokenCreatedV1>();
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(refreshedAccount);
    const createAccountToken = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    const rendered = await renderSettings(services({ getAccount, createAccountToken }));

    expect(screen.getByRole("combobox", { name: "Token kind" })).toHaveValue("cli");
    expect(screen.getByRole("spinbutton", { name: "Expires in days" })).toHaveValue(30);
    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), { target: { value: "   " } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Expires in days" }), { target: { value: "1.5" } });
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(createAccountToken).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    const invalidLabel = screen.getByRole("textbox", { name: "Label" });
    const invalidDays = screen.getByRole("spinbutton", { name: "Expires in days" });
    expect(invalidLabel).toHaveFocus();
    expect(invalidLabel).toHaveAttribute("aria-invalid", "true");
    expect(invalidLabel).toHaveAccessibleDescription(/1.*128/i);
    expect(invalidDays).toHaveAttribute("aria-invalid", "true");
    expect(invalidDays).toHaveAccessibleDescription(/integer.*1.*90/i);

    await fillValidForm(user);
    await user.dblClick(screen.getByRole("button", { name: "Generate" }));
    expect(createAccountToken).toHaveBeenCalledOnce();
    expect(createAccountToken).toHaveBeenCalledWith({
      projectToken: PROJECT_TOKEN,
      idempotencyKey: expect.stringMatching(/^token_issue_[a-f0-9]{64}$/),
      request: { version: "1", kind: "action", label: "Release Bot", expiresInDays: 45 },
    });

    await act(async () => pending.resolve(created));
    expect(await screen.findByRole("dialog", { name: "Save this token now" })).toBeVisible();
    await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Release Bot")).toBeVisible();
    expect(rendered.access.listNetworks).not.toHaveBeenCalled();
    expect(rendered.requireWallet).not.toHaveBeenCalled();
  });

  it("protects the one-time reveal until copy, then closes, clears and restores focus", async () => {
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(refreshedAccount);
    const stored = storage();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    const writeText = installClipboardWriteText();
    const browserStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    await renderSettings(services({ getAccount }), stored);
    await fillValidForm(user);
    const generate = screen.getByRole("button", { name: "Generate" });
    await user.click(generate);

    let dialog = await screen.findByRole("dialog", { name: "Save this token now" });
    const token = within(dialog).getByRole("textbox", { name: "Generated project token" });
    const copy = within(dialog).getByRole("button", { name: "Copy" });
    expect(token).toHaveAttribute("aria-readonly", "true");
    expect(token).toHaveTextContent(RAW_TOKEN);
    expect(within(dialog).getByText("PROOFLINE_PROJECT_TOKEN")).toBeVisible();
    expect(copy).toHaveFocus();
    const backdrop = document.querySelector(".settings-token-reveal-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.getByRole("dialog", { name: "Save this token now" })).toBeVisible();

    await user.keyboard("{Escape}");
    dialog = screen.getByRole("dialog", { name: "Close without copying?" });
    expect(within(dialog).getByText(/cannot show this token again/i)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Keep token visible" }));
    await user.click(screen.getByRole("button", { name: "Close token reveal" }));
    dialog = screen.getByRole("dialog", { name: "Close without copying?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep token visible" }));

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(RAW_TOKEN);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(generate).toHaveFocus();
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    expect(stored.values()).not.toContain(RAW_TOKEN);
    expect(Object.values(sessionStorage)).not.toContain(RAW_TOKEN);
    expect(Object.values(localStorage)).not.toContain(RAW_TOKEN);
    expect(window.location.href).not.toContain(RAW_TOKEN);
    for (const element of document.querySelectorAll("*")) {
      for (const attribute of element.attributes) expect(attribute.value).not.toContain(RAW_TOKEN);
    }
    for (const spy of [log, warn, error, replace, push, browserStorageWrite]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(RAW_TOKEN);
    }
  });

  it("retains the form and renders only fixed safe copy when issuance fails", async () => {
    let attempt = 0;
    const createAccountToken = vi.fn<WalletAccessServices["createAccountToken"]>(() => {
      attempt += 1;
      if (attempt === 1) throw new Error(`sync echo ${RAW_TOKEN}`);
      if (attempt === 2) return Promise.reject(new Error(`async echo ${RAW_TOKEN}`));
      return Promise.resolve(created);
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    await renderSettings(services({ createAccountToken }));
    await fillValidForm(user);
    for (const expectedAttempt of [1, 2]) {
      await user.click(screen.getByRole("button", { name: "Generate" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Token could not be generated. Retry safely.");
      expect(alert).not.toHaveTextContent(RAW_TOKEN);
      expect(createAccountToken).toHaveBeenCalledTimes(expectedAttempt);
      expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("  Release Bot  ");
      expect(screen.getByRole("spinbutton", { name: "Expires in days" })).toHaveValue(45);
    }
    const keys = createAccountToken.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => /^token_issue_[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(2);
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(error.mock.calls)).not.toContain(RAW_TOKEN);

    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("dialog", { name: "Save this token now" })).toBeVisible();
    const thirdKey = createAccountToken.mock.calls[2]![0].idempotencyKey;
    expect(thirdKey).toMatch(/^token_issue_[a-f0-9]{64}$/);
    expect(keys).not.toContain(thirdKey);
  });

  it("keeps a rejected clipboard copy safe, visible and explicitly confirmable", async () => {
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(refreshedAccount);
    const stored = storage();
    const user = userEvent.setup();
    const writeText = installClipboardWriteText(
      vi.fn(async () => { throw new DOMException(`denied ${RAW_TOKEN}`, "NotAllowedError"); }),
    );
    const browserStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderSettings(services({ getAccount }), stored);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));

    const reveal = await screen.findByRole("dialog", { name: "Save this token now" });
    await user.click(within(reveal).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(RAW_TOKEN);
    const alert = within(reveal).getByRole("alert");
    expect(alert).toHaveTextContent("Token was not copied. Keep this dialog open and try again.");
    expect(alert).not.toHaveTextContent(RAW_TOKEN);
    expect(within(reveal).getByRole("textbox", { name: "Generated project token" })).toHaveTextContent(RAW_TOKEN);

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Close without copying?" })).toBeVisible();
    expect(stored.values()).not.toContain(RAW_TOKEN);
    expect(Object.values(sessionStorage)).not.toContain(RAW_TOKEN);
    expect(Object.values(localStorage)).not.toContain(RAW_TOKEN);
    expect(window.location.href).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(browserStorageWrite.mock.calls)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(error.mock.calls)).not.toContain(RAW_TOKEN);
    for (const element of document.querySelectorAll("*")) {
      for (const attribute of element.attributes) expect(attribute.value).not.toContain(RAW_TOKEN);
    }
  });

  it("keeps manual one-time recovery available when the Clipboard API is absent", async () => {
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(refreshedAccount);
    const user = userEvent.setup();
    installUnavailableClipboard();
    await renderSettings(services({ getAccount }));
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));

    const reveal = await screen.findByRole("dialog", { name: "Save this token now" });
    expect(within(reveal).getByRole("button", { name: "Copy unavailable" })).toBeDisabled();
    expect(within(reveal).getByText("Clipboard access is unavailable. Copy the token manually.")).toBeVisible();
    expect(within(reveal).getByRole("textbox", { name: "Generated project token" })).toHaveTextContent(RAW_TOKEN);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Close without copying?" })).toBeVisible();
  });

  it("ignores a late issued secret after Settings unmount without refresh or leakage", async () => {
    const pending = deferred<AccountTokenCreatedV1>();
    const getAccount = vi.fn(async () => account);
    const createAccountToken = vi.fn(() => pending.promise);
    const stored = storage();
    const browserStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    const rendered = await renderSettings(
      services({ getAccount, createAccountToken }),
      stored,
    );
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(createAccountToken).toHaveBeenCalledOnce();

    rendered.unmount();
    await act(async () => pending.resolve(created));
    await act(async () => { await Promise.resolve(); });
    expect(getAccount).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    expect(stored.values()).not.toContain(RAW_TOKEN);
    expect(Object.values(sessionStorage)).not.toContain(RAW_TOKEN);
    expect(Object.values(localStorage)).not.toContain(RAW_TOKEN);
    expect(window.location.href).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(browserStorageWrite.mock.calls)).not.toContain(RAW_TOKEN);
  });

  it("never reveals or refreshes a late A issue after B authenticates with the same bearer bytes", async () => {
    const issuedA = deferred<AccountTokenCreatedV1>();
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(accountB);
    const createAccountToken = vi.fn(() => issuedA.promise);
    const createWalletSession = vi.fn(async () => sameBearerSessionB);
    const stored = storage();
    const browserStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    const rendered = await renderSettings(
      services({ getAccount, createAccountToken, createWalletSession }),
      stored,
    );
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(createAccountToken).toHaveBeenCalledOnce();

    act(() => rendered.session().forgetBrowser());
    await act(async () => { await rendered.session().createSession(SESSION_REQUEST); });
    expect(await screen.findByText(ADDRESS_B)).toBeVisible();
    await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(2));
    expect(getAccount).toHaveBeenLastCalledWith({ projectToken: PROJECT_TOKEN });

    await act(async () => issuedA.resolve(created));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog", { name: "Save this token now" })).not.toBeInTheDocument();
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    expect(document.body.textContent).not.toMatch(/authority generation/i);
    expect(stored.values()).not.toContain(RAW_TOKEN);
    expect(Object.values(sessionStorage)).not.toContain(RAW_TOKEN);
    expect(Object.values(localStorage)).not.toContain(RAW_TOKEN);
    expect(window.location.href).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(browserStorageWrite.mock.calls)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain(RAW_TOKEN);
  });
});
