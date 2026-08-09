# ADR 0028 — Settings one-time token issue boundary

Status: accepted for Slice 023C3A; 023C3B extension frozen in RED

## Context

The API already restricts account inspection and CLI/Action token management
to an authenticated browser credential. The accepted Web root now owns that
browser session, but `Settings` is still disabled and no UI owns the raw secret
returned once by token issuance. Treating an explicit embed, CLI, Action,
legacy or share capability as equivalent to the controller's authenticated
browser identity would bypass the server's management-purpose boundary.

## Decision

`/settings` is a real App route and `Sidebar` destination. Account management
is enabled only when the accepted wallet-session controller snapshot is
`authenticated` and contains the strictly parsed `AccountV1`. Anonymous users
receive one `Sign in with wallet` entry using the shared root dialog. Explicit
`AppProps.projectToken` and share authority remain useful on their existing
surfaces but never unlock Settings management or trigger account, network or
wallet-provider effects.

023C3A adds only account inspection and CLI/Action issuance. Revocation and
current-browser sign-out are a separate 023C3B slice. Retention and deletion
remain Slice 027. No new schema, API route, persistence model, wallet SDK,
analytics event or provider import is introduced.

The session context exposes two browser-authorized transitions without
exposing its bearer: `createAccountToken(idempotencyKey, request)` and
`refreshAccount()`. Each reads the controller's current private access token,
fails closed outside an authenticated browser session and refreshes the strict
account snapshot after a successful issue. It never accepts authority as a
component prop. Refresh performs no challenge, network or provider operation.

The issue form accepts only `cli | action`, trims a label before applying the
existing 1–128 character contract and accepts an integer expiry from 1 through
90 days, defaulting to 30. One dominant `Generate` action creates a fresh
cryptographically random `token_issue_<64 lowercase hex>` key before the
request. That key is stable for that single in-flight attempt; double click and
rerender cannot send another request. A later deliberate attempt receives a
new key.

The `201` raw token lives only in component memory and opens one modal titled
`Save this token now`. The token is rendered as read-only text, never as a DOM
attribute. Initial focus is `Copy`; the dialog cannot be dismissed by its
backdrop. Before the first successful copy, Escape or Close changes the same
modal to an explicit `Close without copying?` confirmation. After copy, Escape
or Close clears the raw token, closes the modal and restores focus to
`Generate`. Failure retains the form and displays only fixed client-owned copy.
Clipboard rejection keeps the reveal open and uncopied, so Escape/Close still
requires the loss confirmation. When the Clipboard API is absent, the raw text
remains manually selectable and Copy is honestly unavailable. A create result
that resolves after Settings unmount or browser-authority loss is stale: it
cannot open a reveal, refresh account state or write any storage/analytics
path. Anonymous and stale context create/refresh calls fail closed before the
service port. A new explicit retry is a new attempt with a new idempotency key;
the form and safe error copy survive both synchronous and asynchronous failure.

The raw token is never written to local/session storage, URL, history,
analytics, logs, DOM attributes or serialized errors. Account summaries keep
the order supplied by `AccountV1`; status is `revoked` when `revokedAt` exists,
otherwise `expired` after `expiresAt`, otherwise `active`.

### Authority generation and in-flight account operations

Bearer equality is not session identity. The provider maintains an internal
opaque authority generation which changes whenever browser authority is
accepted, forgotten, signed out, superseded or closed. It is not part of
`WalletSessionContextValue`, `WalletSessionSnapshot`, DOM, analytics or any
public schema. Account operations capture both bearer and generation before
calling a service.

A token issue is single-flight within one generation. The frozen intent is the
exact idempotency key plus the strict request tuple. A concurrent identical
intent receives the same Promise and performs one service call; a different
  intent fails locally with fixed safe `409 IDEMPOTENCY_CONFLICT` evidence and
  does not call the service.

Issue and summary refresh form one context-owned authority transaction. After
the issue service returns, `createAccountToken` performs or coalesces the
current generation's account refresh and rechecks generation after that refresh
settles. Only then may it resolve the raw token to the surface. `AccountSettings`
does not perform a second refresh or use a post-return authenticated boolean.
If authority changes at any point before this boundary—including after the raw
service response while refresh is pending—the raw result is discarded and the
caller receives fixed safe `403 ACCOUNT_SESSION_REQUIRED`; the secret is absent
from the returned value, serialized failure, UI, stale refresh, storage, logs
and analytics. Reissuing the same bearer bytes in a later session does not make
the old result current.

If the generation is still current but its summary refresh fails, the one-time
secret must not be irretrievably lost. The method resolves the raw result once,
keeps the previously parsed account evidence and exposes no upstream error
bytes. 023C3A introduces no new public warning field or callback; the reveal
remains the recovery surface. Any later refresh uses the existing operation.

Account refresh is also single-flight per generation. Concurrent refreshes in
one generation coalesce. A new generation may start its own refresh while an
old one is unresolved. An old completion cannot update the new account or
clear its flight; only current-generation evidence may replace the snapshot.
An already visible reveal is generation-owned UI state: losing authority clears
it immediately, and a later session cannot make those raw bytes visible again.

### 023C3B revocation and current-browser sign-out

023C3B remains inside the accepted Web boundary. It composes the strict B2
`DELETE /account/tokens/:tokenId` and
`DELETE /auth/wallet/sessions/current` services already present in the wallet
access client. It adds no route, schema, SQL, bearer prop, wallet-provider
operation or new persistence mechanism.

The session context exposes
`revokeAccountToken(tokenId): Promise<void>`. The transition
captures the current opaque authority generation and private browser bearer,
validates the strict token id through the existing service, and fails closed
with fixed `403 ACCOUNT_SESSION_REQUIRED` outside an authenticated browser
session. One generation owns one shared account-mutation lane. The same issue
intent or same revoke target receives the same Promise; a different issue,
revoke target or issue↔revoke intent fails locally with fixed
`409 IDEMPOTENCY_CONFLICT` and does not call the second service.

A successful service result is not sufficient UI evidence. Revocation is one
context transaction: `DELETE → strict response/target check → coalesced strict
account refresh → revoked-evidence check → generation recheck`. It resolves
only when the response target equals the captured target and refreshed
`AccountV1` still contains that target with non-null `revokedAt`. Mismatched,
missing or still-active evidence fails fixed `502 AUTH_RESPONSE_INVALID`; a
refresh failure rejects the
surface attempt without inventing local revoked evidence; retry may repeat the
idempotent DELETE and refresh. If authority changes before or during the
refresh, the old operation rejects with fixed `403 ACCOUNT_SESSION_REQUIRED`.
It cannot update the next account, clear its flight or become current even if
the later session receives byte-identical bearer bytes.

Every non-revoked token has a Revoke action, including expired credentials so
the audit summary can record an explicit revocation marker. Already revoked
summaries remain direct evidence without a mutation control. Revoke uses an
explicit modal named for the credential. Initial focus is Cancel; Escape and
Cancel restore the originating action before mutation. The backdrop does not
dismiss it. Once pending, duplicate confirmation and Escape are blocked. A
failure keeps the confirmation open with fixed safe copy and an explicit
idempotent Retry. Success closes only after refreshed revoked evidence is
visible. No upstream error bytes are rendered, stored, logged or added to a
URL or DOM attribute.

For a current-generation token revoke, normalized `401 UNAUTHORIZED` or
`403 ACCOUNT_SESSION_REQUIRED` clears that invalid browser authority after the
generation check. A late A invalid-authority response maps to fixed stale
`403 ACCOUNT_SESSION_REQUIRED` and cannot clear B. Origin-forbidden or unknown
403 responses do not prove an invalid bearer.

Current-browser sign-out uses the accepted controller and never calls the
wallet provider. It has a separate explicit confirmation with safe initial
focus and focus return. Exact `204`, normalized `401` and
`403 ACCOUNT_SESSION_REQUIRED` clear local browser authority. Transport,
origin-forbidden or unknown `403`, and `5xx` results retain the bearer and expose
fixed recovery copy, `Retry sign-out` and `Forget this browser`. Retry repeats
the same controller transition; Forget clears locally without claiming remote
revocation. Starting sign-out advances authority immediately, so an in-flight
issue, refresh or revoke is stale. A one-time reveal clears at transition start
and cannot reappear if remote sign-out later fails and leaves recovery access.

The destructive and recovery action groups stack at the accepted 390 px
mobile width. Both confirmations trap focus and preserve the existing safe
dialog density. Explicit AppProps, CLI, Action, legacy and share capabilities
remain unable to render or invoke these controls.

## Consequences

The browser can bootstrap CLI and Action usage without teaching users manual
project-token provisioning. Losing the first response remains intentionally
irrecoverable: the secret is not replayed or reconstructed. The user retains
the visible summary; 023C3B provides revocation and current-browser sign-out
without adding authority beyond the already authenticated browser session.
Run retention and deletion remain Slice 027.
