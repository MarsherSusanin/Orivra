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
  const accountRefreshFlight = useRef<Promise<void> | null>(null);

  const refreshSnapshot = useCallback(() => {
    setSnapshot(controller.snapshot());
  }, [controller]);

  const runTransition = useCallback(
    async (start: () => Promise<void>) => {
      const operation = start();
      refreshSnapshot();
      try {
        await operation;
      } finally {
        refreshSnapshot();
      }
    },
    [refreshSnapshot],
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
    controller.forgetBrowser();
    refreshSnapshot();
  }, [controller, refreshSnapshot]);

  const cancelPending = useCallback(() => {
    controller.cancelPending();
    refreshSnapshot();
  }, [controller, refreshSnapshot]);

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

  const refreshAccount = useCallback((): Promise<void> => {
    const existing = accountRefreshFlight.current;
    if (existing) return existing;
    const projectToken = controller.accessToken();
    const controllerSnapshot = controller.snapshot();
    if (projectToken === null || controllerSnapshot.status !== "authenticated") {
      return Promise.reject(browserSessionRequired());
    }

    let flight!: Promise<void>;
    flight = (async () => {
      const account = AccountV1Schema.parse(
        await runtime.services.getAccount({ projectToken }),
      );
      if (controller.accessToken() !== projectToken) return;
      const current = controller.snapshot();
      if (current.status !== "authenticated") return;
      setSnapshot({ ...current, account });
    })().finally(() => {
      accountRefreshFlight.current = null;
    });
    accountRefreshFlight.current = flight;
    return flight;
  }, [browserSessionRequired, controller, runtime]);

  const createAccountToken = useCallback(async (input: {
    idempotencyKey: string;
    request: AccountTokenCreateRequestV1;
  }): Promise<AccountTokenCreatedV1> => {
    const projectToken = controller.accessToken();
    const controllerSnapshot = controller.snapshot();
    if (projectToken === null || controllerSnapshot.status !== "authenticated") {
      throw browserSessionRequired();
    }
    return AccountTokenCreatedV1Schema.parse(
      await runtime.services.createAccountToken({
        projectToken,
        idempotencyKey: input.idempotencyKey,
        request: input.request,
      }),
    );
  }, [browserSessionRequired, controller, runtime]);

  useEffect(() => {
    let active = true;
    const effectRevision = ++lifecycleRevision.current;
    const operation = controller.restore();
    setSnapshot(controller.snapshot());
    void operation.finally(() => {
      if (active) setSnapshot(controller.snapshot());
    });

    return () => {
      active = false;
      queueMicrotask(() => {
        if (lifecycleRevision.current === effectRevision) controller.close();
      });
    };
  }, [controller]);

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
