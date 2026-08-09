# ADR 0030 — Persisted API admission quotas

Status: accepted for Slice 023D1 RED

## Context

Wallet challenge creation and run creation are persisted admission boundaries,
but the accepted implementation has no durable rate or concurrency limits.
Process-memory counters would reset on restart, disagree across API replicas and
use an application clock that is not authoritative for persisted evidence.

The existing create-run command is idempotent. A retry of an already accepted
intent must remain byte-identical evidence and must not consume a second quota
unit. Conversely, checking a quota outside the create transaction could admit
more live work than the configured project cap. ADR 0024 deliberately did not
pre-authorize quota error codes, so this slice must also freeze their HTTP and
browser-client handling.

## Decision

### MLP limits and configuration

The credential-free MLP uses these defaults:

| Admission boundary | Default | Environment variable | Accepted range |
|---|---:|---|---:|
| Wallet challenges per normalized address per UTC minute | 5 | `PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT` | 1–60 |
| Wallet challenges globally per UTC minute | 300 | `PROOFLINE_WALLET_CHALLENGE_GLOBAL_MINUTE_LIMIT` | 1–10,000 |
| Created runs per project per UTC day | 100 | `PROOFLINE_PROJECT_RUN_DAILY_LIMIT` | 1–10,000 |
| Active nonterminal live runs per project | 3 | `PROOFLINE_PROJECT_ACTIVE_LIVE_RUN_LIMIT` | 1–100 |

Configuration accepts canonical base-10 positive integers only. Whitespace,
signs, decimals, exponent notation, leading zeroes and out-of-range values fail
production composition before request handling. The global challenge limit
must be greater than or equal to the per-address limit. No value is secret.

The first committed quota or active-policy row for a window freezes its
`limit_value`. A rolling restart with a different valid configuration does not
reinterpret or resize an existing window; the new value applies only when a
later window is first created.

### Persistence and clock authority

Migration 008 adds `proofline_private.quota_windows` with
`quota_kind`, 32-byte `subject_digest`, `window_start`, `window_end`,
`limit_value` and `used_count`. Its primary key is
`(quota_kind, subject_digest, window_start)`. Checks require an allowed kind,
canonical UTC minute/day boundaries, the exact one-minute or one-day duration,
positive frozen limits. Metered rows require `used_count` between one and the
frozen limit; `active_live` policy rows require exactly zero because the active
count is derived from persisted runs rather than consumed. An index on
`window_end` supports bounded cleanup.

PostgreSQL is the sole quota clock. One query derives the current millisecond
UTC time and its minute/day boundaries. Application `Date`, client timestamps
and HTTP dates never choose a quota window or `Retry-After` value.

Quota subjects are deterministic domain-separated SHA-256 digests, not keyed
digests and not new secrets:

- address minute: SHA-256 of the UTF-8 prefix
  `proofline:quota:wallet-challenge-address:v1\0` followed by the normalized
  20 address bytes;
- global minute: SHA-256 of the UTF-8 string
  `proofline:quota:wallet-challenge-global:v1`;
- project day: SHA-256 of the UTF-8 prefix
  `proofline:quota:project-run-day:v1\0` followed by the canonical lowercase
  project UUID.
- active-live policy: SHA-256 of the UTF-8 prefix
  `proofline:quota:project-active-live:v1\0` followed by the canonical
  lowercase project UUID.

Migration 008 revokes public access. The API receives only the table
`SELECT`, `INSERT`, `DELETE` and column-level `UPDATE (used_count)` privileges,
plus `DELETE` on expired wallet challenges for cleanup. The worker receives no
quota-window or wallet-challenge privilege.

### Wallet challenge admission

Challenge creation normalizes and validates the address before database work.
One transaction derives the database window, reserves one address unit and one
global unit, creates the canonical challenge from that same database clock and
inserts it before commit. Reservation uses an atomic upsert whose conflict path
increments only while `used_count < limit_value`; it never replaces the stored
limit. Address and global rows are acquired in a deterministic order. Failure
of either reservation rolls the whole transaction back, including the other
counter and the challenge insert.

The first five accepted challenges for an address in one UTC minute succeed by
default. The sixth returns private `429 WALLET_CHALLENGE_RATE_LIMITED`. The
global 301st challenge in that minute returns the same code. The result does
not reveal whether the address or global boundary fired.

`Retry-After` is a canonical integer number of seconds computed as the ceiling
from the database clock to the rejecting stored window end and clamped to
`1..60`. Error JSON keeps the existing ErrorV1 envelope and fixed message; it
does not add counter, limit, address, digest, window, stack or upstream bytes.

### Run admission

All new runs, including replay runs, consume the project daily quota. The
default 101st new run in one UTC day returns
`429 PROJECT_RUN_QUOTA_EXHAUSTED` with `Retry-After` computed from the stored
day-window end and clamped to `1..86400`.

Only `wallet` and `relayer` manifests participate in the active-live cap.
`replay` is excluded. A live run is active while its persisted projection is
nonterminal. The default fourth active live run returns
`409 ACTIVE_LIVE_RUN_LIMIT_REACHED`; it has no `Retry-After` because another
run's completion time is not known.

The cap is itself a persisted `active_live` UTC-day policy row for the project.
Its `used_count` is always zero. The first new live admission in that day
inserts the row with the configured cap; later API processes read the stored
`limit_value` even if their valid environment differs. The next UTC day may
freeze a new bounded cap. Every nonterminal wallet/relayer run is counted,
including one created on an earlier day.

Create-run admission remains one transaction:

1. parse the manifest and compute its request fingerprint;
2. query the existing `(project_id, idempotency_key)` intent and return an
   exact same-fingerprint replay before quota work;
3. for a new intent, acquire a transaction-scoped project admission advisory
   lock and repeat the idempotency query after the lock;
4. reserve the daily quota row from the database day window;
5. for a wallet/relayer manifest, create or read that project's current
   `active_live` policy row, then count persisted nonterminal wallet/relayer
   runs under the same lock and enforce its stored cap;
6. insert run, first event and preflight command, then commit.

A same-key changed fingerprint remains `409 IDEMPOTENCY_CONFLICT` before quota
consumption. A quota/cap rejection rolls back every reservation and inserts no
run, event or command. Concurrent API instances therefore admit at most the
stored daily limit and at most the configured active-live cap per project.
Terminal live runs free an active slot; they do not refund the daily unit.

### HTTP, CORS and client evidence

ADR 0024's exact wallet-client allowlist gains only status-compatible
`429 WALLET_CHALLENGE_RATE_LIMITED`. The run client recognizes only
`429 PROJECT_RUN_QUOTA_EXHAUSTED` and
`409 ACTIVE_LIVE_RUN_LIMIT_REACHED` for this boundary. Unknown,
status-incompatible or malformed codes fall back to `HTTP_<status>`.

Clients expose only a sanitized optional integer `retryAfterSeconds` when the
header is canonical and within the code-specific bound. Invalid, HTTP-date,
overlong or attacker-controlled `Retry-After` is discarded and never copied
into an error message, stack, URL, storage or serialized extra field. Quota
errors use fixed client-owned copy and never echo the server message.

An allowed-origin quota response adds `Retry-After` to
`Access-Control-Expose-Headers` alongside `Location`. It does not change the
exact allow-origin decision and never adds wildcard or credentialed CORS.
Non-quota responses do not advertise a missing retry header.

### Cleanup

Challenge admission performs bounded, index-backed cleanup in the same API
ownership boundary. At most 100 rows per table are removed per attempt, using
`FOR UPDATE SKIP LOCKED`:

- quota windows whose `window_end` is at least 24 hours older than the database
  clock;
- wallet challenges whose `expires_at` is at least 24 hours older than the
  database clock.

Cleanup may fail without weakening admission, but the failure is sanitized.
It never deletes wallet identities, API tokens, projects, runs, append-only run
events, artifacts, commands, relayer evidence, current/recent windows or
current/recent challenges.

## Delivery and evidence

023D1 owns ADR 0030, migration 008, quota configuration, persisted challenge
and run admission, cleanup, HTTP/CORS mapping and sanitized Web clients. It
does not change public success schemas, worker execution, relayer policy,
retention/deletion, Docker deployment or the Node pre-buffer stream boundary;
the latter remains 023D2.

Focused GREEN requires hermetic service/API/client/static-migration tests,
`npm run typecheck`, affected API/Web coverage gates and
`PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1`. The real
PostgreSQL suite must prove migration 008 on empty and upgraded schemas,
restart persistence, first-row limit freezing, database clock behavior,
concurrent exact-boundary winners, project isolation, replay-before-quota,
live/replay/terminal classification, rollback without partial effects, least
privilege and cleanup preservation. A skipped Testcontainers case is not PASS.

## Consequences

- Admission remains consistent across restarts and multiple API processes.
- Strict project serialization is an explicit MLP trade-off for exact active
  live-run admission.
- Daily quota is not a billing ledger and is intentionally not refunded.
- Address digests reduce casual identity disclosure in quota rows but are not
  treated as secrets because the source address is public.
- Changing the defaults or quota semantics requires a later ADR; changing an
  environment value cannot rewrite an already opened quota or active-policy
  window.
