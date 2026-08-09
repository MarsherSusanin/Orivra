# ADR 0026 — App-wide wallet session context and lazy sign-in dialog

Status: accepted for Slice 023C2B1 RED

## Context

The accepted 023C1 services own browser session authority and the accepted
023C2A adapter owns injected-wallet effects. A rendered sign-in surface must
compose them without recreating controllers per route, prompting a wallet on
reload, putting provider code in the initial render graph, or allowing a closed
dialog's late promise to create a session.

The complete replacement of manual project-token entry also affects routing,
Runs and Composer resume semantics. Freezing all of that with the dialog would
create one oversized test wave, so rendered sign-in is split into two slices.

## Decision

### 023C2B1 — isolated session and dialog composition

`WalletSessionProvider` owns exactly one accepted
`WalletSessionController` for its mounted app tree and exposes it through
`useWalletSession`. It restores once after mount, refreshes React state only
after controller transitions, closes the controller on real unmount, and never
puts the project bearer in a rendered snapshot. Render and reload can touch
session storage and the accepted account endpoint only; they never import or
invoke a wallet provider.

`WalletSignInDialog` consumes that context. The 023C2A module is loaded with a
literal dynamic import only after the explicit `Sign in with wallet` action.
The action starts network-capability loading and provider-module/discovery work
independently, so neither creates an avoidable waterfall. No wallet SDK or
static provider import is introduced.

The exact journey is:

1. discover valid providers and load the existing network capabilities;
2. choose one provider with keyboard or pointer;
3. connect that provider with the enabled Coston2 capability, including the
   accepted EOA check;
4. create the strict server challenge for the canonical address;
5. verify returned address, network `coston2`, chain `114` and purpose
   `browser-session` before signing;
6. sign the exact returned message;
7. pass only challenge ID and signature to the accepted session controller;
8. surface authenticated session evidence without exposing the bearer.

The dialog state machine contains `idle`, `discovering`, `choosing-provider`,
`connecting`, `creating-challenge`, `awaiting-signature`, `creating-session`,
`authenticated`, `rejected`, `provider-unavailable`, `unsupported`,
`contract-wallet-unsupported`, `challenge-expired`, `signature-invalid`,
`offline` and `error`. Every failure has one safe primary action and fixed copy;
provider/API raw errors are not rendered. Authentication emits no product
analytics event.

Close and Escape increment a dialog attempt before calling both adapter and
session cancellation. Late discovery, connection, challenge, signature or
session results cannot continue the journey, persist a token or invoke the
authenticated callback. Focus is trapped, Escape returns focus to the opener,
and the dialog uses the existing graphite anatomy with labelled and live
regions. Provider choices are named controls, never icon-only controls.

### 023C2B2 — product entry wiring

A later independent RED will replace `ProjectTokenDialog` on `/runs`,
`/runs/new` and `/runs/:id`, preserve explicit `AppProps.projectToken` test/embed
injection and share-fragment read-only access, resume one validated Composer
create intent after authentication, and freeze deep-route/back-forward/reload
browser behavior. The production chunk graph and initial gzip budget are also
measured only after B2 imports the context/dialog from App.

## Consequences

B1 can verify rendered orchestration and accessibility without changing the
accepted product routes. It creates no Settings/token-management UI, quotas,
analytics, source-URL fetch, public relayer or Flare path. A B1 PASS does not
claim that the production App uses wallet sign-in or that a separate wallet
chunk is present in the build; those are B2 acceptance gates.
