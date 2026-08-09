# Slice 023C2B1 — Wallet session provider and sign-in dialog

## User outcome

An isolated Proofline surface can restore one session without prompting a
wallet and can run an accessible, cancellable Coston2 wallet sign-in dialog
after one explicit action. The user sees one clear state and one safe next
action rather than provider/API mechanics.

This slice does not replace current App route entry yet. Runs, deep routes,
Composer resume, `AppProps.projectToken`, share fragments and the production
bundle graph remain unchanged until 023C2B2.

## Internal React contracts

`src/wallet-session-context.tsx` exports:

- `WalletSessionProvider` receiving accepted `WalletAccessServices`, a
  session-storage port and children;
- `useWalletSession`, which exposes the safe controller snapshot, a callable
  access-token accessor for downstream API composition, pre-auth network and
  challenge methods, and accepted restore/create/sign-out/retry/forget/cancel
  actions.

One provider mount creates one controller. Re-render does not create another
controller or repeat restore. A stored session calls only `getAccount`; neither
the context module nor reload imports `wallet-provider-adapter` or requests
wallet RPC. Context snapshots and rendered output never contain the bearer.

`src/components/WalletSignInDialog.tsx`:

- renders the existing `dialog-backdrop`, `verification-dialog`,
  `dialog-header`, `dialog-body`, `close-button` and `dialog-primary` anatomy;
- dynamically imports `../services/wallet-provider-adapter` only inside the
  explicit start action;
- starts `listNetworks` and module/discovery work without awaiting one before
  starting the other;
- presents multiple named providers in stable order with keyboard focus;
- composes connect → strict challenge → exact sign → controller session;
- validates challenge address/network/chain/purpose before signing;
- maps accepted bounded adapter/API codes to the documented state machine;
- cancels every layer on close/Escape and ignores all late results;
- traps focus, restores it to the opener, has an accessible name and polite
  live status, and contains no icon-only provider action;
- emits no authentication analytics and never calls a Web2Json source URL.

At `390×844`, `.wallet-sign-in-dialog` has bounded viewport height, internal
body scrolling and no fixed-width provider row or off-screen primary action.

## RED and focused gates

Frozen tests:

- `src/slice023c2b1-wallet-session-provider.contract.test.tsx`;
- `src/slice023c2b1-wallet-sign-in-dialog.contract.test.tsx`;
- `src/slice023c2b1-wallet-sign-in-mobile.contract.test.ts`;
- `src/slice023c2b1-wallet-sign-in-lazy.contract.test.ts`.

The intentional RED is absence of the context and dialog modules plus their
mobile/lazy source contract. Focused GREEN runs typecheck, these tests, direct
023C1/023C2A consumers and affected Web coverage at least 85% lines and above
80% branches. Actual desktop/mobile browser evidence, App route acceptance,
build chunk inspection, gzip budget and Sites remain B2 gates because B1 is not
yet imported by the production App.

Architecture decision: [ADR 0026](../adr/0026-wallet-session-context-and-lazy-sign-in-dialog.md).
