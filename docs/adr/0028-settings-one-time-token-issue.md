# ADR 0028 — Settings one-time token issue boundary

Status: accepted for Slice 023C3A RED

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

## Consequences

The browser can bootstrap CLI and Action usage without teaching users manual
project-token provisioning. Losing the first response remains intentionally
irrecoverable: the secret is not replayed or reconstructed. The user retains
the visible summary and 023C3B will provide revocation/replacement. Settings
adds no authority beyond the already authenticated browser session.
