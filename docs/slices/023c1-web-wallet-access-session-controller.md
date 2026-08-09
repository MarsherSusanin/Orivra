# Slice 023C1 — Web wallet access client and session controller

## User outcome

A returning developer can safely resume a browser wallet session after reload,
retry when Proofline is temporarily unavailable, sign out without losing local
access on an ambiguous network failure, or explicitly forget this browser. The
browser never persists the project token outside the current session.

This wave provides deterministic Web services only. It does not render wallet
or Settings UI, load an EIP-1193 provider, ask for a signature, add product
analytics, or change the existing Run Cockpit.

## Wallet access client contract

`WalletAccessServices` exposes exactly:

- `listNetworks`;
- `createWalletChallenge`;
- `createWalletSession`;
- `getAccount`;
- `createAccountToken`;
- `revokeAccountToken`;
- `revokeCurrentSession`.

The client normalizes one API base to `/v1`, uses `credentials: "omit"`,
`mode: "cors"`, `cache: "no-store"` and
`referrerPolicy: "no-referrer"`, and sends `Accept: application/json`.
Challenge/session/network calls carry no bearer. Account and current-session
management attach the validated project bearer only as `Authorization`; it is
never placed in a URL or request body. Token issuance alone carries the exact
route-specific `token_issue_<64 lowercase hex>` idempotency key.

Every success is parsed with its existing strict public V1 schema. Current
session revocation alone accepts exact `204` with zero response bytes. Invalid
input fails before fetch; malformed, extra or secret-bearing output fails
closed. `WalletAccessError` exposes only stable `kind`, `status`, `code` and
`retryable` evidence plus a fixed message. It never echoes response bodies,
tokens, transport messages or stacks.

Server error codes use the exact status-compatible allowlist in ADR 0024, not a
regular expression. The untrusted envelope contributes only a safe
`error.code`; message, stack, secret and extra fields are discarded rather than
invalidating that code. Unknown or mismatched codes fall back to
`HTTP_<status>`. The controller may therefore branch only on bounded
client-owned evidence.

## Session controller contract

The pure controller receives only `WalletAccessServices` and a `StorageLike`
port. It owns the exact key `proofline:project-token`, accepts only
`project_<64 lowercase hex>`, and never accepts a share token. Its serializable
state contains status, safe recovery metadata, wallet/project identity and
optional account data, but never the bearer. The current bearer is available
only through the controller's access-token method.

On startup:

1. No or corrupt storage becomes anonymous without network I/O; corrupt bytes
   are removed.
2. A valid token calls only `getAccount`; wallet challenge/session/provider
   effects never run on reload.
3. `200` becomes authenticated and retains the exact account evidence.
4. `401`, or `403 ACCOUNT_SESSION_REQUIRED` proving a non-browser credential,
   clears memory and session storage.
5. A transport failure retains the token and exposes one safe restore retry.

A strictly parsed wallet-session result is written to session storage once.
When the browser denies that write, the same valid result becomes
`ephemeral-authenticated` in memory; the controller does not fall back to
`localStorage`, a URL, history, analytics or logs.

Restore, session creation and sign-out are single-flight. Cancellation, close
or a newer attempt makes a late response stale before it can write storage or
replace newer authority. Sign-out clears on exact `204` or `401`. Transport and
server errors preserve authority, identify whether the safe retry is restore or
sign-out, and expose one retry action. `forgetBrowser` clears memory and the
session key without implying that server revocation succeeded.

`close()` is a terminal transition. Every later existing public action is a
no-op, the snapshot stays `closed`, and neither storage nor service ports are
touched. The controller remains pull-only in 023C1; subscription is deferred
rather than introduced by a corrective test.

## RED and validation

Frozen tests:

- `src/services/slice023c1-wallet-access-client.contract.test.ts`;
- `src/services/slice023c1-wallet-session-controller.contract.test.ts`;
- `src/services/slice023c1-wallet-access-corrective.contract.test.ts`;
- `src/services/slice023c1-wallet-session-controller-corrective.contract.test.ts`.

The intentional RED is absence of `wallet-access-client` and
`wallet-session-controller`. Once implemented, focused GREEN must cover all
success/error/corruption/single-flight paths and the affected Web coverage
threshold. 023C2 owns wallet-provider and UI browser acceptance. No browser,
Sites, broad Web coverage or full repository matrix is evidence for this RED
wave. The corrective tests also require affected-only coverage of these two
modules at at least 85% lines and above 80% branches; aggregate Web coverage
cannot mask an under-tested new controller.

Architecture decision: [ADR 0024](../adr/0024-wallet-identity-and-self-service-access.md).
