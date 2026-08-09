# Slice 023C2B2 — Product wallet entry wiring

## User outcome

A user can enter from Runs, a locked deep run or a finalized Composer draft,
sign in through one Coston2 wallet dialog, and continue the same action without
copying a project token. A shared run stays read-only and never asks for a
wallet.

## Frozen product contracts

- `App` owns one accepted wallet-session provider and one shared sign-in dialog.
- Production constructs the accepted wallet access client; deterministic tests
  may inject its ports through `AppProps.walletAccess`.
- Explicit `AppProps.projectToken` remains an effect-free test/embed override.
- Manual `ProjectTokenDialog` has no production import or render path.
- Runs and deep routes restore the accepted controller without importing,
  discovering or reading a wallet provider.
- Anonymous `/runs` lists only after authentication and only once.
- A locked `/runs/:id` keeps its pathname/query and hydrates only after
  authentication.
- A valid run-scoped share fragment is scrubbed synchronously, hydrates with
  share authority, suppresses project restore and never opens wallet sign-in.
- Composer finalizes before sign-in, freezes the exact manifest and existing
  idempotency key, and resumes one create after authentication.
- Double click, dialog close/reopen and callback rerender do not duplicate
  `MANIFEST_VALIDATED`, `COMPOSER_STARTED` or create-run commands.
- Dialog cancellation leaves the persisted draft and pending action safe.
- App/Runs/Composer copy uses `Sign in with wallet` and
  `Reconnect wallet session`, with no project-token terminology.
- Provider RPC strings are absent from the <=180 kB gzip initial entry and
  present in exactly one lazy provider chunk.

## Frozen tests

- `src/slice023c2b2-app-wallet-authority.contract.test.tsx`;
- `src/slice023c2b2-wallet-product-journey.contract.test.tsx`;
- `tests/slice023c2b2-wallet-bundle.contract.mjs` after `npm run build`.

## Targeted GREEN gates

Run typecheck, the new contracts, accepted B1, direct App/Runs/Composer/share
baselines, affected Web coverage at least 85% lines and 80% branches, full Web,
production build and the standalone bundle contract. Do not run unrelated
backend/PostgreSQL/Solidity/live gates during this module.

## Browser acceptance after GREEN

Run the local production preview and inspect both `1488×1058` and `390×844`:

1. `/runs` anonymous → sign-in → cancel/Escape → focus returns →
   authenticate → one list request.
2. Direct `/runs/:id?panel=diagnostics` → authenticate → same URL and one
   hydration; reload restores without wallet prompt.
3. Back/forward preserves the Runs filter, Composer step and run panel while
   the session remains authoritative.
4. Valid `#share=` is removed before network I/O, stays read-only and makes no
   account, wallet or project-authorized request.
5. Composer Submit double click, cancel/reopen and authenticate produce one
   validation event and one create request with the saved idempotency key.
6. Keyboard order, focus trap/return and Escape work; axe has no
   serious/critical violations.
7. Dialog and entry states preserve graphite/cyan hierarchy at both sizes; the
   mobile primary action remains reachable without horizontal overflow.
8. Console has no new warnings/errors, network has no duplicate request and no
   provider/RPC request occurs before the explicit dialog action.

Browser screenshots, console/network log and build asset evidence belong to the
GREEN candidate. This RED does not claim them.

Architecture decision: [ADR 0027](../adr/0027-app-wallet-authority-and-pending-composer-intent.md).
