import React, { type ComponentType, type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountTokenCreateRequestV1,
  AccountTokenCreatedV1,
  AccountV1,
  WalletSessionRequestV1,
  WalletSessionV1,
} from "@proofline/contracts";
import contextSource from "./wallet-session-context.tsx?raw";
import type { WalletAccessServices } from "./services/wallet-access-client";
import {
  PROJECT_TOKEN_SESSION_KEY,
  type StorageLike,
  type WalletSessionSnapshot,
} from "./services/wallet-session-controller";

const CONTEXT_PATH = "./wallet-session-context";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const PROJECT_TOKEN_B = `project_${"c".repeat(64)}`;
const RAW_TOKEN = `project_${"d".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const IDEMPOTENCY_KEY = `token_issue_${"b".repeat(64)}`;
const TOKEN_ID = `token_${"1".repeat(32)}`;
const SESSION_REQUEST: WalletSessionRequestV1 = {
  version: "1",
  challengeId: `challenge_${"e".repeat(64)}`,
  signature: `0x${"11".repeat(65)}`,
};

const request: AccountTokenCreateRequestV1 = {
  version: "1",
  kind: "cli",
  label: "Local CLI",
  expiresInDays: 30,
};
const account: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: PROJECT_ID },
  tokens: [],
};
const refreshed: AccountV1 = {
  ...account,
  tokens: [{
    version: "1",
    tokenId: TOKEN_ID,
    kind: "cli",
    label: "Local CLI",
    createdAt: "2026-08-09T01:00:00.000Z",
    expiresAt: "2026-09-08T01:00:00.000Z",
    revokedAt: null,
  }],
};
const lateAccountA: AccountV1 = {
  ...account,
  tokens: [{
    ...refreshed.tokens[0]!,
    tokenId: `token_${"5".repeat(32)}`,
    label: "Late A account",
  }],
};
const accountB: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS_B },
  project: account.project,
  tokens: [{
    ...refreshed.tokens[0]!,
    tokenId: `token_${"6".repeat(32)}`,
    label: "Current B account",
  }],
};
const created: AccountTokenCreatedV1 = {
  version: "1",
  token: RAW_TOKEN,
  item: refreshed.tokens[0]!,
};
const session: WalletSessionV1 = {
  version: "1",
  wallet: account.wallet,
  project: account.project,
  projectToken: PROJECT_TOKEN,
  issuedAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-09T12:00:00.000Z",
};
function sessionB(projectToken = PROJECT_TOKEN_B): WalletSessionV1 {
  return {
    ...session,
    wallet: accountB.wallet,
    projectToken,
    issuedAt: "2026-08-09T01:00:00.000Z",
    expiresAt: "2026-08-09T13:00:00.000Z",
  };
}

type AccountContextValue = {
  snapshot: WalletSessionSnapshot;
  createAccountToken(input: {
    idempotencyKey: string;
    request: AccountTokenCreateRequestV1;
  }): Promise<AccountTokenCreatedV1>;
  refreshAccount(): Promise<void>;
  createSession(request: WalletSessionRequestV1): Promise<void>;
  forgetBrowser(): void;
};

type ContextModule = {
  WalletSessionProvider: ComponentType<{
    services: WalletAccessServices;
    storage: StorageLike;
    children: ReactNode;
  }>;
  useWalletSession(): AccountContextValue;
};

function memory(initial: string | null) {
  let value = initial;
  return {
    port: {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => { value = next; }),
      removeItem: vi.fn(() => { value = null; }),
    } satisfies StorageLike,
    read: () => value,
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

async function loadContext(): Promise<ContextModule> {
  return import(CONTEXT_PATH) as Promise<ContextModule>;
}

async function renderCapture(access: WalletAccessServices, stored: StorageLike) {
  const { WalletSessionProvider, useWalletSession } = await loadContext();
  let current: AccountContextValue | null = null;
  function Capture() {
    current = useWalletSession();
    const snapshot = current.snapshot;
    const labels = snapshot.status === "authenticated"
      ? snapshot.account?.tokens.map((token) => token.label).join(",") ?? ""
      : "";
    const address = snapshot.status === "authenticated" ? snapshot.wallet.address : "";
    return <output aria-label="session state">{snapshot.status}:{address}:{labels}</output>;
  }
  const rendered = render(
    <WalletSessionProvider services={access} storage={stored}>
      <Capture />
    </WalletSessionProvider>,
  );
  return {
    ...rendered,
    current: () => {
      if (current === null) throw new Error("context was not captured");
      return current;
    },
  };
}

function expectSessionRequired(operation: () => Promise<unknown>) {
  return expect(Promise.resolve().then(operation)).rejects.toMatchObject({
    name: "WalletAccessError",
    kind: "http",
    status: 403,
    code: "ACCOUNT_SESSION_REQUIRED",
    retryable: false,
    message: "Proofline request failed.",
  });
}

function expectIssueBusy(operation: () => Promise<unknown>) {
  return expect(Promise.resolve().then(operation)).rejects.toMatchObject({
    name: "WalletAccessError",
    kind: "http",
    status: 409,
    code: "IDEMPOTENCY_CONFLICT",
    retryable: false,
    message: "Proofline request failed.",
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Slice 023C3A account operations in the wallet session context", () => {
  it("fails closed for create and refresh while anonymous", async () => {
    const access = services();
    const stored = memory(null);
    const rendered = await renderCapture(access, stored.port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent("anonymous::"));

    await expectSessionRequired(() => rendered.current().createAccountToken({
      idempotencyKey: IDEMPOTENCY_KEY,
      request,
    }));
    await expectSessionRequired(() => rendered.current().refreshAccount());
    expect(access.createAccountToken).not.toHaveBeenCalled();
    expect(access.getAccount).not.toHaveBeenCalled();
    expect(stored.read()).toBeNull();
  });

  it("uses only the private browser bearer for create and refreshes strict account evidence", async () => {
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(refreshed);
    const createAccountToken = vi.fn(async () => created);
    const access = services({ getAccount, createAccountToken });
    const stored = memory(PROJECT_TOKEN);
    const rendered = await renderCapture(access, stored.port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:`));

    let result!: AccountTokenCreatedV1;
    await act(async () => {
      result = await rendered.current().createAccountToken({
        idempotencyKey: IDEMPOTENCY_KEY,
        request,
      });
    });
    expect(result).toEqual(created);
    expect(createAccountToken).toHaveBeenCalledWith({
      projectToken: PROJECT_TOKEN,
      idempotencyKey: IDEMPOTENCY_KEY,
      request,
    });
    expect(JSON.stringify(rendered.current().snapshot)).not.toContain(RAW_TOKEN);

    await act(async () => { await rendered.current().refreshAccount(); });
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:Local CLI`));
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(getAccount).toHaveBeenLastCalledWith({ projectToken: PROJECT_TOKEN });
    expect(access.listNetworks).not.toHaveBeenCalled();
    expect(access.createWalletChallenge).not.toHaveBeenCalled();
    expect(access.createWalletSession).not.toHaveBeenCalled();
  });

  it("rejects stale account operations after browser authority is forgotten", async () => {
    const access = services();
    const stored = memory(PROJECT_TOKEN);
    const rendered = await renderCapture(access, stored.port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:`));

    act(() => rendered.current().forgetBrowser());
    expect(screen.getByLabelText("session state")).toHaveTextContent("anonymous::");
    await expectSessionRequired(() => rendered.current().createAccountToken({
      idempotencyKey: IDEMPOTENCY_KEY,
      request,
    }));
    await expectSessionRequired(() => rendered.current().refreshAccount());
    expect(access.createAccountToken).not.toHaveBeenCalled();
    expect(access.getAccount).toHaveBeenCalledOnce();
    expect(stored.read()).toBeNull();
    expect(stored.port.removeItem).toHaveBeenCalledWith(PROJECT_TOKEN_SESSION_KEY);
  });

  it("rejects a late A issue after B authenticates even when B receives the same bearer bytes", async () => {
    const issuedA = deferred<AccountTokenCreatedV1>();
    const createAccountToken = vi.fn(() => issuedA.promise);
    const createWalletSession = vi.fn(async () => sessionB(PROJECT_TOKEN));
    const access = services({ createAccountToken, createWalletSession });
    const stored = memory(PROJECT_TOKEN);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rendered = await renderCapture(access, stored.port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:`));

    const lateIssue = rendered.current().createAccountToken({
      idempotencyKey: IDEMPOTENCY_KEY,
      request,
    });
    expect(createAccountToken).toHaveBeenCalledOnce();
    act(() => rendered.current().forgetBrowser());
    await act(async () => { await rendered.current().createSession(SESSION_REQUEST); });
    expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_B}:`);
    expect(Object.keys(rendered.current())).not.toContain("authorityGeneration");
    expect(JSON.stringify(rendered.current().snapshot)).not.toMatch(/generation/i);
    const publicContextContract = contextSource.match(
      /export type WalletSessionContextValue[\s\S]*?const WalletSessionContext/,
    )?.[0] ?? "";
    expect(publicContextContract).not.toMatch(/generation/i);
    expect(contextSource).not.toMatch(/analytics|ProductAnalytics|\.emit\(/);

    await act(async () => issuedA.resolve(created));
    const outcome = await lateIssue.then(
      (value) => ({ status: "resolved" as const, value }),
      (failure: unknown) => ({ status: "rejected" as const, failure }),
    );
    expect(outcome).toMatchObject({
      status: "rejected",
      failure: {
        name: "WalletAccessError",
        status: 403,
        code: "ACCOUNT_SESSION_REQUIRED",
        message: "Proofline request failed.",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(RAW_TOKEN);
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(rendered.current().snapshot)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(storageWrite.mock.calls)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain(RAW_TOKEN);
  });

  it("separates A and B refresh flights and prevents late A from clearing or updating B", async () => {
    const refreshA = deferred<AccountV1>();
    const refreshB = deferred<AccountV1>();
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockReturnValueOnce(refreshA.promise)
      .mockReturnValueOnce(refreshB.promise);
    const access = services({
      getAccount,
      createWalletSession: vi.fn(async () => sessionB()),
    });
    const rendered = await renderCapture(access, memory(PROJECT_TOKEN).port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:`));

    const flightA = rendered.current().refreshAccount();
    expect(getAccount).toHaveBeenCalledTimes(2);
    act(() => rendered.current().forgetBrowser());
    await act(async () => { await rendered.current().createSession(SESSION_REQUEST); });
    const flightB = rendered.current().refreshAccount();
    expect(flightB).not.toBe(flightA);
    expect(getAccount).toHaveBeenCalledTimes(3);
    expect(getAccount).toHaveBeenLastCalledWith({ projectToken: PROJECT_TOKEN_B });

    await act(async () => refreshA.resolve(lateAccountA));
    await flightA;
    expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_B}:`);
    expect(screen.getByLabelText("session state")).not.toHaveTextContent("Late A account");
    const sameBFlight = rendered.current().refreshAccount();
    expect(sameBFlight).toBe(flightB);
    expect(getAccount).toHaveBeenCalledTimes(3);

    await act(async () => refreshB.resolve(accountB));
    await Promise.all([flightB, sameBFlight]);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_B}:Current B account`));
  });

  it("coalesces concurrent refreshes within one authority generation", async () => {
    const pending = deferred<AccountV1>();
    const getAccount = vi.fn()
      .mockResolvedValueOnce(account)
      .mockReturnValueOnce(pending.promise);
    const rendered = await renderCapture(
      services({ getAccount }),
      memory(PROJECT_TOKEN).port,
    );
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:`));

    const first = rendered.current().refreshAccount();
    const second = rendered.current().refreshAccount();
    expect(second).toBe(first);
    expect(getAccount).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(refreshed));
    await Promise.all([first, second]);
    expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:Local CLI`);
  });

  it("coalesces the same issue intent and rejects a different concurrent intent as busy", async () => {
    const pending = deferred<AccountTokenCreatedV1>();
    const createAccountToken = vi.fn(() => pending.promise);
    const rendered = await renderCapture(
      services({ createAccountToken }),
      memory(PROJECT_TOKEN).port,
    );
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS}:`));
    const intent = { idempotencyKey: IDEMPOTENCY_KEY, request };

    const first = rendered.current().createAccountToken(intent);
    const same = rendered.current().createAccountToken({
      idempotencyKey: IDEMPOTENCY_KEY,
      request: { ...request },
    });
    expect(same).toBe(first);
    expect(createAccountToken).toHaveBeenCalledOnce();
    await expectIssueBusy(() => rendered.current().createAccountToken({
      idempotencyKey: `token_issue_${"f".repeat(64)}`,
      request: { ...request, label: "Other CLI" },
    }));
    expect(createAccountToken).toHaveBeenCalledOnce();

    await act(async () => pending.resolve(created));
    await expect(first).resolves.toEqual(created);
    await expect(same).resolves.toEqual(created);
    expect(JSON.stringify(rendered.current().snapshot)).not.toContain(RAW_TOKEN);
  });
});
