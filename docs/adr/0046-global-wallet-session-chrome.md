# ADR 0046 — Global wallet session chrome

## Status

Accepted; Slice 030A Settings-composition corrective RED after Product FAIL.

## Context

ADR 0024 and ADR 0026 define a session-only SIWE authority and one lazy wallet
session controller. The current Web shell mounts that controller only below
private routes. A successful sign-in is therefore visible in Settings but not
in the persistent top bar or on public product routes. The sign-in dialog is
also closed by its caller as soon as session creation resolves, so the product
does not leave a clear visible confirmation.

The landing wallet-security call to action shares a three-column grid with a
different trust-gap component even though it has only two children. On wide
viewports the action is placed in the flexible content column and can collapse
to a few characters per line.

## Decision

One `WalletSessionProvider` and one wallet-chrome owner wrap every ordinary Web
route. The chrome owner is the only component allowed to open the lazy SIWE
dialog. It renders a persistent top-bar state and never serializes the private
project bearer into props, DOM, analytics, history or logs.

An anonymous ordinary route shows `Sign in with wallet`. Restoring and
unavailable states show bounded status/retry controls. An authenticated route
shows a locally derived deterministic identicon and shortened verified EOA
address. Its accessible menu exposes the full address, copy, Account settings
and confirmed browser-session sign-out. Mobile retains the identicon and menu
while hiding only the shortened address.

The label is `Verified wallet`, not `Connected wallet`: SIWE proves the
persisted browser identity but does not claim a live provider connection.
Successful session creation leaves the dialog's explicit `Signed in` result
visible until the user chooses Continue; the top-bar profile updates
immediately behind it.

Run-scoped share authority and caller-supplied project-token authority remain
strictly separate. Those routes mount the wallet controller with unavailable
storage, never restore or expose a browser wallet, and render only `Shared
access` or `Token access` in the top bar. They cannot open the SIWE dialog.

The landing trust-gap and wallet-security sections receive distinct grid
contracts. Wallet security is exactly `content / max-content action` on wide
screens and one column at 720px and below; the action label cannot wrap.

## Consequences

The browser token remains tab-scoped in `sessionStorage` and expires after the
existing twelve-hour server-authored window. No API, database, SIWE, wallet
provider, share-token or project-token contract changes. Identicons require no
dependency or network request. Browser acceptance must cover desktop/mobile,
reload, history, keyboard/focus, sign-out recovery, axe and overflow.
