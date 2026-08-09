# Slice 023C3B — Settings access removal

## User outcome

An authenticated developer can revoke an active CLI/Action credential or sign
out the current browser with explicit, recoverable confirmation and no wallet
prompt. The UI never implies a remote effect until persisted account or
controller evidence proves it.

## Frozen scope

- This is a Web-only composition of the accepted strict B2 client methods.
  Contracts, API routes, SQL, dependencies, wallet adapter, Sites and
  infrastructure do not change.
- `WalletSessionContextValue` adds only
  `revokeAccountToken(tokenId): Promise<void>`. It reads its
  private browser bearer and never accepts authority from a component prop.
- Anonymous, stale, explicit AppProps, CLI, Action, legacy and share authority
  cannot invoke account removal and trigger no account, network or provider
  work.
- One opaque authority generation has one account-mutation lane. The same
  issue intent or same revoke target coalesces; a different issue/revoke or
  issue↔revoke intent fails locally with safe `409 IDEMPOTENCY_CONFLICT` and
  sends no second request.
- Revocation owns `DELETE → strict target check → coalesced account refresh →
  revoked-evidence check → generation recheck`. It resolves only when the
  response target matches and the refreshed target exists with non-null
  `revokedAt`. Mismatch, absence or still-active evidence fails fixed
  `502 AUTH_RESPONSE_INVALID`. Refresh failure never fabricates status and
  remains retryable.
- Late A completion before or during refresh rejects fixed
  `403 ACCOUNT_SESSION_REQUIRED`; it cannot update B or clear B work even when
  the bearer bytes are identical.
- Every summary with null `revokedAt`, including expired credentials, exposes
  `Revoke {label}`. Revoked summaries remain non-actionable direct statuses.
  Confirmation names the target, starts
  on Cancel, traps focus, ignores backdrop, restores the trigger on
  Escape/Cancel and blocks duplicate/Escape once pending.
- Failed revoke keeps fixed redacted copy and `Retry revoke`; success closes
  only after refreshed evidence removes the action and shows `revoked`.
- Current-generation revoke `401` or `403 ACCOUNT_SESSION_REQUIRED` clears only
  that invalid authority; late A maps to stale 403 and cannot clear B.
- Current-browser sign-out is separately confirmed. Exact `204`, `401` and
  `403 ACCOUNT_SESSION_REQUIRED` clear local authority. Transport,
  origin-forbidden or unknown `403`, and `5xx` retain it with fixed recovery
  UI, `Retry sign-out` and explicit `Forget this browser`.
- Starting sign-out advances authority immediately. Any pending issue, revoke
  or refresh becomes stale; a one-time raw reveal clears and cannot resurface
  if remote sign-out fails.
- No raw token or upstream error echo enters storage, URL/history, analytics,
  logs, DOM attributes or serialized UI errors.
- Revoke, confirmation and sign-out recovery actions stack and remain bounded
  at 390 px. Keyboard and axe semantics remain clean.

Run retention/deletion remain Slice 027. Quotas remain 023D. No account-wide
logout, token replacement shortcut, wallet disconnect, analytics event or
provider import is introduced.

## Risk and ADR impact

Authentication and secret-handling risk is high because remote mutation,
retained browser authority and one-time secret races meet in one surface.
Persistence and migration risk is none. [ADR 0028](../adr/0028-settings-one-time-token-issue.md)
is extended before GREEN; package and trust boundaries stay unchanged.

## Frozen RED tests

- `src/slice023c3b-wallet-session-context-revoke.contract.test.tsx`;
- `src/slice023c3b-account-settings-access-removal.contract.test.tsx`.

The context contract freezes anonymous fail-closed behavior, strict response
and refreshed evidence, the shared issue/revoke mutation lane, atomic account
refresh, current invalid-authority clearing and both same-bearer A→B settlement
points. The Settings contract freezes non-revoked-only actions,
focus/Escape/backdrop/pending behavior, retry and status evidence, 204/401/403
clear, transport/403/5xx retention, explicit local forget, provider silence,
one-time reveal collision, leakage, axe and mobile action layout.

## Targeted GREEN gates

Run typecheck, the two frozen contracts, accepted C3A Settings/context plus C1
controller and C2B2 browser-authority baselines, and affected React coverage at
least 85% lines and 80% branches. Full Web follows focused GREEN. This module
does not own PostgreSQL, Solidity, Sites, Docker or live Coston2 gates.

## Browser acceptance after GREEN

Use the Browser runtime against the local built preview at `1488×1058` and
`390×844`:

1. non-revoked revoke controls and direct active/expired/revoked statuses
   preserve server order;
2. revoke Cancel/Escape/focus return, pending duplicate block, fixed failure
   retry and persisted success evidence match the frozen contract;
3. sign-out Cancel/Escape and `204`/`401`/invalid-authority `403` clear behave
   without provider work;
4. offline/server recovery retains authority, Retry succeeds, and explicit
   Forget clears locally without claiming remote success;
5. a pending one-time reveal cannot appear after sign-out begins;
6. both viewports remain bounded, keyboard traversal completes, axe reports no
   serious/critical violation and console/network evidence contains no bearer,
   raw secret, duplicate mutation or provider request.

Browser screenshots, DOM/focus, console and request evidence belong to GREEN.
This RED does not claim coverage, browser, build, Sites, hosted or live PASS.
