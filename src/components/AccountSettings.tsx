import { Copy, Key, SpinnerGap, Wallet, X } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  AccountTokenCreateRequestV1,
  AccountTokenSummaryV1,
} from "@proofline/contracts";
import { useWalletSession } from "../wallet-session-context";

const TOKEN_ISSUE_PREFIX = "token_issue_";

function tokenIssueKey(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return TOKEN_ISSUE_PREFIX + Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function tokenStatus(token: AccountTokenSummaryV1): "active" | "expired" | "revoked" {
  if (token.revokedAt !== null) return "revoked";
  return Date.parse(token.expiresAt) <= Date.now() ? "expired" : "active";
}

function clipboardWrite(): ((value: string) => Promise<void>) | null {
  try {
    const writeText = navigator.clipboard?.writeText;
    return typeof writeText === "function"
      ? writeText.bind(navigator.clipboard)
      : null;
  } catch {
    return null;
  }
}

function TokenRevealDialog({
  token,
  onClear,
}: {
  token: string;
  onClear(): void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const tokenRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const writeClipboard = clipboardWrite();

  const requestClose = useCallback(() => {
    if (copied) {
      onClear();
      return;
    }
    setConfirming(true);
  }, [copied, onClear]);

  const keepVisible = useCallback(() => {
    setConfirming(false);
  }, []);

  const copyToken = useCallback(async () => {
    try {
      await writeClipboard!(token);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }, [token, writeClipboard]);

  const trapFocus = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last!.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first!.focus();
    }
  }, [requestClose]);

  useLayoutEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    if (writeClipboard === null) tokenRef.current?.focus();
    else copyRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (confirming) keepRef.current?.focus();
    else copyRef.current?.focus();
  }, [confirming]);

  return (
    <div className="dialog-backdrop settings-token-reveal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="verification-dialog settings-token-reveal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-token-reveal-title"
        aria-describedby="settings-token-reveal-description"
        onKeyDown={trapFocus}
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-kicker">One-time credential</span>
            <h2 id="settings-token-reveal-title">
              {confirming ? "Close without copying?" : "Save this token now"}
            </h2>
          </div>
          <button
            className="close-button"
            type="button"
            aria-label="Close token reveal"
            onClick={requestClose}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog-body settings-token-reveal-body">
          {confirming ? (
            <div className="settings-token-loss">
              <p id="settings-token-reveal-description">
                Proofline cannot show this token again. Copy it before closing or generate a replacement later.
              </p>
              <div className="settings-reveal-actions">
                <button
                  ref={keepRef}
                  className="dialog-primary"
                  type="button"
                  onClick={keepVisible}
                >
                  Keep token visible
                </button>
                <button className="entry-secondary" type="button" onClick={onClear}>
                  Close without copying
                </button>
              </div>
            </div>
          ) : (
            <>
              <p id="settings-token-reveal-description">
                Store this secret in your local environment. Only this response contains the raw value.
              </p>
              <div
                ref={tokenRef}
                className="settings-reveal-token"
                role="textbox"
                aria-label="Generated project token"
                aria-readonly="true"
                tabIndex={0}
              >
                {token}
              </div>
              <p className="settings-token-hint">
                Export as <code>PROOFLINE_PROJECT_TOKEN</code> for CLI or Action use.
              </p>
              {writeClipboard === null ? (
                <p className="settings-safe-error">Clipboard access is unavailable. Copy the token manually.</p>
              ) : null}
              {copyFailed ? <p className="settings-safe-error" role="alert">Token was not copied. Keep this dialog open and try again.</p> : null}
              <div className="settings-reveal-actions">
                <button
                  ref={copyRef}
                  className="dialog-primary"
                  type="button"
                  disabled={writeClipboard === null}
                  onClick={() => void copyToken()}
                >
                  <Copy size={18} aria-hidden="true" />{writeClipboard === null ? "Copy unavailable" : "Copy"}
                </button>
                {copied ? <span className="copy-status" aria-live="polite">Copied. Escape closes this reveal.</span> : null}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function AccountSettings({
  onRequireWallet,
  browserSessionBlocked = false,
}: {
  onRequireWallet(): void;
  browserSessionBlocked?: boolean;
}) {
  const { snapshot, createAccountToken, refreshAccount } = useWalletSession();
  const [kind, setKind] = useState<"cli" | "action">("cli");
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [errors, setErrors] = useState<{ label?: string; expiresInDays?: string }>({});
  const [failure, setFailure] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [accountRefreshFailed, setAccountRefreshFailed] = useState(false);
  const issueFlight = useRef<Promise<void> | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const expiresRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const browserAuthorized = useRef(snapshot.status === "authenticated");
  browserAuthorized.current = snapshot.status === "authenticated";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const needsAccount = snapshot.status === "authenticated" && snapshot.account === undefined;
  useEffect(() => {
    if (!needsAccount) return;
    void refreshAccount().catch(() => setAccountRefreshFailed(true));
  }, [needsAccount, refreshAccount]);

  const copyWalletAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // The address remains visible for manual copying.
    }
  }, []);

  const submit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (issueFlight.current) return;
    const trimmedLabel = label.trim();
    const days = Number(expiresInDays);
    const nextErrors = {
      label: trimmedLabel.length >= 1 && trimmedLabel.length <= 128
        ? undefined
        : "Enter a label between 1 and 128 characters.",
      expiresInDays: Number.isInteger(days) && days >= 1 && days <= 90
        ? undefined
        : "Enter a whole number from 1 to 90.",
    };
    setErrors(nextErrors);
    setFailure(false);
    if (nextErrors.label || nextErrors.expiresInDays) {
      if (nextErrors.label) labelRef.current?.focus();
      else expiresRef.current?.focus();
      return;
    }

    let idempotencyKey: string;
    try {
      idempotencyKey = tokenIssueKey();
    } catch {
      setFailure(true);
      return;
    }
    const request: AccountTokenCreateRequestV1 = {
      version: "1",
      kind,
      label: trimmedLabel,
      expiresInDays: days,
    };
    let flight!: Promise<void>;
    setIssuing(true);
    flight = (async () => {
      try {
        const created = await createAccountToken({ idempotencyKey, request });
        if (!mounted.current || !browserAuthorized.current) return;
        try {
          await refreshAccount();
        } catch {
          // The raw one-time result remains recoverable even if summary refresh fails.
        }
        if (!mounted.current || !browserAuthorized.current) return;
        setRevealToken(created.token);
      } catch {
        setFailure(true);
      } finally {
        issueFlight.current = null;
        setIssuing(false);
      }
    })();
    issueFlight.current = flight;
  }, [createAccountToken, expiresInDays, kind, label, refreshAccount]);

  if (browserSessionBlocked) {
    return (
      <main className="settings-account settings-account-locked">
        <section className="entry-state" aria-labelledby="settings-browser-required-title">
          <Wallet className="entry-state-icon" size={34} aria-hidden="true" />
          <h1 id="settings-browser-required-title">Browser wallet session required</h1>
          <p>CLI, Action, legacy and shared capabilities cannot manage account credentials.</p>
        </section>
      </main>
    );
  }

  if (snapshot.status !== "authenticated") {
    return (
      <main className="settings-account">
        <header className="settings-heading">
          <span className="section-label">ACCOUNT</span>
          <h1>Account settings</h1>
          <p>Manage credentials issued by this authenticated browser wallet session.</p>
        </header>
        <section className="settings-session-card" aria-label="Wallet session required">
          <Wallet size={36} aria-hidden="true" />
          <div>
            <h2>Sign in to manage access</h2>
            <p>Verify a Coston2 EOA before issuing a CLI or GitHub Action token.</p>
          </div>
          <button className="entry-primary" type="button" onClick={onRequireWallet}>
            Sign in with wallet
          </button>
        </section>
      </main>
    );
  }

  const account = snapshot.account;
  if (!account) {
    return (
      <main className="settings-account">
        <header className="settings-heading">
          <span className="section-label">ACCOUNT</span>
          <h1>Account settings</h1>
        </header>
        <section className="settings-loading" aria-live="polite">
          {accountRefreshFailed ? (
            <p className="settings-safe-error" role="alert">Account could not be loaded. Retry safely.</p>
          ) : (
            <><SpinnerGap className="wallet-sign-in-spinner" size={24} aria-hidden="true" />Loading account…</>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="settings-account">
      <header className="settings-heading">
        <span className="section-label">ACCOUNT</span>
        <h1>Account settings</h1>
        <p>Issue scoped credentials without exposing this browser session.</p>
      </header>

      <section className="settings-panel" aria-labelledby="settings-wallet-title">
        <div className="settings-panel-heading">
          <div>
            <span className="section-label">WALLET IDENTITY</span>
            <h2 id="settings-wallet-title">Connected wallet</h2>
          </div>
          <button className="entry-secondary" type="button" onClick={() => void copyWalletAddress(account.wallet.address)} aria-label="Copy wallet address">
            <Copy size={17} aria-hidden="true" />Copy
          </button>
        </div>
        <code className="settings-wallet-address">{account.wallet.address}</code>
      </section>

      <section className="settings-panel" aria-labelledby="settings-tokens-title">
        <div className="settings-panel-heading">
          <div>
            <span className="section-label">ACCESS TOKENS</span>
            <h2 id="settings-tokens-title">Issued credentials</h2>
          </div>
        </div>
        {account.tokens.length > 0 ? (
          <ul className="settings-token-list" aria-label="Access tokens">
            {account.tokens.map((token) => {
              const status = tokenStatus(token);
              return (
                <li key={token.tokenId}>
                  <Key size={19} aria-hidden="true" />
                  <div><strong>{token.label}</strong><span>{token.kind}</span></div>
                  <span className={`settings-token-status is-${status}`}>{status}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="settings-empty">No CLI or Action credentials yet.</p>}
      </section>

      <section className="settings-panel" aria-labelledby="settings-generate-title">
        <div className="settings-panel-heading">
          <div>
            <span className="section-label">NEW CREDENTIAL</span>
            <h2 id="settings-generate-title">Generate access token</h2>
          </div>
        </div>
        <form className="settings-token-form" onSubmit={submit} noValidate>
          <label>Token kind
            <select value={kind} onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "cli" || value === "action") setKind(value);
            }}>
              <option value="cli">CLI</option>
              <option value="action">GitHub Action</option>
            </select>
          </label>
          <label>Label
            <input
              ref={labelRef}
              aria-label="Label"
              aria-describedby={errors.label ? "settings-label-error" : undefined}
              aria-invalid={errors.label ? "true" : undefined}
              value={label}
              maxLength={130}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
            {errors.label ? <span id="settings-label-error" role="alert">{errors.label}</span> : null}
          </label>
          <label>Expires in days
            <input
              ref={expiresRef}
              aria-label="Expires in days"
              aria-describedby={errors.expiresInDays ? "settings-expiry-error" : undefined}
              aria-invalid={errors.expiresInDays ? "true" : undefined}
              type="number"
              min="1"
              max="90"
              step="1"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.currentTarget.value)}
            />
            {errors.expiresInDays ? <span id="settings-expiry-error" role="alert">Enter an integer from 1 to 90.</span> : null}
          </label>
          <button className="entry-primary settings-generate" type="submit" disabled={issuing}>
            {issuing ? "Generating…" : "Generate"}
          </button>
        </form>
        {failure ? <p className="settings-safe-error" role="alert">Token could not be generated. Retry safely.</p> : null}
      </section>

      {revealToken ? <TokenRevealDialog token={revealToken} onClear={() => setRevealToken(null)} /> : null}
    </main>
  );
}
