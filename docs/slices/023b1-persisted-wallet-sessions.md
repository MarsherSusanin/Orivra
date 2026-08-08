# Slice 023B1 — Persisted wallet sessions

## User outcome

A developer can request one server-authored challenge, sign it once and receive
a 12-hour project bearer token for a stable default project. Reloading or
running more than one API process cannot make a challenge reusable or create a
second default project.

## Included boundary

- additive PostgreSQL migration 006;
- production challenge and session service methods behind the existing public
  023A routes;
- local EOA recovery through the wallet-auth recovery port; production
  composition uses viem and performs no RPC;
- browser-token authentication in the existing bearer path;
- explicit production `PROOFLINE_WEB_ORIGIN` with no placeholder authority.

023B2 account/token endpoints, 023C Web state, 023D rate limits/quotas/cleanup
and the pre-buffer Node body limit are excluded.

## Persistence contract

`wallet_identities` stores a UUID, fixed Coston2 chain `114`, normalized
20-byte address, unique default-project reference and creation time. Both
`(chain_id, address)` and `default_project_id` are unique.

`wallet_challenges` stores the public `challenge_` ID, normalized 20-byte
address, 32-byte nonce, exact persisted EIP-4361 message, canonical issue time,
exact five-minute expiry and nullable consumption time. Message storage is
bounded to 8192 UTF-8 bytes. Expiry is indexed for later cleanup, but cleanup is
not part of B1.

Migration 006 adds `kind`, `label`, `expires_at` and `wallet_identity_id` to
`api_tokens`. Existing rows become `legacy` with null expiry. Supported kinds
are `legacy`, `browser`, `cli` and `action`; B1 creates only `browser`. A browser
row must have an expiry and wallet identity. Its existing `scope='project'`
contract remains unchanged.

Only `proofline_api` receives SELECT/INSERT on the new tables and column-level
UPDATE of `wallet_challenges.consumed_at`. No new worker privilege is granted.

## Transaction contract

Challenge creation uses independent cryptographically random 32-byte challenge
identity and nonce values, server time and the configured HTTPS Web origin. It
persists the exact response evidence before returning.

Session creation first runs a short consumption transaction:

1. Atomically update one row where `consumed_at IS NULL` and
   `expires_at > now()` and return its persisted address/message.
2. Commit and release the connection.
3. Recover the EOA locally from that exact message and submitted signature.

Missing, expired and consumed rows return private `409
CHALLENGE_UNAVAILABLE`. A wrong EOA returns private `401
WALLET_SIGNATURE_INVALID`; the spent challenge cannot be retried.

After valid recovery a second transaction obtains an advisory lock derived from
`(114, normalized address)`, finds or creates the single wallet identity and
default project, creates a fresh random `project_` token with an exact 12-hour
expiry, persists only its keyed digest and commits. Concurrent attempts for one
challenge yield at most one session. Distinct later sessions reuse the same
identity and project.

Authentication keeps existing project/share behavior. Project-token selection
requires `revoked_at IS NULL` and `(expires_at IS NULL OR expires_at > now())`:
null expiry preserves legacy rows, while browser rows expire. Share selection
and run scope are unchanged.

## RED and gates

Hermetic RED freezes service generation, consume-before-recovery ordering,
unified unavailable errors, advisory-lock provisioning, digest-only storage,
explicit origin and project-token expiry SQL. Static migration tests freeze the
schema, upgrade and grants.

Real PostgreSQL cases are checked in behind `PROOFLINE_TESTCONTAINERS=1`. They
must pass during GREEN verification and cover idempotent 001→006 migration,
legacy backfill, concurrent single consumption, digest-only browser tokens,
expired/revoked authentication, default-project uniqueness and durable invalid
signature consumption. A skipped container block is not PASS evidence.

Architecture decision: [ADR 0024](../adr/0024-wallet-identity-and-self-service-access.md).
