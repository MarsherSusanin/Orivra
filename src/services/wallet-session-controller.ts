import {
  AccountV1Schema,
  WalletSessionRequestV1Schema,
  WalletSessionV1Schema,
  type AccountV1,
  type WalletSessionRequestV1,
} from "@proofline/contracts/wallet-auth";
import {
  WalletAccessError,
  isKnownWalletAccessHttpErrorCode,
  type WalletAccessErrorKind,
  type WalletAccessServices,
} from "./wallet-access-client";

export const PROJECT_TOKEN_SESSION_KEY = "proofline:project-token" as const;

const PROJECT_TOKEN = /^project_[a-f0-9]{64}$/;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type WalletSessionSnapshot =
  | { status: "anonymous" }
  | { status: "restoring" }
  | { status: "creating-session" }
  | {
      status: "authenticated";
      persistence: "session" | "memory";
      wallet: AccountV1["wallet"];
      project: AccountV1["project"];
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

export type WalletSessionController = {
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

type AuthenticatedSnapshot = Extract<
  WalletSessionSnapshot,
  { status: "authenticated" }
>;

type FailureEvidence = {
  kind: WalletAccessErrorKind;
  status: number;
  code: string;
  retryable: boolean;
};

function normalizedFailure(cause: unknown): WalletAccessError {
  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    const kind = record.kind;
    const status = record.status;
    const code = record.code;
    const retryable = record.retryable;
    if (
      record.name === "WalletAccessError" &&
      (kind === "http" ||
        kind === "transport" ||
        kind === "contract" ||
        kind === "input") &&
      typeof status === "number" &&
      Number.isInteger(status) &&
      typeof code === "string" &&
      typeof retryable === "boolean"
    ) {
      const valid =
        (kind === "http" &&
          status >= 400 &&
          status <= 599 &&
          (isKnownWalletAccessHttpErrorCode(status, code) ||
            code === `HTTP_${status}`)) ||
        (kind === "transport" &&
          status === 0 &&
          code === "TRANSPORT_UNAVAILABLE" &&
          retryable) ||
        (kind === "contract" &&
          status === 502 &&
          code === "AUTH_RESPONSE_INVALID" &&
          !retryable) ||
        (kind === "input" &&
          status === 0 &&
          code === "AUTH_INPUT_INVALID" &&
          !retryable);
      if (valid) {
        return new WalletAccessError({
          kind,
          status,
          code,
          retryable:
            kind === "http"
              ? status >= 500 || status === 408 || status === 429
              : retryable,
        });
      }
    }
  }
  return new WalletAccessError({
    kind: "contract",
    status: 502,
    code: "AUTH_RESPONSE_INVALID",
    retryable: false,
  });
}

function isInvalidAuthority(failure: FailureEvidence): boolean {
  return (
    failure.status === 401 ||
    (failure.status === 403 && failure.code === "ACCOUNT_SESSION_REQUIRED")
  );
}

export function createWalletSessionController(input: {
  services: WalletAccessServices;
  storage: StorageLike;
}): WalletSessionController {
  let state: WalletSessionSnapshot = { status: "anonymous" };
  let projectToken: string | null = null;
  let persistence: "session" | "memory" = "session";
  let authenticated: AuthenticatedSnapshot | null = null;
  let closed = false;
  let revision = 0;
  let restoreFlight: Promise<void> | null = null;
  let createFlight: Promise<void> | null = null;
  let signOutFlight: Promise<void> | null = null;

  function removeStoredToken(): void {
    try {
      input.storage.removeItem(PROJECT_TOKEN_SESSION_KEY);
    } catch {
      // In-memory authority is still cleared when browser storage is denied.
    }
  }

  function clearAuthority(): void {
    projectToken = null;
    authenticated = null;
    persistence = "session";
    removeStoredToken();
    if (!closed) state = { status: "anonymous" };
  }

  function invalidateFlights(): number {
    revision += 1;
    restoreFlight = null;
    createFlight = null;
    signOutFlight = null;
    return revision;
  }

  function current(attempt: number): boolean {
    return !closed && revision === attempt;
  }

  function unavailable(
    operation: "restore" | "sign-out",
    failure: FailureEvidence,
  ): void {
    state = {
      status: "unavailable",
      operation,
      reason: failure.kind === "transport" ? "offline" : "server",
      code: failure.code,
      safeAction: "retry",
      persistence,
    };
  }

  function restore(): Promise<void> {
    if (closed) return Promise.resolve();
    if (restoreFlight) return restoreFlight;
    const attempt = invalidateFlights();

    let stored: string | null;
    try {
      stored = input.storage.getItem(PROJECT_TOKEN_SESSION_KEY);
    } catch {
      state = { status: "anonymous" };
      projectToken = null;
      authenticated = null;
      return Promise.resolve();
    }
    if (stored === null) {
      state = { status: "anonymous" };
      projectToken = null;
      authenticated = null;
      return Promise.resolve();
    }
    if (!PROJECT_TOKEN.test(stored)) {
      clearAuthority();
      return Promise.resolve();
    }

    projectToken = stored;
    persistence = "session";
    state = { status: "restoring" };
    let flight!: Promise<void>;
    flight = (async () => {
      try {
        const account = AccountV1Schema.parse(
          await input.services.getAccount({ projectToken: stored }),
        );
        if (!current(attempt)) return;
        authenticated = {
          status: "authenticated",
          persistence: "session",
          wallet: account.wallet,
          project: account.project,
          account,
        };
        state = authenticated;
      } catch (cause) {
        if (!current(attempt)) return;
        const failure = normalizedFailure(cause);
        if (isInvalidAuthority(failure)) {
          clearAuthority();
          return;
        }
        unavailable("restore", failure);
      } finally {
        if (restoreFlight === flight) restoreFlight = null;
      }
    })();
    restoreFlight = flight;
    return flight;
  }

  function createSession(request: WalletSessionRequestV1): Promise<void> {
    if (closed) return Promise.resolve();
    if (createFlight) return createFlight;
    const parsedRequest = WalletSessionRequestV1Schema.safeParse(request);
    if (!parsedRequest.success) {
      return Promise.reject(
        new WalletAccessError({
          kind: "input",
          status: 0,
          code: "AUTH_INPUT_INVALID",
          retryable: false,
        }),
      );
    }

    const previousToken = projectToken;
    const previousPersistence = persistence;
    const previousAuthenticated = authenticated;
    const attempt = invalidateFlights();
    state = { status: "creating-session" };
    let flight!: Promise<void>;
    flight = (async () => {
      try {
        const session = WalletSessionV1Schema.parse(
          await input.services.createWalletSession(parsedRequest.data),
        );
        if (!current(attempt)) return;

        let nextPersistence: "session" | "memory" = "session";
        try {
          input.storage.setItem(
            PROJECT_TOKEN_SESSION_KEY,
            session.projectToken,
          );
        } catch {
          nextPersistence = "memory";
          removeStoredToken();
        }
        if (!current(attempt)) return;
        projectToken = session.projectToken;
        persistence = nextPersistence;
        authenticated = {
          status: "authenticated",
          persistence: nextPersistence,
          wallet: session.wallet,
          project: session.project,
        };
        state = authenticated;
      } catch (cause) {
        if (!current(attempt)) return;
        projectToken = previousToken;
        persistence = previousPersistence;
        authenticated = previousAuthenticated;
        state = previousAuthenticated ?? { status: "anonymous" };
        throw normalizedFailure(cause);
      } finally {
        if (createFlight === flight) createFlight = null;
      }
    })();
    createFlight = flight;
    return flight;
  }

  function signOut(): Promise<void> {
    if (closed) return Promise.resolve();
    if (signOutFlight) return signOutFlight;
    if (projectToken === null) {
      if (restoreFlight || createFlight) {
        invalidateFlights();
        state = { status: "anonymous" };
      }
      return Promise.resolve();
    }

    const token = projectToken;
    const attempt = invalidateFlights();
    state = { status: "signing-out", persistence };
    let flight!: Promise<void>;
    flight = (async () => {
      try {
        await input.services.revokeCurrentSession({ projectToken: token });
        if (!current(attempt)) return;
        clearAuthority();
      } catch (cause) {
        if (!current(attempt)) return;
        const failure = normalizedFailure(cause);
        if (isInvalidAuthority(failure)) {
          clearAuthority();
          return;
        }
        unavailable("sign-out", failure);
      } finally {
        if (signOutFlight === flight) signOutFlight = null;
      }
    })();
    signOutFlight = flight;
    return flight;
  }

  return {
    snapshot() {
      return state;
    },

    accessToken() {
      return closed ? null : projectToken;
    },

    restore,
    createSession,
    signOut,

    retry() {
      if (state.status !== "unavailable") return Promise.resolve();
      return state.operation === "restore" ? restore() : signOut();
    },

    forgetBrowser() {
      if (closed) return;
      invalidateFlights();
      clearAuthority();
    },

    cancelPending() {
      if (closed) return;
      invalidateFlights();
      state = authenticated ?? { status: "anonymous" };
    },

    close() {
      if (closed) return;
      invalidateFlights();
      closed = true;
      projectToken = null;
      authenticated = null;
      state = { status: "closed" };
    },
  };
}
