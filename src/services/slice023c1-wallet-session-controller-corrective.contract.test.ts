// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type {
  AccountTokenCreateRequestV1,
  AccountTokenCreatedV1,
  AccountTokenRevokedV1,
  AccountV1,
  NetworkCapabilitiesV1,
  WalletChallengeRequestV1,
  WalletChallengeV1,
  WalletSessionRequestV1,
  WalletSessionV1,
} from "@proofline/contracts";
import {
  WalletAccessError,
  type WalletAccessServices,
} from "./wallet-access-client";
import {
  PROJECT_TOKEN_SESSION_KEY,
  createWalletSessionController,
  type StorageLike,
} from "./wallet-session-controller";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SECOND_PROJECT_TOKEN = `project_${"b".repeat(64)}`;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CHALLENGE_ID = `challenge_${"c".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;
const REQUEST = { version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE } as const;

const account: AccountV1 = {
  version: "1",
  wallet: { kind: "eoa", address: ADDRESS },
  project: { kind: "default", projectId: PROJECT_ID },
  tokens: [],
};

function session(projectToken = PROJECT_TOKEN): WalletSessionV1 {
  return {
    version: "1",
    wallet: account.wallet,
    project: account.project,
    projectToken,
    issuedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-09T12:00:00.000Z",
  };
}

function ports(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
  return {
    listNetworks: vi.fn<() => Promise<NetworkCapabilitiesV1>>(),
    createWalletChallenge: vi.fn<(request: WalletChallengeRequestV1) => Promise<WalletChallengeV1>>(),
    createWalletSession: vi.fn(async (_request: WalletSessionRequestV1) => session()),
    getAccount: vi.fn(async () => account),
    createAccountToken: vi.fn<(
      input: {
        projectToken: string;
        idempotencyKey: string;
        request: AccountTokenCreateRequestV1;
      },
    ) => Promise<AccountTokenCreatedV1>>(),
    revokeAccountToken: vi.fn<(
      input: { projectToken: string; tokenId: string },
    ) => Promise<AccountTokenRevokedV1>>(),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function storage(initial?: string, overrides: Partial<StorageLike> = {}) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PROJECT_TOKEN_SESSION_KEY, initial);
  const port: StorageLike = {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: vi.fn((key) => { values.delete(key); }),
    ...overrides,
  };
  return { values, port };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function accessError(input: Partial<{
  kind: "http" | "transport" | "contract" | "input";
  status: number;
  code: string;
  retryable: boolean;
}> = {}) {
  return new WalletAccessError({
    kind: input.kind ?? "transport",
    status: input.status ?? 0,
    code: input.code ?? "TRANSPORT_UNAVAILABLE",
    retryable: input.retryable ?? true,
  });
}

describe("Slice 023C1 corrective wallet session controller", () => {
  it("keeps close terminal after every later public mutating or async action", async () => {
    const stored = storage(PROJECT_TOKEN);
    const services = ports();
    const controller = createWalletSessionController({ services, storage: stored.port });
    controller.close();
    const storageCallsAtClose = {
      get: vi.mocked(stored.port.getItem).mock.calls.length,
      set: vi.mocked(stored.port.setItem).mock.calls.length,
      remove: vi.mocked(stored.port.removeItem).mock.calls.length,
    };

    controller.cancelPending();
    expect.soft(controller.snapshot()).toEqual({ status: "closed" });
    await controller.restore();
    expect.soft(controller.snapshot()).toEqual({ status: "closed" });
    await controller.createSession(REQUEST);
    expect.soft(controller.snapshot()).toEqual({ status: "closed" });
    await controller.signOut();
    expect.soft(controller.snapshot()).toEqual({ status: "closed" });
    await controller.retry();
    expect.soft(controller.snapshot()).toEqual({ status: "closed" });
    controller.forgetBrowser();
    expect.soft(controller.snapshot()).toEqual({ status: "closed" });
    controller.close();
    expect.soft(controller.snapshot()).toEqual({ status: "closed" });

    expect(controller.snapshot()).toEqual({ status: "closed" });
    expect(controller.accessToken()).toBeNull();
    expect(services.getAccount).not.toHaveBeenCalled();
    expect(services.createWalletSession).not.toHaveBeenCalled();
    expect(services.revokeCurrentSession).not.toHaveBeenCalled();
    expect(vi.mocked(stored.port.getItem)).toHaveBeenCalledTimes(storageCallsAtClose.get);
    expect(vi.mocked(stored.port.setItem)).toHaveBeenCalledTimes(storageCallsAtClose.set);
    expect(vi.mocked(stored.port.removeItem)).toHaveBeenCalledTimes(storageCallsAtClose.remove);
  });

  it("keeps late restore success and failure storage-neutral after close", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const result = deferred<AccountV1>();
      const stored = storage(PROJECT_TOKEN);
      const services = ports({ getAccount: vi.fn(() => result.promise) });
      const controller = createWalletSessionController({ services, storage: stored.port });
      const pending = controller.restore();
      controller.close();
      if (outcome === "resolve") result.resolve(account);
      else result.reject(accessError());
      await pending;
      expect(controller.snapshot()).toEqual({ status: "closed" });
      expect(controller.accessToken()).toBeNull();
      expect(stored.port.setItem).not.toHaveBeenCalled();
      expect(stored.port.removeItem).not.toHaveBeenCalled();
    }
  });

  it("keeps late sign-out success and failure storage-neutral after close", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const revoke = deferred<void>();
      const stored = storage(PROJECT_TOKEN);
      const controller = createWalletSessionController({
        services: ports({ revokeCurrentSession: vi.fn(() => revoke.promise) }),
        storage: stored.port,
      });
      await controller.restore();
      const removesBeforeSignOut = vi.mocked(stored.port.removeItem).mock.calls.length;
      const pending = controller.signOut();
      controller.close();
      if (outcome === "resolve") revoke.resolve();
      else revoke.reject(accessError());
      await pending;
      expect(controller.snapshot()).toEqual({ status: "closed" });
      expect(controller.accessToken()).toBeNull();
      expect(vi.mocked(stored.port.removeItem)).toHaveBeenCalledTimes(removesBeforeSignOut);
    }
  });

  it("handles missing and denied storage reads without network or fallback", async () => {
    for (const port of [
      storage().port,
      storage(undefined, {
        getItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
      }).port,
    ]) {
      const services = ports();
      const controller = createWalletSessionController({ services, storage: port });
      await controller.restore();
      expect(controller.snapshot()).toEqual({ status: "anonymous" });
      expect(controller.accessToken()).toBeNull();
      expect(services.getAccount).not.toHaveBeenCalled();
    }
  });

  it("survives set/remove denial as an ephemeral session and explicit forget", async () => {
    const denied = storage(undefined, {
      setItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
      removeItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
    });
    const controller = createWalletSessionController({ services: ports(), storage: denied.port });
    await controller.createSession(REQUEST);
    expect(controller.snapshot()).toMatchObject({
      status: "authenticated",
      persistence: "memory",
    });
    expect(controller.accessToken()).toBe(PROJECT_TOKEN);
    expect(() => controller.forgetBrowser()).not.toThrow();
    expect(controller.snapshot()).toEqual({ status: "anonymous" });
    expect(controller.accessToken()).toBeNull();
  });

  it("rejects invalid session input before effects and permits a later valid attempt", async () => {
    const createWalletSession = vi.fn(async () => session());
    const controller = createWalletSessionController({
      services: ports({ createWalletSession }),
      storage: storage().port,
    });
    await expect(controller.createSession({
      version: "1",
      challengeId: CHALLENGE_ID,
      signature: "0xwrong",
    })).rejects.toMatchObject({ code: "AUTH_INPUT_INVALID" });
    expect(createWalletSession).not.toHaveBeenCalled();
    await controller.createSession(REQUEST);
    expect(createWalletSession).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({ status: "authenticated" });
  });

  it("restores previous authenticated authority after recognized or malformed create failures", async () => {
    for (const cause of [
      accessError({ kind: "http", status: 409, code: "CHALLENGE_UNAVAILABLE", retryable: false }),
      new Error(`private ${SECOND_PROJECT_TOKEN}`),
      { name: "WalletAccessError", kind: "http", status: 409.5, code: "CHALLENGE_UNAVAILABLE", retryable: false },
    ]) {
      const stored = storage(PROJECT_TOKEN);
      const controller = createWalletSessionController({
        services: ports({ createWalletSession: vi.fn(async () => { throw cause; }) }),
        storage: stored.port,
      });
      await controller.restore();
      const before = controller.snapshot();
      const failure = await controller.createSession(REQUEST).catch((error: unknown) => error);
      expect(controller.snapshot()).toEqual(before);
      expect(controller.accessToken()).toBe(PROJECT_TOKEN);
      expect(failure).toMatchObject({
        name: "WalletAccessError",
        code: cause instanceof WalletAccessError
          ? "CHALLENGE_UNAVAILABLE"
          : "AUTH_RESPONSE_INVALID",
      });
      expect(JSON.stringify(failure)).not.toContain(SECOND_PROJECT_TOKEN);
    }
  });

  it.each([
    null,
    {},
    { name: "WrongError", kind: "http", status: 500, code: "REQUEST_FAILED", retryable: true },
    { name: "WalletAccessError", kind: "wrong", status: 500, code: "REQUEST_FAILED", retryable: true },
    { name: "WalletAccessError", kind: "http", status: "500", code: "REQUEST_FAILED", retryable: true },
    { name: "WalletAccessError", kind: "http", status: 500, code: "request_failed", retryable: true },
    { name: "WalletAccessError", kind: "http", status: 500, code: "REQUEST_FAILED", retryable: "yes" },
  ])("normalizes malformed restore failure evidence without leaking it: %j", async (cause) => {
    const stored = storage(PROJECT_TOKEN);
    const controller = createWalletSessionController({
      services: ports({ getAccount: vi.fn(async () => { throw cause; }) }),
      storage: stored.port,
    });
    await controller.restore();
    expect(controller.snapshot()).toEqual({
      status: "unavailable",
      operation: "restore",
      reason: "server",
      code: "AUTH_RESPONSE_INVALID",
      safeAction: "retry",
      persistence: "session",
    });
    expect(controller.accessToken()).toBe(PROJECT_TOKEN);
  });

  it("cancels a pending session creation through sign-out when no authority is established", async () => {
    const sessionResult = deferred<WalletSessionV1>();
    const stored = storage();
    const controller = createWalletSessionController({
      services: ports({ createWalletSession: vi.fn(() => sessionResult.promise) }),
      storage: stored.port,
    });
    const pending = controller.createSession(REQUEST);
    await controller.signOut();
    expect(controller.snapshot()).toEqual({ status: "anonymous" });
    sessionResult.resolve(session());
    await pending;
    expect(controller.snapshot()).toEqual({ status: "anonymous" });
    expect(controller.accessToken()).toBeNull();
    expect(stored.port.setItem).not.toHaveBeenCalled();
  });

  it("makes retry outside unavailable and sign-out without authority effect-free", async () => {
    const services = ports();
    const stored = storage();
    const controller = createWalletSessionController({ services, storage: stored.port });
    await controller.retry();
    await controller.signOut();
    expect(controller.snapshot()).toEqual({ status: "anonymous" });
    expect(services.getAccount).not.toHaveBeenCalled();
    expect(services.revokeCurrentSession).not.toHaveBeenCalled();
    expect(stored.port.removeItem).not.toHaveBeenCalled();
  });

  it("keeps cancelled late create failures storage-neutral and allows a superseding session", async () => {
    const first = deferred<WalletSessionV1>();
    const createWalletSession = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(session(SECOND_PROJECT_TOKEN));
    const stored = storage();
    const controller = createWalletSessionController({
      services: ports({ createWalletSession }),
      storage: stored.port,
    });
    const stale = controller.createSession(REQUEST);
    controller.cancelPending();
    await controller.createSession(REQUEST);
    first.reject(new Error(`late ${PROJECT_TOKEN}`));
    await expect(stale).resolves.toBeUndefined();
    expect(controller.accessToken()).toBe(SECOND_PROJECT_TOKEN);
    expect(stored.values.get(PROJECT_TOKEN_SESSION_KEY)).toBe(SECOND_PROJECT_TOKEN);
    expect(stored.port.setItem).toHaveBeenCalledOnce();
  });
});
