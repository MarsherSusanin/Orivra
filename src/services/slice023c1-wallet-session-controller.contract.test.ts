// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
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

const MODULE_PATH = "./wallet-session-controller";
const SESSION_KEY = "proofline:project-token";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SECOND_PROJECT_TOKEN = `project_${"b".repeat(64)}`;
const SHARE_TOKEN = `share_${"c".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CHALLENGE_ID = `challenge_${"d".repeat(64)}`;
const SIGNATURE = `0x${"11".repeat(65)}`;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type WalletAccessFailure = Error & {
  name: "WalletAccessError";
  kind: "http" | "transport" | "contract" | "input";
  status: number;
  code: string;
  retryable: boolean;
};

type WalletAccessServices = {
  listNetworks(): Promise<NetworkCapabilitiesV1>;
  createWalletChallenge(request: WalletChallengeRequestV1): Promise<WalletChallengeV1>;
  createWalletSession(request: WalletSessionRequestV1): Promise<WalletSessionV1>;
  getAccount(input: { projectToken: string }): Promise<AccountV1>;
  createAccountToken(input: {
    projectToken: string;
    idempotencyKey: string;
    request: AccountTokenCreateRequestV1;
  }): Promise<AccountTokenCreatedV1>;
  revokeAccountToken(input: { projectToken: string; tokenId: string }): Promise<AccountTokenRevokedV1>;
  revokeCurrentSession(input: { projectToken: string }): Promise<void>;
};

type WalletSessionSnapshot =
  | { status: "anonymous" }
  | { status: "restoring" }
  | { status: "creating-session" }
  | {
      status: "authenticated";
      persistence: "session" | "memory";
      wallet: { kind: "eoa"; address: string };
      project: { kind: "default"; projectId: string };
      account?: AccountV1;
    }
  | {
      status: "signing-out";
      persistence: "session" | "memory";
    }
  | {
      status: "unavailable";
      operation: "restore" | "sign-out";
      reason: "offline" | "server";
      code: string;
      safeAction: "retry";
      persistence: "session" | "memory";
    }
  | { status: "closed" };

type WalletSessionController = {
  snapshot(): WalletSessionSnapshot;
  accessToken(): string | null;
  restore(): Promise<void>;
  createSession(request: WalletSessionRequestV1): Promise<void>;
  signOut(): Promise<void>;
  retry(): Promise<void>;
  forgetBrowser(): void;
  cancelPending(): void;
  close(): void;
};

type WalletSessionControllerModule = {
  PROJECT_TOKEN_SESSION_KEY: "proofline:project-token";
  createWalletSessionController(input: {
    services: WalletAccessServices;
    storage: StorageLike;
  }): WalletSessionController;
};

async function loadModule(): Promise<WalletSessionControllerModule> {
  return import(MODULE_PATH) as Promise<WalletSessionControllerModule>;
}

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

function failure(input: Partial<WalletAccessFailure> = {}): WalletAccessFailure {
  return Object.assign(new Error("sanitized"), {
    name: "WalletAccessError" as const,
    kind: "transport" as const,
    status: 0,
    code: "TRANSPORT_UNAVAILABLE",
    retryable: true,
    ...input,
  });
}

function services(overrides: Partial<WalletAccessServices> = {}): WalletAccessServices {
  return {
    listNetworks: vi.fn(),
    createWalletChallenge: vi.fn(),
    createWalletSession: vi.fn(async () => session()),
    getAccount: vi.fn(async () => account),
    createAccountToken: vi.fn(),
    revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function storage(initial?: string, overrides: Partial<StorageLike> = {}) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SESSION_KEY, initial);
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Slice 023C1 wallet session controller", () => {
  it("restores only the exact sessionStorage project token and never calls a wallet/provider", async () => {
    const { createWalletSessionController, PROJECT_TOKEN_SESSION_KEY } = await loadModule();
    expect(PROJECT_TOKEN_SESSION_KEY).toBe(SESSION_KEY);
    const stored = storage(PROJECT_TOKEN);
    const ports = services();
    const controller = createWalletSessionController({ services: ports, storage: stored.port });

    const first = controller.restore();
    const second = controller.restore();
    expect(controller.snapshot()).toEqual({ status: "restoring" });
    await Promise.all([first, second]);

    expect(ports.getAccount).toHaveBeenCalledOnce();
    expect(ports.getAccount).toHaveBeenCalledWith({ projectToken: PROJECT_TOKEN });
    expect(ports.listNetworks).not.toHaveBeenCalled();
    expect(ports.createWalletChallenge).not.toHaveBeenCalled();
    expect(ports.createWalletSession).not.toHaveBeenCalled();
    expect(controller.accessToken()).toBe(PROJECT_TOKEN);
    expect(controller.snapshot()).toEqual({
      status: "authenticated",
      persistence: "session",
      wallet: account.wallet,
      project: account.project,
      account,
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain(PROJECT_TOKEN);
  });

  it.each([SHARE_TOKEN, "project_short", `project_${"A".repeat(64)}`, ""]) (
    "rejects corrupted or non-project session material without using it: %s",
    async (storedToken) => {
      const { createWalletSessionController } = await loadModule();
      const stored = storage(storedToken);
      const ports = services();
      const controller = createWalletSessionController({ services: ports, storage: stored.port });

      await controller.restore();

      expect(controller.snapshot()).toEqual({ status: "anonymous" });
      expect(controller.accessToken()).toBeNull();
      expect(stored.port.removeItem).toHaveBeenCalledWith(SESSION_KEY);
      expect(ports.getAccount).not.toHaveBeenCalled();
    },
  );

  it("clears expired, revoked, or non-browser credentials but retains an offline token for safe retry", async () => {
    const { createWalletSessionController } = await loadModule();
    const unauthorizedStorage = storage(PROJECT_TOKEN);
    const unauthorizedServices = services({
      getAccount: vi.fn(async () => { throw failure({ kind: "http", status: 401, code: "UNAUTHORIZED" }); }),
    });
    const unauthorized = createWalletSessionController({
      services: unauthorizedServices,
      storage: unauthorizedStorage.port,
    });
    await unauthorized.restore();
    expect(unauthorized.snapshot()).toEqual({ status: "anonymous" });
    expect(unauthorized.accessToken()).toBeNull();
    expect(unauthorizedStorage.port.removeItem).toHaveBeenCalledWith(SESSION_KEY);

    const nonBrowserStorage = storage(PROJECT_TOKEN);
    const nonBrowser = createWalletSessionController({
      services: services({
        getAccount: vi.fn(async () => {
          throw failure({
            kind: "http",
            status: 403,
            code: "ACCOUNT_SESSION_REQUIRED",
            retryable: false,
          });
        }),
      }),
      storage: nonBrowserStorage.port,
    });
    await nonBrowser.restore();
    expect(nonBrowser.snapshot()).toEqual({ status: "anonymous" });
    expect(nonBrowser.accessToken()).toBeNull();
    expect(nonBrowserStorage.values.has(SESSION_KEY)).toBe(false);

    const offlineStorage = storage(PROJECT_TOKEN);
    const getAccount = vi
      .fn()
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce(account);
    const offline = createWalletSessionController({
      services: services({ getAccount }),
      storage: offlineStorage.port,
    });
    await offline.restore();
    expect(offline.snapshot()).toEqual({
      status: "unavailable",
      operation: "restore",
      reason: "offline",
      code: "TRANSPORT_UNAVAILABLE",
      safeAction: "retry",
      persistence: "session",
    });
    expect(offline.accessToken()).toBe(PROJECT_TOKEN);
    expect(offlineStorage.values.get(SESSION_KEY)).toBe(PROJECT_TOKEN);
    await offline.retry();
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(offline.snapshot()).toMatchObject({ status: "authenticated", account });
  });

  it("keeps a valid created session in memory when sessionStorage is denied and never falls back", async () => {
    const { createWalletSessionController } = await loadModule();
    const localStorage = {
      getItem: vi.fn(() => { throw new Error("localStorage must not be read"); }),
      setItem: vi.fn(() => { throw new Error("localStorage must not be written"); }),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorage);
    const denied = storage(undefined, {
      setItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
    });
    const controller = createWalletSessionController({
      services: services(),
      storage: denied.port,
    });

    await controller.createSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });

    expect(controller.accessToken()).toBe(PROJECT_TOKEN);
    expect(controller.snapshot()).toEqual({
      status: "authenticated",
      persistence: "memory",
      wallet: account.wallet,
      project: account.project,
    });
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it("single-flights session creation and ignores cancelled, closed, and stale late responses", async () => {
    const { createWalletSessionController } = await loadModule();
    const firstResult = deferred<WalletSessionV1>();
    const secondResult = deferred<WalletSessionV1>();
    const createWalletSession = vi
      .fn()
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);
    const stored = storage();
    const controller = createWalletSessionController({
      services: services({ createWalletSession }),
      storage: stored.port,
    });

    const first = controller.createSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });
    const duplicate = controller.createSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });
    expect(createWalletSession).toHaveBeenCalledOnce();
    controller.cancelPending();
    const second = controller.createSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });
    expect(createWalletSession).toHaveBeenCalledTimes(2);

    secondResult.resolve(session(SECOND_PROJECT_TOKEN));
    await second;
    firstResult.resolve(session(PROJECT_TOKEN));
    await Promise.all([first, duplicate]);
    expect(controller.accessToken()).toBe(SECOND_PROJECT_TOKEN);
    expect(stored.values.get(SESSION_KEY)).toBe(SECOND_PROJECT_TOKEN);
    expect(stored.port.setItem).toHaveBeenCalledOnce();

    const closingResult = deferred<WalletSessionV1>();
    const closedStorage = storage();
    const closed = createWalletSessionController({
      services: services({ createWalletSession: vi.fn(() => closingResult.promise) }),
      storage: closedStorage.port,
    });
    const pending = closed.createSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });
    closed.close();
    closingResult.resolve(session());
    await pending;
    expect(closed.snapshot()).toEqual({ status: "closed" });
    expect(closed.accessToken()).toBeNull();
    expect(closedStorage.port.setItem).not.toHaveBeenCalled();
  });

  it("clears on 204 or 401 sign-out, but retains access on network/server failures until retry or forget", async () => {
    const { createWalletSessionController } = await loadModule();
    const signedInStorage = storage(PROJECT_TOKEN);
    const revoke = vi.fn(async () => undefined);
    const signedIn = createWalletSessionController({
      services: services({ revokeCurrentSession: revoke }),
      storage: signedInStorage.port,
    });
    await signedIn.restore();
    await Promise.all([signedIn.signOut(), signedIn.signOut()]);
    expect(revoke).toHaveBeenCalledOnce();
    expect(signedIn.snapshot()).toEqual({ status: "anonymous" });
    expect(signedIn.accessToken()).toBeNull();
    expect(signedInStorage.port.removeItem).toHaveBeenCalledWith(SESSION_KEY);

    const expiredStorage = storage(PROJECT_TOKEN);
    const expired = createWalletSessionController({
      services: services({
        revokeCurrentSession: vi.fn(async () => {
          throw failure({ kind: "http", status: 401, code: "UNAUTHORIZED" });
        }),
      }),
      storage: expiredStorage.port,
    });
    await expired.restore();
    await expired.signOut();
    expect(expired.snapshot()).toEqual({ status: "anonymous" });
    expect(expiredStorage.values.has(SESSION_KEY)).toBe(false);

    const retainedStorage = storage(PROJECT_TOKEN);
    const revokeRetained = vi
      .fn()
      .mockRejectedValueOnce(failure())
      .mockRejectedValueOnce(failure({ kind: "http", status: 503, code: "HTTP_503" }))
      .mockResolvedValueOnce(undefined);
    const retained = createWalletSessionController({
      services: services({ revokeCurrentSession: revokeRetained }),
      storage: retainedStorage.port,
    });
    await retained.restore();
    await retained.signOut();
    expect(retained.snapshot()).toMatchObject({
      status: "unavailable",
      operation: "sign-out",
      reason: "offline",
      safeAction: "retry",
    });
    expect(retained.accessToken()).toBe(PROJECT_TOKEN);
    await retained.retry();
    expect(retained.snapshot()).toMatchObject({
      status: "unavailable",
      operation: "sign-out",
      reason: "server",
      safeAction: "retry",
    });
    expect(retainedStorage.values.get(SESSION_KEY)).toBe(PROJECT_TOKEN);
    await retained.retry();
    expect(retained.snapshot()).toEqual({ status: "anonymous" });
    expect(revokeRetained).toHaveBeenCalledTimes(3);

    const forgottenStorage = storage(PROJECT_TOKEN);
    const forgotten = createWalletSessionController({
      services: services({ revokeCurrentSession: vi.fn(async () => { throw failure(); }) }),
      storage: forgottenStorage.port,
    });
    await forgotten.restore();
    await forgotten.signOut();
    forgotten.forgetBrowser();
    expect(forgotten.snapshot()).toEqual({ status: "anonymous" });
    expect(forgotten.accessToken()).toBeNull();
    expect(forgottenStorage.values.has(SESSION_KEY)).toBe(false);
  });

  it("never exposes authentication material to URL, history, analytics, localStorage, or logs", async () => {
    const { createWalletSessionController } = await loadModule();
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    const analytics = { emit: vi.fn() };
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("history", history);
    vi.stubGlobal("location", new URL(`https://proofline.example/runs?token=${SHARE_TOKEN}#${PROJECT_TOKEN}`));
    vi.stubGlobal("localStorage", localStorage);
    const stored = storage();
    const controller = createWalletSessionController({
      services: services(),
      storage: stored.port,
      analytics,
    } as unknown as { services: WalletAccessServices; storage: StorageLike });

    await controller.createSession({ version: "1", challengeId: CHALLENGE_ID, signature: SIGNATURE });
    await controller.signOut();

    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(analytics.emit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(JSON.stringify(controller.snapshot())).not.toMatch(/project_|share_|signature|challenge/i);
  });
});
