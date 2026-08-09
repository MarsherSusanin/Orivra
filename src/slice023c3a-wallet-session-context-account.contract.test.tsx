import React, { type ComponentType, type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountTokenCreateRequestV1,
  AccountTokenCreatedV1,
  AccountV1,
  WalletSessionV1,
} from "@proofline/contracts";
import type { WalletAccessServices } from "./services/wallet-access-client";
import {
  PROJECT_TOKEN_SESSION_KEY,
  type StorageLike,
  type WalletSessionSnapshot,
} from "./services/wallet-session-controller";

const CONTEXT_PATH = "./wallet-session-context";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const RAW_TOKEN = `project_${"d".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const IDEMPOTENCY_KEY = `token_issue_${"b".repeat(64)}`;
const TOKEN_ID = `token_${"1".repeat(32)}`;

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

type AccountContextValue = {
  snapshot: WalletSessionSnapshot;
  createAccountToken(input: {
    idempotencyKey: string;
    request: AccountTokenCreateRequestV1;
  }): Promise<AccountTokenCreatedV1>;
  refreshAccount(): Promise<void>;
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
    return <output aria-label="session state">{snapshot.status}:{labels}</output>;
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Slice 023C3A account operations in the wallet session context", () => {
  it("fails closed for create and refresh while anonymous", async () => {
    const access = services();
    const stored = memory(null);
    const rendered = await renderCapture(access, stored.port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent("anonymous:"));

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
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent("authenticated:"));

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
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent("authenticated:Local CLI"));
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
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent("authenticated:"));

    act(() => rendered.current().forgetBrowser());
    expect(screen.getByLabelText("session state")).toHaveTextContent("anonymous:");
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
});
