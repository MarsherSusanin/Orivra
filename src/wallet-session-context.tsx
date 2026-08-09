import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AccountTokenCreateRequestV1,
  AccountTokenCreatedV1,
  NetworkCapabilitiesV1,
  WalletChallengeRequestV1,
  WalletChallengeV1,
  WalletSessionRequestV1,
} from "@proofline/contracts";
import {
  AccountTokenCreatedV1Schema,
  AccountV1Schema,
} from "@proofline/contracts";
import {
  WalletAccessError,
  type WalletAccessServices,
} from "./services/wallet-access-client";
import {
  createWalletSessionController,
  type StorageLike,
  type WalletSessionSnapshot,
} from "./services/wallet-session-controller";

export type WalletSessionContextValue = {
  snapshot: WalletSessionSnapshot;
  accessToken(): string | null;
  listNetworks(): Promise<NetworkCapabilitiesV1>;
  createWalletChallenge(
    request: WalletChallengeRequestV1,
  ): Promise<WalletChallengeV1>;
  createSession(request: WalletSessionRequestV1): Promise<void>;
  createAccountToken(input: {
    idempotencyKey: string,
    request: AccountTokenCreateRequestV1,
  }): Promise<AccountTokenCreatedV1>;
  refreshAccount(): Promise<void>;
  restore(): Promise<void>;
  signOut(): Promise<void>;
  retry(): Promise<void>;
  forgetBrowser(): void;
  cancelPending(): void;
};

const WalletSessionContext = createContext<WalletSessionContextValue | null>(
  null,
);

type AccountAuthority = {
  marker: object;
  projectToken: string;
};

type AccountRefreshFlight = AccountAuthority & {
  promise: Promise<void>;
};

type AccountTokenIntent = {
  idempotencyKey: string;
  request: AccountTokenCreateRequestV1;
};

type AccountTokenFlight = AccountAuthority & {
  intent: AccountTokenIntent;
  promise: Promise<AccountTokenCreatedV1>;
};

function sameAccountTokenIntent(
  left: AccountTokenIntent,
  right: AccountTokenIntent,
): boolean {
  return left.idempotencyKey === right.idempotencyKey &&
    left.request.version === right.request.version &&
    left.request.kind === right.request.kind &&
    left.request.label === right.request.label &&
    left.request.expiresInDays === right.request.expiresInDays;
}

export function WalletSessionProvider({
  services,
  storage,
  children,
}: {
  services: WalletAccessServices;
  storage: StorageLike;
  children: ReactNode;
}) {
  const [runtime] = useState(() => ({
    services,
    controller: createWalletSessionController({ services, storage }),
  }));
  const controller = runtime.controller;
  const [snapshot, setSnapshot] = useState<WalletSessionSnapshot>(() =>
    controller.snapshot(),
  );
  const lifecycleRevision = useRef(0);
  const accountAuthority = useRef<object>({});
  const accountRefreshFlight = useRef<AccountRefreshFlight | null>(null);
  const accountTokenFlight = useRef<AccountTokenFlight | null>(null);

  const advanceAccountAuthority = useCallback(() => {
    accountAuthority.current = {};
  }, []);

  const refreshSnapshot = useCallback(() => {
    setSnapshot(controller.snapshot());
  }, [controller]);

  const runTransition = useCallback(
    async (start: () => Promise<void>) => {
      advanceAccountAuthority();
      const operation = start();
      refreshSnapshot();
      try {
        await operation;
      } finally {
        refreshSnapshot();
      }
    },
    [advanceAccountAuthority, refreshSnapshot],
  );

  const restore = useCallback(
    () => runTransition(controller.restore),
    [controller, runTransition],
  );

  const createSession = useCallback(
    (request: WalletSessionRequestV1) =>
      runTransition(() => controller.createSession(request)),
    [controller, runTransition],
  );

  const signOut = useCallback(
    () => runTransition(controller.signOut),
    [controller, runTransition],
  );

  const retry = useCallback(
    () => runTransition(controller.retry),
    [controller, runTransition],
  );

  const forgetBrowser = useCallback(() => {
    advanceAccountAuthority();
    controller.forgetBrowser();
    refreshSnapshot();
  }, [advanceAccountAuthority, controller, refreshSnapshot]);

  const cancelPending = useCallback(() => {
    advanceAccountAuthority();
    controller.cancelPending();
    refreshSnapshot();
  }, [advanceAccountAuthority, controller, refreshSnapshot]);

  const accessToken = useCallback(
    () => controller.accessToken(),
    [controller],
  );
  const listNetworks = useCallback(
    () => runtime.services.listNetworks(),
    [runtime],
  );
  const createWalletChallenge = useCallback(
    (request: WalletChallengeRequestV1) =>
      runtime.services.createWalletChallenge(request),
    [runtime],
  );

  const browserSessionRequired = useCallback(() => new WalletAccessError({
    kind: "http",
    status: 403,
    code: "ACCOUNT_SESSION_REQUIRED",
    retryable: false,
  }), []);

  const issueBusy = useCallback(() => new WalletAccessError({
    kind: "http",
    status: 409,
    code: "IDEMPOTENCY_CONFLICT",
    retryable: false,
  }), []);

  const refreshAccount = useCallback((): Promise<void> => {
    const projectToken = controller.accessToken();
    const controllerSnapshot = controller.snapshot();
    if (projectToken === null || controllerSnapshot.status !== "authenticated") {
      return Promise.reject(browserSessionRequired());
    }
    const marker = accountAuthority.current;
    const existing = accountRefreshFlight.current;
    if (existing?.marker === marker && existing.projectToken === projectToken) {
      return existing.promise;
    }

    let flight!: Promise<void>;
    flight = (async () => {
      const account = AccountV1Schema.parse(
        await runtime.services.getAccount({ projectToken }),
      );
      if (
        accountAuthority.current !== marker ||
        controller.accessToken() !== projectToken
      ) return;
      const current = controller.snapshot();
      if (current.status !== "authenticated") return;
      setSnapshot({ ...current, account });
    })().finally(() => {
      if (accountRefreshFlight.current?.promise === flight) {
        accountRefreshFlight.current = null;
      }
    });
    accountRefreshFlight.current = { marker, projectToken, promise: flight };
    return flight;
  }, [browserSessionRequired, controller, runtime]);

  const createAccountToken = useCallback((input: {
    idempotencyKey: string;
    request: AccountTokenCreateRequestV1;
  }): Promise<AccountTokenCreatedV1> => {
    const projectToken = controller.accessToken();
    const controllerSnapshot = controller.snapshot();
    if (projectToken === null || controllerSnapshot.status !== "authenticated") {
      return Promise.reject(browserSessionRequired());
    }
    const marker = accountAuthority.current;
    const intent: AccountTokenIntent = {
      idempotencyKey: input.idempotencyKey,
      request: {
        version: input.request.version,
        kind: input.request.kind,
        label: input.request.label,
        expiresInDays: input.request.expiresInDays,
      },
    };
    const existing = accountTokenFlight.current;
    if (existing?.marker === marker && existing.projectToken === projectToken) {
      return sameAccountTokenIntent(existing.intent, intent)
        ? existing.promise
        : Promise.reject(issueBusy());
    }

    let flight!: Promise<AccountTokenCreatedV1>;
    flight = (async () => {
      const created = AccountTokenCreatedV1Schema.parse(
        await runtime.services.createAccountToken({
          projectToken,
          idempotencyKey: intent.idempotencyKey,
          request: intent.request,
        }),
      );
      const currentAuthority = () =>
        accountAuthority.current === marker &&
        controller.accessToken() === projectToken &&
        controller.snapshot().status === "authenticated";
      if (!currentAuthority()) {
        throw browserSessionRequired();
      }

      try {
        await refreshAccount();
      } catch {
        if (!currentAuthority()) throw browserSessionRequired();
        return created;
      }
      if (!currentAuthority()) throw browserSessionRequired();
      return created;
    })().finally(() => {
      if (accountTokenFlight.current?.promise === flight) {
        accountTokenFlight.current = null;
      }
    });
    void flight.catch(() => undefined);
    accountTokenFlight.current = { marker, projectToken, intent, promise: flight };
    return flight;
  }, [browserSessionRequired, controller, issueBusy, refreshAccount, runtime]);

  useEffect(() => {
    let active = true;
    const effectRevision = ++lifecycleRevision.current;
    advanceAccountAuthority();
    const operation = controller.restore();
    setSnapshot(controller.snapshot());
    void operation.finally(() => {
      if (active) setSnapshot(controller.snapshot());
    });

    return () => {
      active = false;
      advanceAccountAuthority();
      queueMicrotask(() => {
        if (lifecycleRevision.current === effectRevision) controller.close();
      });
    };
  }, [advanceAccountAuthority, controller]);

  const value = useMemo<WalletSessionContextValue>(
    () => ({
      snapshot,
      accessToken,
      listNetworks,
      createWalletChallenge,
      createSession,
      createAccountToken,
      refreshAccount,
      restore,
      signOut,
      retry,
      forgetBrowser,
      cancelPending,
    }),
    [
      accessToken,
      cancelPending,
      createSession,
      createAccountToken,
      createWalletChallenge,
      forgetBrowser,
      listNetworks,
      refreshAccount,
      restore,
      retry,
      signOut,
      snapshot,
    ],
  );

  return (
    <WalletSessionContext.Provider value={value}>
      {children}
    </WalletSessionContext.Provider>
  );
}

export function useWalletSession(): WalletSessionContextValue {
  const value = useContext(WalletSessionContext);
  if (value === null) {
    throw new Error("WalletSessionProvider is required.");
  }
  return value;
}
