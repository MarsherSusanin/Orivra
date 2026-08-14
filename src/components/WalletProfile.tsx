import {
  CaretDown,
  CheckCircle,
  Copy,
  Gear,
  SignOut,
  SpinnerGap,
  Wallet,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useWalletSession } from "../wallet-session-context";
import { useWalletChrome } from "../wallet-chrome-context";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function shortWalletAddress(address: string): string {
  return ADDRESS.test(address)
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "Wallet unavailable";
}

function walletCells(address: string): readonly { x: number; y: number }[] {
  const normalized = address.toLowerCase().slice(2);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const nibble = Number.parseInt(normalized[(y * 3 + x) % normalized.length] ?? "0", 16);
      if ((nibble + x + y) % 2 === 0) {
        cells.push({ x, y });
        if (x !== 2) cells.push({ x: 4 - x, y });
      }
    }
  }
  return cells;
}

function WalletIdenticon({ address }: { address: string }) {
  const cells = useMemo(() => walletCells(address), [address]);
  const hue = Number.parseInt(address.slice(2, 6), 16) % 360;
  return (
    <svg className="wallet-identicon" viewBox="0 0 7 7" aria-hidden="true">
      <rect width="7" height="7" rx="1.75" fill={`hsl(${hue} 34% 17%)`} />
      {cells.map(({ x, y }) => (
        <rect
          key={`${x}:${y}`}
          x={x + 1}
          y={y + 1}
          width="1"
          height="1"
          rx="0.16"
          fill={`hsl(${(hue + 34) % 360} 82% 62%)`}
        />
      ))}
    </svg>
  );
}

function focusMenuItem(menu: HTMLElement | null, offset: number) {
  const items = Array.from(
    menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
  );
  if (items.length === 0) return;
  const active = items.indexOf(document.activeElement as HTMLElement);
  items[(active + offset + items.length) % items.length]?.focus();
}

function SignOutDialog({ onClose }: { onClose(): void }) {
  const { snapshot, signOut, retry, forgetBrowser } = useWalletSession();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pending = snapshot.status === "signing-out";
  const failed = snapshot.status === "unavailable" && snapshot.operation === "sign-out";

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (snapshot.status === "anonymous") onClose();
  }, [onClose, snapshot.status]);

  return (
    <div className="dialog-backdrop wallet-signout-backdrop" role="presentation">
      <section
        className="wallet-signout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-signout-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header>
          <div>
            <span className="section-label">Browser session</span>
            <h2 id="wallet-signout-title">Sign out this browser?</h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close sign out confirmation"
            disabled={pending}
            onClick={onClose}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        {failed ? (
          <div className="wallet-signout-failure" role="alert">
            <WarningCircle size={24} aria-hidden="true" />
            <div>
              <strong>Server sign out is unavailable</strong>
              <p>Retry revocation, or forget only this browser without claiming server revocation.</p>
            </div>
          </div>
        ) : (
          <p>Remove the verified wallet session from this tab. This does not disconnect or prompt your wallet provider.</p>
        )}
        <div className="wallet-signout-actions">
          <button ref={cancelRef} className="entry-secondary" type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          {failed ? (
            <>
              <button className="entry-secondary" type="button" onClick={() => void retry()}>Retry</button>
              <button className="wallet-danger-action" type="button" onClick={forgetBrowser}>Forget this browser</button>
            </>
          ) : (
            <button className="wallet-danger-action" type="button" disabled={pending} onClick={() => void signOut()}>
              {pending ? <SpinnerGap className="spinner" size={17} aria-hidden="true" /> : <SignOut size={17} aria-hidden="true" />}
              {pending ? "Signing out…" : "Confirm sign out"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function WalletProfileSession({
  chrome,
}: {
  chrome: NonNullable<ReturnType<typeof useWalletChrome>>;
}) {
  const wallet = useWalletSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const verifiedAddressRef = useRef("");
  const authenticatedAddress =
    wallet.snapshot.status === "authenticated" &&
    ADDRESS.test(wallet.snapshot.wallet.address)
      ? wallet.snapshot.wallet.address
      : "";

  useEffect(() => {
    if (authenticatedAddress) verifiedAddressRef.current = authenticatedAddress;
  }, [authenticatedAddress]);

  useEffect(() => {
    if (wallet.snapshot.status === "anonymous") setConfirmingSignOut(false);
  }, [wallet.snapshot.status]);

  useEffect(() => {
    if (chrome.authority !== "wallet") {
      setMenuOpen(false);
      setConfirmingSignOut(false);
    }
  }, [chrome.authority]);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    setCopied(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        closeMenu(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [closeMenu, menuOpen]);

  if (chrome.authority === "shared") return <span className="wallet-authority-label">Shared access</span>;
  if (chrome.authority === "token") return <span className="wallet-authority-label">Token access</span>;

  if (wallet.snapshot.status === "restoring") {
    return <span className="wallet-session-state" role="status"><SpinnerGap className="spinner" size={17} aria-hidden="true" />Restoring</span>;
  }
  const signOutInProgress =
    wallet.snapshot.status === "signing-out" ||
    (wallet.snapshot.status === "unavailable" && wallet.snapshot.operation === "sign-out");
  if (wallet.snapshot.status === "unavailable" && !signOutInProgress) {
    return <button className="wallet-session-retry" type="button" onClick={() => void wallet.retry()}><WarningCircle size={17} aria-hidden="true" />Retry session</button>;
  }
  if (wallet.snapshot.status !== "authenticated" && !signOutInProgress) {
    return <button className="wallet-signin-trigger" type="button" onClick={chrome.openSignIn}><Wallet size={18} aria-hidden="true" />Sign in with wallet</button>;
  }

  const address = authenticatedAddress || verifiedAddressRef.current;
  if (!ADDRESS.test(address)) return null;
  const shortAddress = shortWalletAddress(address);

  const menuKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem(menuRef.current, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(menuRef.current, -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
      items?.[event.key === "Home" ? 0 : Math.max(0, items.length - 1)]?.focus();
    } else if (event.key === "Tab") {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      const active = items.indexOf(document.activeElement as HTMLElement);
      if (
        (!event.shiftKey && active === items.length - 1) ||
        (event.shiftKey && active === 0)
      ) queueMicrotask(() => closeMenu(false));
    }
  };

  return (
    <div className="wallet-profile">
      <button
        ref={triggerRef}
        className="wallet-profile-trigger"
        type="button"
        aria-label={`Wallet profile ${shortAddress}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          if (menuOpen) {
            closeMenu();
            return;
          }
          setMenuOpen(true);
          queueMicrotask(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
        }}
      >
        <WalletIdenticon address={address} />
        <span className="wallet-profile-address">{shortAddress}</span>
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </button>
      {menuOpen ? (
        <div ref={menuRef} className="wallet-profile-menu" role="menu" aria-label="Wallet profile" onKeyDown={menuKeys}>
          <header>
            <span><CheckCircle size={16} weight="fill" aria-hidden="true" />Verified wallet</span>
            <code>{address}</code>
          </header>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              try {
                const clipboard = navigator.clipboard;
                if (!clipboard?.writeText) throw new Error("Clipboard is unavailable");
                await clipboard.writeText.call(clipboard, address);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={17} aria-hidden="true" />{copied ? "Address copied" : "Copy address"}
          </button>
          <a role="menuitem" href="/app/settings"><Gear size={17} aria-hidden="true" />Account settings</a>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              closeMenu(false);
              setConfirmingSignOut(true);
            }}
          >
            <SignOut size={17} aria-hidden="true" />Sign out
          </button>
        </div>
      ) : null}
      {confirmingSignOut ? <SignOutDialog onClose={() => {
        setConfirmingSignOut(false);
        queueMicrotask(() => triggerRef.current?.focus());
      }} /> : null}
    </div>
  );
}

export function WalletProfile() {
  const chrome = useWalletChrome();
  return chrome ? <WalletProfileSession chrome={chrome} /> : null;
}
