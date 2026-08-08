# ADR 0024 — Wallet identity and self-service project access

## Status

Accepted for Slice 023.

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
`Referrer-Policy: no-referrer`. Every other route remains bearer-protected.

One wallet owns one automatically created default project. A successful browser
session returns a 256-bit `project_` token once, valid for 12 hours. Only its
keyed digest is persisted; Web may retain the raw token only in
`sessionStorage`. Account settings may issue independently revocable `cli` or
`action` tokens for 1–90 days. Existing bearer and run-scoped share semantics
remain unchanged.

## Delivery waves

- **023A — contracts and crypto:** public schemas, deterministic EIP-4361
  construction, local EOA recovery port, and public auth-route boundary.
- **023B — persistence and API auth:** wallet/challenge migrations, atomic
  single-use challenge consumption, default-project creation, digest-only
  sessions, account and token endpoints.
- **023C — Web session and Settings:** wallet states, lazy wallet code,
  session-only token retention, reconnect/sign-out and CLI/Action token UI.
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
