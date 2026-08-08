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

One Coston2 wallet identity owns one automatically created default project.
Identity provisioning runs under a transaction-scoped advisory lock derived
from `(114, normalized address)`. A successful browser session returns a random
256-bit `project_` token once, valid for 12 hours. Only its keyed digest is
persisted; Web may retain the raw token only in `sessionStorage`. Account
settings may issue independently revocable `cli` or `action` tokens for 1–90
days. Existing bearer and run-scoped share semantics remain unchanged.

Challenge consumption is a separate short transaction which atomically marks
one unexpired, unconsumed challenge and commits before local EOA recovery. An
invalid signature therefore spends the challenge. Missing, expired and already
consumed challenges share the private `CHALLENGE_UNAVAILABLE` outcome and do
not reveal which condition occurred.

Migration 006 adds `wallet_identities` and `wallet_challenges` plus additive
`api_tokens` kind, label, expiry and wallet-identity metadata. Existing project
tokens are backfilled as `legacy` with null expiry. Browser rows require a
wallet identity and expiry; authentication accepts null-expiry legacy rows but
rejects expired or revoked rows. The API role alone receives the minimum new
table privileges; the worker receives none.

## Delivery waves

- **023A — contracts and crypto:** public schemas, deterministic EIP-4361
  construction, local EOA recovery port, and public auth-route boundary.
- **023B1 — persisted wallet sessions:** migration 006, atomic single-use
  challenges, local EOA recovery, locked default-project creation, digest-only
  12-hour browser sessions and browser-token authentication.
- **023B2 — account token management:** account read plus CLI/Action issue and
  revoke endpoints for 1–90 day tokens.
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
