# ADR 0024 — Wallet identity and self-service project access

## Status

Accepted for Slice 023.

The separate Sites/API hosting portion is partially superseded by
[ADR 0029](0029-digitalocean-vds-deployment.md). Exact-origin authentication,
CORS and all remaining access-boundary decisions remain accepted.

## Context

Proofline's persisted product journey requires a project bearer token, but the
product can only accept a token provisioned elsewhere. This blocks a new Web3
developer before the first replay run. Making a wallet signature equivalent to
an arbitrary client-authored message would introduce replay, phishing and
cross-origin session risks.

## Decision

Proofline uses EIP-4361 for EOA browser sign-in. The server constructs the whole
message from its configured HTTPS root `PROOFLINE_WEB_ORIGIN`, Coston2 chain ID
`114`, a 256-bit lowercase hexadecimal nonce, server timestamps and the fixed
`browser-session` purpose. HTTP clients submit only an address to create a
challenge and only `challengeId + signature` to create a session; message,
domain, URI, chain, nonce and timestamps are never caller-selectable.

Challenges expire after five minutes and are consumed atomically once. EOA
recovery is local and does not use RPC. EIP-1271 is returned as explicitly
unsupported for the MLP rather than guessed from a failed EOA recovery.

The two public POST routes require an exact `Origin` equal to the configured Web
origin, are exempt from generic bearer and idempotency middleware, accept at
most 8 KiB at the Fetch `Request` boundary, and return `Cache-Control: no-store` plus
`Referrer-Policy: no-referrer`. The existing public `GET /v1/networks` remains
the only other unauthenticated V1 route; all remaining routes keep their bearer
boundary.

Because Sites and the API are separate origins, API composition provides one
exact-origin CORS policy for the current `/v1/*` browser surface. A valid
preflight is handled before bearer and idempotency checks, permits only
`GET`, `POST` and `DELETE` plus `accept`, `content-type`, `authorization` and
`idempotency-key`, and exposes `Location`. Responses never use a wildcard or
credentialed CORS. Missing/wrong origins and unapproved preflight methods or
headers fail closed without granting CORS authority. Server-to-server requests
without `Origin` keep their existing behavior; actual wallet-auth requests
still require the exact configured origin.

One Coston2 wallet identity owns one automatically created default project.
Identity provisioning runs under a transaction-scoped advisory lock derived
from `(114, normalized address)`. A successful browser session returns a random
256-bit `project_` token once, valid for 12 hours. Only its keyed digest is
persisted; Web may retain the raw token only in `sessionStorage`. Account
settings may issue independently revocable `cli` or `action` tokens for 1–90
days. Existing bearer and run-scoped share semantics remain unchanged.

Account inspection, CLI/Action issuance, token revocation and current-session
sign-out require an authenticated `browser` token backed by its private token
and wallet-identity IDs. The credential kind and IDs come only from the token
digest lookup; request bodies cannot select them. CLI, Action and legacy project
tokens remain valid for ordinary project API calls but receive private `403
ACCOUNT_SESSION_REQUIRED` on account-management routes. Share tokens remain
read-only and cannot access account state.

Issuance uses a route-specific `Idempotency-Key` of
`token_issue_` plus 64 lowercase hexadecimal characters. The literal product
requirement that a raw secret is displayed only once takes precedence over
generic response replay: the first committed effect returns the secret, a
same-key/same-fingerprint retry returns private `409
ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED`, and a changed fingerprint returns private
`409 IDEMPOTENCY_CONFLICT`. Proofline neither derives a deterministic token nor
persists a replayable raw response. If the first response is lost, the operator
revokes the visible summary and issues a replacement with a fresh key.

`DELETE /v1/auth/wallet/sessions/current` revokes only the authenticated browser
token using the private auth-context IDs and a millisecond PostgreSQL clock. It
accepts no body or idempotency key and returns `204` with no bytes. A repeated
request is unauthenticated (`401`), which clients treat as already signed out.

Challenge consumption is a separate short transaction which atomically marks
one unexpired, unconsumed challenge and commits before local EOA recovery. An
invalid signature therefore spends the challenge. Missing, expired and already
consumed challenges share the private `CHALLENGE_UNAVAILABLE` outcome and do
not reveal which condition occurred.

The persisted message is evidence, not an independent authentication
authority. After committed consumption, the service reconstructs the canonical
message from configured Web origin plus persisted address, 32-byte nonce,
`issued_at` and `expires_at`, then compares the UTF-8 bytes with the stored
message before recovery. Any mismatch is handled as `CHALLENGE_UNAVAILABLE`;
recovery and project/token provisioning are not invoked.

Challenge timestamps are canonical millisecond UTC evidence. PostgreSQL rejects
rows whose `issued_at` or `expires_at` has sub-millisecond precision, and the
atomic consume predicate repeats both precision checks as defense in depth.
This prevents the PostgreSQL driver's millisecond `Date` hydration from hiding
microsecond corruption before reconstruction.

PostgreSQL is the sole clock authority for persisted wallet authentication.
Challenge creation reads a millisecond-truncated database timestamp before
building or storing EIP-4361 evidence. Session provisioning reads its issue time
inside the provisioning transaction and uses that same value for the persisted
token and public response; expiry is exactly twelve hours later. Consumption
uses a millisecond database time that is never earlier than the persisted
`issued_at`, while retaining expiry and precision guards. Application `Date`
clock skew therefore cannot create future challenge evidence or violate the
consumption constraint.

Migration 006 adds `wallet_identities` and `wallet_challenges` plus additive
`api_tokens` kind, label, expiry and wallet-identity metadata. Existing project
tokens are backfilled as `legacy` with null expiry. Browser rows require a
wallet identity and expiry; authentication accepts null-expiry legacy rows but
rejects expired or revoked rows. The API role alone receives the minimum new
table privileges; the worker receives none.

Migration 007 adds keyed issuance-key digests and intent fingerprints to
`api_tokens`, CLI/Action-only constraints, a project-scoped partial unique
issuance index and a stable account-list index. Raw tokens are never stored.
Account lists never select token digests and order CLI/Action summaries by
`created_at DESC, id DESC`. Revocation preserves the first `revoked_at` value.

The Web access boundary is split from wallet-provider integration. A dedicated
`WalletAccessServices` client is the only browser transport for network,
challenge, session and account calls. It parses every success through the
existing strict V1 schemas, requires an exact empty `204` for current-session
revocation, and maps transport, HTTP, input and output-contract failures to
fixed sanitized typed errors. Browser requests use CORS with omitted
credentials, disabled caching and referrer suppression. Authorization is
attached only to protected account/session-management calls; the bearer never
appears in a URL or JSON body.

HTTP response codes are not accepted through a pattern. The client recognizes
only this status-compatible server allowlist:

- `400`: `INVALID_JSON`, `INVALID_REQUEST_BODY`,
  `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`;
- `401`: `UNAUTHORIZED`, `WALLET_SIGNATURE_INVALID`;
- `403`: `AUTH_ORIGIN_FORBIDDEN`, `ACCOUNT_SESSION_REQUIRED`;
- `404`: `ACCOUNT_NOT_FOUND`, `ACCOUNT_TOKEN_NOT_FOUND`;
- `409`: `CHALLENGE_UNAVAILABLE`,
  `ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED`, `IDEMPOTENCY_CONFLICT`;
- `413`: `REQUEST_BODY_TOO_LARGE`;
- `500`: `REQUEST_FAILED`.

The error envelope is untrusted. The client reads only `error.code`, preserves
it only when it is in the status-compatible allowlist, and ignores every other
root or nested field. Message, stack, secret and extra fields never become
client error properties or serialized output; their presence does not
invalidate an otherwise safe code. Unknown, overlong, lowercase,
secret-shaped or status-incompatible codes become exactly `HTTP_<status>`.
Future quota codes are not pre-authorized here; 023D must extend this allowlist
through its own RED and ADR decision.

A pure Web session controller owns the browser token lifecycle independently of
React and EIP-1193. It accepts only `project_<64 lowercase hex>` in the exact
`proofline:project-token` `sessionStorage` key, keeps the token out of public
state snapshots, and exposes it only through a private access-token accessor.
Startup validates a stored token through `GET /v1/account`; `401` and a
non-browser `403 ACCOUNT_SESSION_REQUIRED` forget it, while an unavailable
network retains it and exposes a safe retry. Reload never invokes a wallet.

After a valid session response, denied session storage produces an explicitly
ephemeral in-memory authenticated state; there is no `localStorage`, URL,
history, analytics or logging fallback. Session creation, restore and sign-out
are single-flight. Cancellation, controller close and superseding attempts
invalidate late responses before they can persist a token. Sign-out clears on
an exact `204` or `401`; transport/server failure retains access for retry, and
an explicit forget-browser action clears local access without claiming server
revocation.

Controller close is terminal. After `close()` every existing public mutating or
async method, including repeated close, cancellation, forget, restore, session
creation, sign-out and retry, is a no-op. The snapshot remains `closed`; no
storage or service effect occurs. 023C1 exposes a pull-only snapshot and has no
subscriber surface, so no observer contract is introduced by this correction.

## Delivery waves

- **023A — contracts and crypto:** public schemas, deterministic EIP-4361
  construction, local EOA recovery port, and public auth-route boundary.
- **023B1 — persisted wallet sessions:** migration 006, atomic single-use
  challenges, strict persisted timestamp integrity, local EOA recovery, locked
  default-project creation, digest-only 12-hour browser sessions,
  browser-token authentication and the cross-origin API composition required
  by the Sites/API topology.
- **023B2 — account token management:** browser-session-only account read,
  CLI/Action issue and revoke endpoints for 1–90 day tokens, plus current
  browser-session sign-out.
- **023C1 — Web access client and session controller:** strict browser
  transport, sanitized failures, session-only token retention, restore,
  cancellation, reconnect/sign-out recovery and forget-browser semantics.
- **023C2A — wallet provider adapter:** lazy EIP-6963/EIP-1193 discovery,
  enabled-Coston2 EOA verification, exact signing and bounded provider errors.
- **023C2B1 — isolated wallet sign-in:** app-wide session context, lazy provider
  chooser and cancellable challenge/sign/session dialog.
- **023C2B2 — product entry wiring:** replace manual-token entry on Runs/deep
  routes, preserve embed/share paths and resume one Composer create intent.
- **023C3 — Settings surface:** account inspection plus one-time CLI/Action
  token issue, copy and revoke UX.
- **023D — quotas and hardening:** challenge/run limits, active-live-run cap,
  cleanup, concurrency, leakage and a pre-buffer Node stream 413 boundary.

Each later wave receives its own RED freeze. 023A must not speculate about SQL,
wallet UI or quota implementation.

## Consequences

The existing opaque bearer API remains the authorization primitive after
sign-in, so run and share boundaries do not fork. A stolen signature cannot be
replayed after atomic consumption or reused for another domain, URI, chain or
purpose. Browser session expiry may interrupt a user, but persisted runs remain
available after a new signature.
