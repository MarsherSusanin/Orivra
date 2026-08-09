import React, { type ComponentType, type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountTokenCreateRequestV1,
  AccountTokenCreatedV1,
  AccountTokenRevokedV1,
  AccountV1,
  WalletSessionRequestV1,
  WalletSessionV1,
} from "@proofline/contracts";
import type { WalletAccessServices } from "./services/wallet-access-client";
import { WalletAccessError } from "./services/wallet-access-client";
import type {
  StorageLike,
  WalletSessionSnapshot,
} from "./services/wallet-session-controller";

const CONTEXT_PATH = "./wallet-session-context";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_A = `token_${"1".repeat(32)}`;
const TOKEN_B = `token_${"2".repeat(32)}`;
const IDEMPOTENCY_KEY = `token_issue_${"b".repeat(64)}`;
const RAW_TOKEN = `project_${"d".repeat(64)}`;
const SESSION_REQUEST: WalletSessionRequestV1 = {
  version: "1",
  challengeId: `challenge_${"e".repeat(64)}`,
  signature: `0x${"11".repeat(65)}`,
};

const accountA: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS_A },
  project: { kind: "default", projectId: PROJECT_ID },
  tokens: [
    {
      version: "1",
      tokenId: TOKEN_A,
      kind: "cli",
      label: "Local CLI",
      createdAt: "2026-08-09T01:00:00.000Z",
      expiresAt: "2999-09-08T01:00:00.000Z",
      revokedAt: null,
    },
    {
      version: "1",
      tokenId: TOKEN_B,
      kind: "action",
      label: "Release gate",
      createdAt: "2026-08-09T02:00:00.000Z",
      expiresAt: "2999-09-08T02:00:00.000Z",
      revokedAt: null,
    },
  ],
};
const revokedAccountA: AccountV1 = {
  ...accountA,
  tokens: accountA.tokens.map((token) =>
    token.tokenId === TOKEN_A
      ? { ...token, revokedAt: "2026-08-09T03:00:00.000Z" }
      : token
  ),
};
const accountB: AccountV1 = {
  ...accountA,
  wallet: { kind: "eoa", address: ADDRESS_B },
  tokens: [{ ...accountA.tokens[1]!, label: "Current B token" }],
};
const sessionA: WalletSessionV1 = {
  version: "1",
  wallet: accountA.wallet,
  project: accountA.project,
  projectToken: PROJECT_TOKEN,
  issuedAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-09T12:00:00.000Z",
};
const sameBearerSessionB: WalletSessionV1 = {
  ...sessionA,
  wallet: accountB.wallet,
  issuedAt: "2026-08-09T04:00:00.000Z",
  expiresAt: "2026-08-09T16:00:00.000Z",
};
const revokedResult: AccountTokenRevokedV1 = {
  version: "1",
  tokenId: TOKEN_A,
  revoked: true,
};
const issueRequest: AccountTokenCreateRequestV1 = {
  version: "1",
  kind: "cli",
  label: "Concurrent CLI",
  expiresInDays: 30,
};
const createdResult: AccountTokenCreatedV1 = {
  version: "1",
  token: RAW_TOKEN,
  item: {
    ...accountA.tokens[0]!,
    tokenId: `token_${"4".repeat(32)}`,
    label: issueRequest.label,
  },
};

type RevokeContextValue = {
  snapshot: WalletSessionSnapshot;
  revokeAccountToken(tokenId: string): Promise<void>;
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
  useWalletSession(): RevokeContextValue;
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
    createWalletSession: vi.fn(async () => sessionA),
    getAccount: vi.fn(async () => accountA),
    createAccountToken: vi.fn(),
    revokeAccountToken: vi.fn(async () => revokedResult),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function renderCapture(access: WalletAccessServices, storage: StorageLike) {
  const module = await import(CONTEXT_PATH) as ContextModule;
  let current: RevokeContextValue | null = null;
  function Capture() {
    current = module.useWalletSession();
    const snapshot = current.snapshot;
    const account = snapshot.status === "authenticated" ? snapshot.account : undefined;
    const tokenEvidence = account?.tokens.map((token) =>
      `${token.label}:${token.revokedAt === null ? "present" : "revoked"}`
    ).join(",") ?? "";
    const address = snapshot.status === "authenticated" ? snapshot.wallet.address : "";
    return <output aria-label="session state">{snapshot.status}:{address}:{tokenEvidence}</output>;
  }
  const rendered = render(
    <module.WalletSessionProvider services={access} storage={storage}>
      <Capture />
    </module.WalletSessionProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return {
    ...rendered,
    current: () => {
      if (current === null) throw new Error("context was not captured");
      return current;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
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

function expectBusy(operation: () => Promise<unknown>) {
  return expect(Promise.resolve().then(operation)).rejects.toMatchObject({
    name: "WalletAccessError",
    kind: "http",
    status: 409,
    code: "IDEMPOTENCY_CONFLICT",
    retryable: false,
    message: "Proofline request failed.",
  });
}

function expectContractFailure(operation: () => Promise<unknown>) {
  return expect(Promise.resolve().then(operation)).rejects.toMatchObject({
    name: "WalletAccessError",
    kind: "contract",
    status: 502,
    code: "AUTH_RESPONSE_INVALID",
    retryable: false,
    message: "Proofline returned an invalid response.",
  });
}

function invalidAuthority(status: 401 | 403) {
  return new WalletAccessError({
    kind: "http",
    status,
    code: status === 401 ? "UNAUTHORIZED" : "ACCOUNT_SESSION_REQUIRED",
    retryable: false,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Slice 023C3B generation-bound account token revocation", () => {
  it("fails closed while anonymous without calling the account service", async () => {
    const access = services();
    const stored = memory(null);
    const rendered = await renderCapture(access, stored.port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent("anonymous::"));

    await expectSessionRequired(() => rendered.current().revokeAccountToken(TOKEN_A));
    expect(access.revokeAccountToken).not.toHaveBeenCalled();
    expect(access.getAccount).not.toHaveBeenCalled();
    expect(stored.read()).toBeNull();
  });

  it("coalesces the same target, rejects a different target as busy and resolves only after refreshed revoked evidence", async () => {
    const revoked = deferred<AccountTokenRevokedV1>();
    const refreshed = deferred<AccountV1>();
    const revokeAccountToken = vi.fn(() => revoked.promise);
    const getAccount = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockReturnValueOnce(refreshed.promise);
    const access = services({ getAccount, revokeAccountToken });
    const rendered = await renderCapture(access, memory(PROJECT_TOKEN).port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}:Local CLI:present`));

    const first = rendered.current().revokeAccountToken(TOKEN_A);
    const same = rendered.current().revokeAccountToken(TOKEN_A);
    expect(same).toBe(first);
    expect(revokeAccountToken).toHaveBeenCalledOnce();
    expect(revokeAccountToken).toHaveBeenCalledWith({
      projectToken: PROJECT_TOKEN,
      tokenId: TOKEN_A,
    });
    await expectBusy(() => rendered.current().revokeAccountToken(TOKEN_B));
    expect(revokeAccountToken).toHaveBeenCalledOnce();

    let settled = false;
    void first.finally(() => { settled = true; });
    await act(async () => revoked.resolve(revokedResult));
    await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    expect(screen.getByLabelText("session state")).toHaveTextContent("Local CLI:present");

    await act(async () => refreshed.resolve(revokedAccountA));
    await expect(first).resolves.toBeUndefined();
    await expect(same).resolves.toBeUndefined();
    expect(screen.getByLabelText("session state")).toHaveTextContent("Local CLI:revoked");
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(access.listNetworks).not.toHaveBeenCalled();
    expect(access.createWalletChallenge).not.toHaveBeenCalled();
    expect(access.createWalletSession).not.toHaveBeenCalled();
  });

  it("rejects revoke locally while a different issue mutation owns the generation lane", async () => {
    const issued = deferred<AccountTokenCreatedV1>();
    const createAccountToken = vi.fn(() => issued.promise);
    const revokeAccountToken = vi.fn(async () => revokedResult);
    const rendered = await renderCapture(
      services({ createAccountToken, revokeAccountToken }),
      memory(PROJECT_TOKEN).port,
    );
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}`));

    const issue = rendered.current().createAccountToken({
      idempotencyKey: IDEMPOTENCY_KEY,
      request: issueRequest,
    });
    await expectBusy(() => rendered.current().revokeAccountToken(TOKEN_A));
    expect(createAccountToken).toHaveBeenCalledOnce();
    expect(revokeAccountToken).not.toHaveBeenCalled();

    await act(async () => issued.resolve(createdResult));
    await expect(issue).resolves.toEqual(createdResult);
  });

  it("rejects issue locally while a revoke mutation owns the generation lane", async () => {
    const revoked = deferred<AccountTokenRevokedV1>();
    const createAccountToken = vi.fn(async () => createdResult);
    const revokeAccountToken = vi.fn(() => revoked.promise);
    const getAccount = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(revokedAccountA);
    const rendered = await renderCapture(
      services({ createAccountToken, getAccount, revokeAccountToken }),
      memory(PROJECT_TOKEN).port,
    );
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}`));

    const revoke = rendered.current().revokeAccountToken(TOKEN_A);
    await expectBusy(() => rendered.current().createAccountToken({
      idempotencyKey: IDEMPOTENCY_KEY,
      request: issueRequest,
    }));
    expect(revokeAccountToken).toHaveBeenCalledOnce();
    expect(createAccountToken).not.toHaveBeenCalled();

    await act(async () => revoked.resolve(revokedResult));
    await expect(revoke).resolves.toBeUndefined();
  });

  it("rejects a late A result before refresh after same-bearer B becomes current", async () => {
    const revoked = deferred<AccountTokenRevokedV1>();
    const revokeAccountToken = vi.fn(() => revoked.promise);
    const getAccount = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(accountB);
    const access = services({
      getAccount,
      revokeAccountToken,
      createWalletSession: vi.fn(async () => sameBearerSessionB),
    });
    const rendered = await renderCapture(access, memory(PROJECT_TOKEN).port);
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}`));

    const lateA = rendered.current().revokeAccountToken(TOKEN_A);
    act(() => rendered.current().forgetBrowser());
    await act(async () => { await rendered.current().createSession(SESSION_REQUEST); });
    await act(async () => { await rendered.current().refreshAccount(); });
    expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_B}:Current B token:present`);

    await act(async () => revoked.resolve(revokedResult));
    await expectSessionRequired(() => lateA);
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_B}:Current B token:present`);
    expect(screen.getByLabelText("session state")).not.toHaveTextContent("Local CLI:revoked");
    expect(JSON.stringify(rendered.current().snapshot)).not.toMatch(/generation|authority/i);
  });

  it.each([
    {
      label: "mismatched service target",
      result: { ...revokedResult, tokenId: TOKEN_B },
      refreshed: revokedAccountA,
      expectedGets: 1,
    },
    {
      label: "missing refreshed target",
      result: revokedResult,
      refreshed: { ...accountA, tokens: [accountA.tokens[1]!] },
      expectedGets: 2,
    },
    {
      label: "still-active refreshed target",
      result: revokedResult,
      refreshed: accountA,
      expectedGets: 2,
    },
  ])("rejects $label as fixed contract failure without fabricating revoked evidence", async ({
    result,
    refreshed,
    expectedGets,
  }) => {
    const getAccount = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(refreshed);
    const rendered = await renderCapture(
      services({
        getAccount,
        revokeAccountToken: vi.fn(async () => result),
      }),
      memory(PROJECT_TOKEN).port,
    );
    await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}`));

    await expectContractFailure(() => rendered.current().revokeAccountToken(TOKEN_A));
    expect(getAccount).toHaveBeenCalledTimes(expectedGets);
    expect(screen.getByLabelText("session state")).not.toHaveTextContent("Local CLI:revoked");
  });

  it.each([401, 403] as const)(
    "clears only the current browser authority after a current-generation revoke returns %s invalid authority",
    async (status) => {
      const stored = memory(PROJECT_TOKEN);
      const rendered = await renderCapture(
        services({
          revokeAccountToken: vi.fn(async () => { throw invalidAuthority(status); }),
        }),
        stored.port,
      );
      await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}`));

      await expect(rendered.current().revokeAccountToken(TOKEN_A)).rejects.toMatchObject({
        name: "WalletAccessError",
        status,
        code: status === 401 ? "UNAUTHORIZED" : "ACCOUNT_SESSION_REQUIRED",
      });
      expect(screen.getByLabelText("session state")).toHaveTextContent("anonymous::");
      expect(stored.read()).toBeNull();
    },
  );

  it.each([401, 403] as const)(
    "maps a late A %s invalid-authority revoke to stale 403 without clearing same-bearer B",
    async (status) => {
      const revokeA = deferred<AccountTokenRevokedV1>();
      const getAccount = vi.fn()
        .mockResolvedValueOnce(accountA)
        .mockResolvedValueOnce(accountB);
      const rendered = await renderCapture(
        services({
          getAccount,
          revokeAccountToken: vi.fn(() => revokeA.promise),
          createWalletSession: vi.fn(async () => sameBearerSessionB),
        }),
        memory(PROJECT_TOKEN).port,
      );
      await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}`));

      const lateA = rendered.current().revokeAccountToken(TOKEN_A);
      act(() => rendered.current().forgetBrowser());
      await act(async () => { await rendered.current().createSession(SESSION_REQUEST); });
      await act(async () => { await rendered.current().refreshAccount(); });
      await act(async () => revokeA.reject(invalidAuthority(status)));

      await expectSessionRequired(() => lateA);
      expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_B}:Current B token:present`);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "rejects stale A after its account refresh %s settles under same-bearer B",
    async (settlement) => {
      const refreshA = deferred<AccountV1>();
      const getAccount = vi.fn()
        .mockResolvedValueOnce(accountA)
        .mockReturnValueOnce(refreshA.promise)
        .mockResolvedValueOnce(accountB);
      const access = services({
        getAccount,
        revokeAccountToken: vi.fn(async () => revokedResult),
        createWalletSession: vi.fn(async () => sameBearerSessionB),
      });
      const rendered = await renderCapture(access, memory(PROJECT_TOKEN).port);
      await waitFor(() => expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_A}`));

      const lateA = rendered.current().revokeAccountToken(TOKEN_A);
      await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(2));
      act(() => rendered.current().forgetBrowser());
      await act(async () => { await rendered.current().createSession(SESSION_REQUEST); });
      const refreshB = rendered.current().refreshAccount();
      expect(getAccount).toHaveBeenCalledTimes(3);

      if (settlement === "resolve") {
        await act(async () => refreshA.resolve(revokedAccountA));
      } else {
        await act(async () => refreshA.reject(new Error("late A refresh must stay private")));
      }
      await expectSessionRequired(() => lateA);
      await act(async () => { await refreshB; });
      expect(screen.getByLabelText("session state")).toHaveTextContent(`authenticated:${ADDRESS_B}:Current B token:present`);
      expect(screen.getByLabelText("session state")).not.toHaveTextContent("Local CLI:revoked");
    },
  );
});
