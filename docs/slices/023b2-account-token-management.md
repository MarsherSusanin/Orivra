# Slice 023B2 — Account token management

## User outcome

A developer signed in with a wallet can inspect the default project, create one
CLI or GitHub Action secret, later revoke it, and sign out the current browser
session. Token lists never reveal credentials and a lost issuance response
cannot cause the same secret to be returned again.

## HTTP contract

- `GET /v1/account` returns the EOA, default project and only CLI/Action token
  summaries.
- `POST /v1/account/tokens` accepts the strict V1 kind, label and integer
  `expiresInDays` from 1 through 90. It requires
  `Idempotency-Key: token_issue_<64 lowercase hex>` and returns the random
  256-bit `project_` secret only for the first committed issuance.
- `DELETE /v1/account/tokens/:tokenId` revokes one project-owned CLI/Action row.
  Repetition preserves the first revocation time and returns the same public
  success.
- `DELETE /v1/auth/wallet/sessions/current` accepts no body or idempotency key,
  revokes the exact authenticated browser token and returns empty `204`.

All four routes require a browser-kind wallet session. Authentication supplies
`credentialKind`, private token ID and wallet identity ID from the keyed-digest
lookup. CLI, Action and legacy credentials retain ordinary project access but
receive private `403 ACCOUNT_SESSION_REQUIRED` here. Share receives `403` and
missing/expired/revoked credentials receive `401`. Cross-project or non-CLI/
Action token targets are indistinguishable private `404` outcomes.

Every response is `no-store`, `no-referrer` and follows the existing exact
origin CORS policy. Service output is parsed through strict public schemas;
empty sign-out output is enforced. Internal errors, digests, target details and
raw tokens are never echoed.

## Persistence contract

Migration 007 adds nullable 32-byte `issuance_key_digest` and
`issuance_fingerprint` evidence. Both are required exactly for CLI/Action rows
and absent for browser/legacy rows. CLI/Action rows require a trimmed 1–128
character label, wallet identity, millisecond database issue/expiry times and
an exact whole-day duration from 1 through 90 days.

A partial unique index on `(project_id, issuance_key_digest)` serializes one
effect per issuance key. A matching persisted fingerprint produces
`ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED`; a different fingerprint produces
`IDEMPOTENCY_CONFLICT`. The raw secret is generated randomly, returned once and
discarded after its keyed digest is stored. No PRF-derived secret or raw-response
record is allowed.

Account reads first resolve the wallet identity owned by the project, then
select CLI/Action public columns only. `token_digest` is not selected. Ordering
is `created_at DESC, id DESC`. Public `token_` IDs are reversible renderings of
the existing UUID and never grant authority.

CLI/Action revocation is project-scoped, kind-scoped and uses
`COALESCE(revoked_at, database_millisecond_time)` so retries and concurrent calls
preserve the original time. Current-session revocation additionally matches the
authenticated private token UUID, project, wallet identity and `browser` kind.

## RED and gates

Hermetic contracts cover exact routes, browser-only authentication evidence,
strict bodies and outputs, private headers/CORS, one-time idempotency outcomes,
DB-clock persistence, digest-only storage, stable list SQL and revocation. Static
migration tests freeze version 007, constraints, partial indexes and tightened
API-only grants.

Real PostgreSQL cases are gated by `PROOFLINE_TESTCONTAINERS=1` and cover 006→007
upgrade/rerun, browser/legacy compatibility, issuance/authentication/expiry/
revocation, digest-only rows, concurrency, stable retries, project isolation,
invalid rows and current-session sign-out/retry. Gated skips are not PASS.

023C Web settings, quotas and the Node pre-buffer body limit remain out of scope.

Architecture decision: [ADR 0024](../adr/0024-wallet-identity-and-self-service-access.md).
