import { CheckCircle, SpinnerGap, Wallet, WarningCircle, X } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { NetworkCapabilityV1 } from "@proofline/contracts";
import type {
  BrowserPort,
  Eip1193Provider,
  ProviderOption,
  WalletProviderAdapter,
} from "../services/wallet-provider-adapter";
import { useWalletSession } from "../wallet-session-context";

type ProviderAdapterModule = typeof import("../services/wallet-provider-adapter");

type DialogStage =
  | "idle"
  | "discovering"
  | "choosing-provider"
  | "connecting"
  | "creating-challenge"
  | "awaiting-signature"
  | "creating-session"
  | "authenticated"
  | "rejected"
  | "provider-unavailable"
  | "unsupported"
  | "contract-wallet-unsupported"
  | "challenge-expired"
  | "signature-invalid"
  | "offline"
  | "error";

type DialogView = {
  stage: DialogStage;
  providers: readonly ProviderOption[];
  walletName: string | null;
};

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

const INITIAL_VIEW: DialogView = {
  stage: "idle",
  providers: [],
  walletName: null,
};

const FAILURE_COPY: Partial<Record<DialogStage, { title: string; body: string }>> = {
  rejected: {
    title: "Wallet request rejected",
    body: "No session was created. Retry when you are ready to approve the wallet request.",
  },
  "provider-unavailable": {
    title: "Wallet unavailable",
    body: "Orivra could not reach a compatible browser wallet.",
  },
  unsupported: {
    title: "Coston2 unavailable",
    body: "Wallet sign-in requires the enabled Coston2 network capability.",
  },
  "contract-wallet-unsupported": {
    title: "Contract wallet unsupported",
    body: "This release supports EOA wallet sessions only.",
  },
  "challenge-expired": {
    title: "Challenge expired",
    body: "The single-use challenge is no longer available. Start a fresh sign-in.",
  },
  "signature-invalid": {
    title: "Signature invalid",
    body: "The signature did not match the verified wallet and challenge.",
  },
  offline: {
    title: "Orivra is offline",
    body: "The request did not reach Orivra. Retry safely when connectivity returns.",
  },
  error: {
    title: "Challenge could not be verified",
    body: "Orivra stopped before signing because the authentication evidence was invalid.",
  },
};

const ERROR_STAGES: Readonly<Record<string, DialogStage>> = {
  WALLET_REQUEST_REJECTED: "rejected",
  NETWORK_CAPABILITY_DISABLED: "unsupported",
  CONTRACT_WALLET_UNSUPPORTED: "contract-wallet-unsupported",
  CHALLENGE_UNAVAILABLE: "challenge-expired",
  WALLET_SIGNATURE_INVALID: "signature-invalid",
  TRANSPORT_UNAVAILABLE: "offline",
  WALLET_PROVIDER_UNAVAILABLE: "provider-unavailable",
  WALLET_OPERATION_IN_PROGRESS: "provider-unavailable",
  WALLET_OPERATION_CANCELLED: "provider-unavailable",
};

function loadDefaultProviderAdapter(): Promise<ProviderAdapterModule> {
  return import("../services/wallet-provider-adapter");
}

function createBrowserPort(): BrowserPort {
  const browserWindow = window as typeof window & {
    ethereum?: Eip1193Provider;
  };
  return {
    addEventListener(type, listener) {
      browserWindow.addEventListener(type, listener as EventListener);
    },
    removeEventListener(type, listener) {
      browserWindow.removeEventListener(type, listener as EventListener);
    },
    dispatchEvent(event) {
      return browserWindow.dispatchEvent(new Event(event.type));
    },
    get ethereum() {
      return browserWindow.ethereum;
    },
  };
}

function createClock() {
  return {
    wait(milliseconds: number) {
      return new Promise<void>((resolve) => {
        window.setTimeout(resolve, milliseconds);
      });
    },
  };
}

function ownErrorCode(cause: unknown): string | null {
  try {
    if (!cause || typeof cause !== "object") return null;
    const descriptor = Object.getOwnPropertyDescriptor(cause, "code");
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function failureStage(cause: unknown): DialogStage {
  const code = ownErrorCode(cause);
  return code === null ? "error" : (ERROR_STAGES[code] ?? "error");
}

function challengeMatches(
  challenge: {
    address: string;
    network: string;
    chainId: number;
    purpose: string;
  },
  address: string,
): boolean {
  return (
    challenge.address === address &&
    challenge.network === "coston2" &&
    challenge.chainId === 114 &&
    challenge.purpose === "browser-session"
  );
}

function runningCopy(stage: DialogStage, walletName: string | null): string {
  switch (stage) {
    case "discovering":
      return "Discovering wallets…";
    case "connecting":
      return `Connecting to ${walletName}…`;
    case "creating-challenge":
      return "Creating secure challenge…";
    case "awaiting-signature":
      return `Confirm the signature in ${walletName}…`;
    case "creating-session":
      return "Creating Orivra session…";
    default:
      return "";
  }
}

function isRunning(stage: DialogStage): boolean {
  return (
    stage === "discovering" ||
    stage === "connecting" ||
    stage === "creating-challenge" ||
    stage === "awaiting-signature" ||
    stage === "creating-session"
  );
}

export function WalletSignInDialog({
  onClose,
  onAuthenticated,
  loadProviderAdapter = loadDefaultProviderAdapter,
  browser,
  clock,
}: {
  onClose(): void;
  onAuthenticated?(): void;
  loadProviderAdapter?: () => Promise<ProviderAdapterModule>;
  browser?: BrowserPort;
  clock?: { wait(milliseconds: number): Promise<void> };
}) {
  const {
    snapshot,
    listNetworks,
    createWalletChallenge,
    createSession,
    cancelPending: cancelSession,
  } = useWalletSession();
  const [view, setView] = useState<DialogView>(INITIAL_VIEW);
  const dialogRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const adapterRef = useRef<WalletProviderAdapter | null>(null);
  const providersRef = useRef<readonly ProviderOption[]>([]);
  const capabilityRef = useRef<NetworkCapabilityV1 | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  const disposeAdapter = useCallback(() => {
    const adapter = adapterRef.current;
    adapterRef.current = null;
    if (adapter === null) return;
    try {
      adapter.cancelPending();
    } catch {
      // A malformed injected adapter cannot block dialog cancellation.
    }
    try {
      adapter.close();
    } catch {
      // The dialog owns no provider data after its private reference is cleared.
    }
  }, []);

  const cancelJourney = useCallback(() => {
    attemptRef.current += 1;
    disposeAdapter();
    cancelSession();
  }, [cancelSession, disposeAdapter]);

  const closeDialog = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    cancelJourney();
    onClose();
  }, [cancelJourney, onClose]);

  const fail = useCallback(
    (attempt: number, stage: DialogStage) => {
      if (closedRef.current || attemptRef.current !== attempt) return;
      attemptRef.current += 1;
      disposeAdapter();
      providersRef.current = [];
      capabilityRef.current = null;
      setView({ stage, providers: [], walletName: null });
    },
    [disposeAdapter],
  );

  const startSignIn = useCallback(async () => {
    if (closedRef.current) return;
    disposeAdapter();
    providersRef.current = [];
    capabilityRef.current = null;
    const attempt = ++attemptRef.current;
    setView({ stage: "discovering", providers: [], walletName: null });

    let networksPromise: ReturnType<typeof listNetworks>;
    try {
      networksPromise = listNetworks();
    } catch (cause) {
      networksPromise = Promise.reject(cause);
    }
    let providersPromise: Promise<readonly ProviderOption[]>;
    try {
      providersPromise = loadProviderAdapter().then(async (module) => {
        if (closedRef.current || attemptRef.current !== attempt) return [];
        const adapter = module.createWalletProviderAdapter({
          browser: browser ?? createBrowserPort(),
          clock: clock ?? createClock(),
        });
        if (closedRef.current || attemptRef.current !== attempt) {
          try {
            adapter.close();
          } catch {
            // A stale injected adapter is discarded without exposing its error.
          }
          return [];
        }
        adapterRef.current = adapter;
        return adapter.discoverProviders();
      });
    } catch (cause) {
      providersPromise = Promise.reject(cause);
    }

    try {
      const [networkReport, providers] = await Promise.all([
        networksPromise,
        providersPromise,
      ]);
      if (closedRef.current || attemptRef.current !== attempt) return;
      const capability = networkReport.networks.find(
        (item) =>
          item.network === "coston2" &&
          item.web2JsonStatus === "enabled",
      );
      if (!capability) {
        fail(attempt, "unsupported");
        return;
      }
      if (providers.length === 0) {
        fail(attempt, "provider-unavailable");
        return;
      }
      providersRef.current = providers;
      capabilityRef.current = capability;
      setView({
        stage: "choosing-provider",
        providers,
        walletName: null,
      });
    } catch (cause) {
      fail(attempt, failureStage(cause));
    }
  }, [browser, clock, disposeAdapter, fail, listNetworks, loadProviderAdapter]);

  const selectProvider = useCallback(
    async (providerId: string) => {
      if (closedRef.current) return;
      const selected = providersRef.current.find(
        (provider) => provider.id === providerId,
      );
      const capability = capabilityRef.current;
      const adapter = adapterRef.current;
      if (!selected || !capability || !adapter) return;

      const attempt = ++attemptRef.current;
      setView({
        stage: "connecting",
        providers: providersRef.current,
        walletName: selected.name,
      });
      try {
        const connection = await adapter.connect({
          provider: selected.provider,
          networkCapability: capability,
        });
        if (closedRef.current || attemptRef.current !== attempt) return;
        if (connection.chainId !== "0x72") {
          fail(attempt, "unsupported");
          return;
        }
        setView((current) => ({ ...current, stage: "creating-challenge" }));

        const challenge = await createWalletChallenge({
          version: "1",
          address: connection.address,
        });
        if (closedRef.current || attemptRef.current !== attempt) return;
        if (!challengeMatches(challenge, connection.address)) {
          fail(attempt, "error");
          return;
        }
        setView((current) => ({ ...current, stage: "awaiting-signature" }));

        const signature = await adapter.signMessage({
          message: challenge.message,
        });
        if (closedRef.current || attemptRef.current !== attempt) return;
        if (
          signature.address !== connection.address ||
          !SIGNATURE.test(signature.signature)
        ) {
          fail(attempt, "signature-invalid");
          return;
        }
        setView((current) => ({ ...current, stage: "creating-session" }));

        await createSession({
          version: "1",
          challengeId: challenge.challengeId,
          signature: signature.signature,
        });
        if (closedRef.current || attemptRef.current !== attempt) return;
        adapterRef.current = null;
        adapter.close();
        setView({
          stage: "authenticated",
          providers: [],
          walletName: selected.name,
        });
        try {
          onAuthenticated?.();
        } catch {
          // The persisted authenticated session remains authoritative.
        }
      } catch (cause) {
        fail(attempt, failureStage(cause));
      }
    },
    [createSession, createWalletChallenge, fail, onAuthenticated],
  );

  const chooseProvider = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const providerId = event.currentTarget.dataset.providerId;
      if (providerId) void selectProvider(providerId);
    },
    [selectProvider],
  );

  const moveProviderFocus = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const list = event.currentTarget.closest('[role="listbox"]');
      const options = Array.from(
        list?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
      );
      const index = options.indexOf(event.currentTarget);
      if (index < 0 || options.length === 0) return;
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      options[(index + offset + options.length) % options.length]?.focus();
    },
    [],
  );

  const trapFocus = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeDialog],
  );

  useLayoutEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    primaryRef.current?.focus();
    return () => {
      if (!closedRef.current) cancelJourney();
      previousFocusRef.current?.focus();
    };
  }, [cancelJourney]);

  useEffect(() => {
    if (view.stage === "choosing-provider") {
      dialogRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
      return;
    }
    if (isRunning(view.stage)) {
      closeRef.current?.focus();
      return;
    }
    if (view.stage !== "idle") primaryRef.current?.focus();
  }, [view.stage]);

  const failure = FAILURE_COPY[view.stage];
  const status = runningCopy(view.stage, view.walletName);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="verification-dialog wallet-sign-in-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-sign-in-title"
        aria-describedby="wallet-sign-in-description"
        onKeyDown={trapFocus}
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-kicker">Coston2 access</span>
            <h2 id="wallet-sign-in-title">Sign in with wallet</h2>
          </div>
          <button
            ref={closeRef}
            className="close-button"
            type="button"
            onClick={closeDialog}
            aria-label="Close wallet sign in"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>

        <div className="dialog-body wallet-sign-in-body">
          {view.stage === "idle" ? (
            <div className="wallet-sign-in-intro">
              <Wallet size={34} aria-hidden="true" />
              <p id="wallet-sign-in-description">
                Use a compatible injected EVM wallet to verify a Coston2 EOA and sign one five-minute challenge. No transaction or gas is required.
              </p>
              <button
                ref={primaryRef}
                className="dialog-primary"
                type="button"
                onClick={() => void startSignIn()}
              >
                Sign in with wallet
              </button>
            </div>
          ) : null}

          {isRunning(view.stage) ? (
            <div className="wallet-sign-in-running">
              <SpinnerGap className="wallet-sign-in-spinner" size={28} aria-hidden="true" />
              <p id="wallet-sign-in-description" aria-live="polite">{status}</p>
            </div>
          ) : null}

          {view.stage === "choosing-provider" ? (
            <div className="wallet-provider-step">
              <p id="wallet-sign-in-description">
                Choose the wallet that will verify an EOA and sign the server challenge.
              </p>
              <div
                className="wallet-provider-list"
                role="listbox"
                aria-label="Detected wallets"
              >
                {view.providers.map((provider) => (
                  <button
                    key={provider.id}
                    className="wallet-provider-option"
                    type="button"
                    role="option"
                    aria-selected="false"
                    data-provider-id={provider.id}
                    onClick={chooseProvider}
                    onKeyDown={moveProviderFocus}
                  >
                    <span className="wallet-provider-mark" aria-hidden="true">
                      <Wallet size={18} weight="fill" />
                    </span>
                    <span>{provider.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {failure ? (
            <div className="wallet-sign-in-result wallet-sign-in-failure">
              <WarningCircle size={34} aria-hidden="true" />
              <h3>{failure.title}</h3>
              <p id="wallet-sign-in-description">{failure.body}</p>
              <button
                ref={primaryRef}
                className="dialog-primary"
                type="button"
                onClick={() => void startSignIn()}
              >
                Try again
              </button>
            </div>
          ) : null}

          {view.stage === "authenticated" ? (
            <div className="wallet-sign-in-result wallet-sign-in-success">
              <CheckCircle size={36} weight="fill" aria-hidden="true" />
              <h3>Signed in</h3>
              <p id="wallet-sign-in-description">
                Verified wallet <code>{snapshot.status === "authenticated"
                  ? `${snapshot.wallet.address.slice(0, 6)}…${snapshot.wallet.address.slice(-4)}`
                  : "available"}</code>. This browser session can now open your persisted Orivra runs.
              </p>
              <button
                ref={primaryRef}
                className="dialog-primary"
                type="button"
                onClick={closeDialog}
              >
                Continue
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
