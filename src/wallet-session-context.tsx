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
  NetworkCapabilitiesV1,
  WalletChallengeRequestV1,
  WalletChallengeV1,
  WalletSessionRequestV1,
} from "@proofline/contracts";
import type { WalletAccessServices } from "./services/wallet-access-client";
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
      createWalletChallenge,
      forgetBrowser,
      listNetworks,
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
