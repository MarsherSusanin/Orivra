import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WalletSignInDialog } from "./components/WalletSignInDialog";
import type { BrowserPort } from "./services/wallet-provider-adapter";

export type WalletChromeAuthority = "wallet" | "shared" | "token";

type WalletChromeContextValue = {
  authority: WalletChromeAuthority;
  openSignIn(): void;
};

const WalletChromeContext = createContext<WalletChromeContextValue | null>(null);

export function WalletChromeProvider({
  authority,
  dialog,
  children,
}: {
  authority: WalletChromeAuthority;
  dialog?: {
    loadProviderAdapter?: () => Promise<
      typeof import("./services/wallet-provider-adapter")
    >;
    browser?: BrowserPort;
    clock?: { wait(milliseconds: number): Promise<void> };
  };
  children: ReactNode;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const openSignIn = useCallback(() => {
    if (authority === "wallet") setDialogOpen(true);
  }, [authority]);
  const closeSignIn = useCallback(() => setDialogOpen(false), []);
  useEffect(() => {
    if (authority !== "wallet") setDialogOpen(false);
  }, [authority]);
  const value = useMemo(
    () => ({ authority, openSignIn }),
    [authority, openSignIn],
  );

  return (
    <WalletChromeContext.Provider value={value}>
      {children}
      {dialogOpen && authority === "wallet" ? (
        <WalletSignInDialog {...dialog} onClose={closeSignIn} />
      ) : null}
    </WalletChromeContext.Provider>
  );
}

export function useWalletChrome(): WalletChromeContextValue | null {
  return useContext(WalletChromeContext);
}
