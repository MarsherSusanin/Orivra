# ADR 0027 — App wallet authority and pending Composer intent

Status: accepted for Slice 023C2B2 RED

## Context

The accepted B1 context and dialog are intentionally isolated. Production
routes still own a second manual project-token state, import
`ProjectTokenDialog`, and check authentication before Composer finalization.
That leaves wallet self-service outside the actual product journey and makes a
post-auth create vulnerable to revalidation or duplicate user actions.

Deep shared runs add a separate capability: a valid run-scoped share token must
remain read-only even when the same browser also has a project session.

## Decision

`App` becomes the single wallet authority composition root. It creates the
production `WalletAccessServices` with `createWalletAccessClient`, mounts one
accepted `WalletSessionProvider`, and renders one shared
`WalletSignInDialog`. Tests and explicit embeds may pass
`AppProps.walletAccess` with services, storage and accepted dialog ports;
production uses the API base URL and browser session storage. The existing
`AppProps.projectToken` remains an explicit test/embed override and never
causes wallet restore or provider work.

Authority precedence is:

1. a valid run-scoped share fragment or restored share capability;
2. an explicit `AppProps.projectToken` override;
3. the accepted wallet-session controller access token;
4. anonymous.

When share authority exists, project-session restore is suppressed for that
render tree. The share is scrubbed synchronously, remains run-scoped and
read-only, and cannot open wallet sign-in or call the account endpoint. The
browser project token is neither consumed nor deleted by share viewing.

Runs, deep run routes and Composer request authentication through one root
dialog. Production copy says `Sign in with wallet` or
`Reconnect wallet session`; no production App/Runs/Composer surface imports or
describes manual project tokens. Render, reload and session restore do not load
the provider adapter or issue EIP-1193 RPC. The accepted literal dynamic import
inside `WalletSignInDialog` remains the only production provider edge.

Composer finalizes and validates the current draft before requesting wallet
authentication. A successful validation freezes one in-memory pending intent:
the exact manifest bytes/structure and the draft's existing create idempotency
key. Closing the dialog preserves the draft and pending intent. Reopening does
not emit another validation or Composer-start event. Authentication resumes
that exact intent once; double click, rerender, reload of unrelated surfaces or
the dialog callback cannot create a second command. A page reload keeps the
saved draft/idempotency key but requires a new explicit submit action; no
in-memory action is executed implicitly after reload.

The initial production entry must remain at most 180 kB gzip and contain no
sign-in-only RPC markers: `wallet_addEthereumChain`, `eth_getCode` or
`personal_sign`. Existing run submission may legitimately retain
`eth_requestAccounts` and `wallet_switchEthereumChain` in the entry. The full
sign-in method set occurs in exactly one lazy `wallet-provider-adapter` chunk.
B2 freezes this post-build artifact contract; actual
desktop/mobile browser evidence is recorded after GREEN.

## Consequences

Manual token entry is no longer a production fallback. CLI/Action token issue
and revoke remain the later Settings slice. This decision adds no token
persistence beyond the accepted controller, no auth analytics, no public
relayer, no quotas and no new wallet SDK.
