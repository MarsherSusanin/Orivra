# Slice 023D1 RED — persisted API admission quotas

Date: 2026-08-09

## Scope and freeze

This RED wave adds ADR 0030, the 023D1 Slice Contract, runbook configuration
and tests only. It does not add migration 008 and does not edit API, wallet,
run-client, worker, PostgreSQL production code, dependencies, public success
schemas, Sites, Docker or deployment configuration.

The frozen contract requires:

- 5 wallet challenges per normalized address and 300 globally per UTC minute;
- 100 new runs per project per UTC day;
- 3 active nonterminal wallet/relayer runs per project, with replay excluded
  only from that active cap;
- bounded canonical environment overrides and a first-row frozen limit;
- PostgreSQL clock windows, domain-separated SHA-256 subjects, transactional
  reservation and project-scoped advisory-lock admission;
- a persisted per-project `active_live` UTC-day policy row with zero consumed
  units, so its first row freezes one cap across rolling API processes;
- same-intent create replay and changed-fingerprint conflict before quota use;
- exact sanitized 429/409 outcomes, bounded `Retry-After`, exact-origin CORS
  exposure and status/surface-compatible clients;
- bounded cleanup of only quota windows and wallet challenges older than 24
  hours, without weakening accepted admission when cleanup fails.

The existing ErrorV1 JSON shape remains unchanged. Raw addresses, quota
subjects, limits, windows, stack bytes and bearer material are not added to an
error response or client failure.

The corrective leak assertion inspects forbidden fields and values separately
from the required normalized `error.code`. It therefore rejects `address`,
digest, window, limit, stack, secret and bearer evidence without treating the
literal `LIMIT` inside `WALLET_CHALLENGE_RATE_LIMITED` as leaked quota state.

## Intentional RED

Command:

```sh
npx vitest run \
  apps/api/test/slice023d1-persisted-quota-service.contract.test.ts \
  apps/api/test/slice023d1-quota-http.contract.test.ts \
  apps/api/test/postgres/slice023d1-quota-migration.contract.test.ts \
  src/services/slice023d1-quota-client.contract.test.ts
```

Result: 4 files RED; 47 cases total, 26 intentional failures, 16 passing
negative/baseline assertions and 5 opt-in real-PostgreSQL cases skipped.

The failures map to the absent implementation:

1. `parseApiQuotaPolicy` and env-to-service quota composition do not exist;
2. wallet challenge creation has no transaction, quota rows, atomic rollback
   or bounded cleanup;
3. create-run does not acquire the project admission lock, repeat the
   idempotency read or reserve/check persisted daily/active-policy admission;
4. API errors do not produce bounded `Retry-After`, and allowed CORS responses
   therefore cannot expose it;
5. wallet/run clients do not implement the new strict allowlists, bounded
   retry evidence and fixed quota copy;
6. migration 008 and `quota_windows` do not exist.

The existing aggregate real-PostgreSQL migration inventory is also frozen to
the exact ordered filename `008_persisted_admission_quotas.sql`, versions
`1..8` on an empty schema and `0..8` after previous-schema upgrade. Its rerun
expectation remains two identical executions of the complete ordered list.
With Testcontainers enabled it is intentionally RED only because migration 008
is absent; the inventory check runs before container discovery, so no Docker
runtime or earlier migration/PostgreSQL behavior can mask that RED reason.

```sh
PROOFLINE_TESTCONTAINERS=1 npx vitest run \
  apps/api/test/postgres/testcontainers.test.ts --maxWorkers=1
```

Result: 1 file RED, 1 intentional failure and zero skipped cases. The exact
failure is the ordered inventory missing only
`008_persisted_admission_quotas.sql` after accepted migrations 001–007.

No failure is caused by a TypeScript compile error, missing fixture, changed
success contract or production regression.

## Nearest unchanged baseline

Command:

```sh
npx vitest run \
  apps/api/test/slice023b1-wallet-auth-persistence.contract.test.ts \
  apps/api/test/concurrent-create-run.contract.test.ts \
  apps/api/test/slice023b1-cors-readiness.contract.test.ts \
  src/services/slice023c1-wallet-access-corrective.contract.test.ts \
  src/services/run-client-hardening.test.ts \
  apps/api/test/postgres/migration-static.test.ts \
  apps/api/test/postgres/slice023b1-wallet-auth-migration.contract.test.ts
```

Result: 7 files PASS; 89 tests PASS and 5 existing opt-in PostgreSQL tests
skip because `PROOFLINE_TESTCONTAINERS` was not enabled.

TypeScript contract:

```sh
npm run typecheck
```

Result: PASS.

`git diff --check` is clean. This RED wave does not claim API/Web coverage,
real PostgreSQL, Docker, hosted or live Coston2 PASS.

## Mandatory GREEN PostgreSQL evidence

The checked-in opt-in suite must be run after migration and production GREEN:

```sh
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

The quota cases may not be skipped. They freeze empty/upgraded/idempotent
migration 008, least privilege, restart persistence, first-window limit
freezing (including mixed-replica active caps), hostile app-clock skew,
concurrent address/global and daily/live
boundaries, project isolation, replay-before-quota, terminal slot release,
rollback without partial run/event/command effects and cleanup preservation.
This module gate is credential-free and is not the unified 022–029A candidate
matrix.

## Corrective RED after independent verification

The first GREEN candidate
`b46040c5671ccd2398f06d391441a4377ef29436`, tree
`5258bb0d73bfabd7c76e23dca22bb2f9b24ab1dd`, is rejected and received neither
independent PASS.

Core verification found that `createWalletChallenge` retains its checked-out
admission client after `COMMIT`, awaits cleanup through `pool.query`, and only
releases the client in `finally`. A `max=1` pool therefore blocks after commit;
when `max=N` successful requests occupy all `N` clients, every request can wait
for a second slot. The corrective contract permits cleanup through the same
committed client or one exact release before awaited pool cleanup. It also
requires cleanup failure to remain fail-open and fully awaited, with no
detached unhandled work or extra quota/challenge reservations.

Product verification found that the quota-specific create-run client branch
turns established safe `409 IDEMPOTENCY_CONFLICT` and
`409 NETWORK_CAPABILITY_DISABLED` outcomes into `HTTP_409`. The corrective
client matrix preserves those exact status-compatible codes with fixed copy,
keeps the two new quota outcomes status-compatible, and retains `HTTP_<status>`
fallback for unknown, malformed or mismatched evidence without echoing hostile
body, header or bearer bytes.

Corrective focused command:

```sh
npx vitest run \
  apps/api/test/slice023d1-persisted-quota-service.contract.test.ts \
  apps/api/test/slice023d1-quota-http.contract.test.ts \
  apps/api/test/postgres/slice023d1-quota-migration.contract.test.ts \
  src/services/slice023d1-quota-client.contract.test.ts
```

Result: 4 files, 57 cases total: 5 intentional failures, 46 passing controls
and 6 opt-in real-PostgreSQL cases skipped. The five failures are exactly the
three post-commit pool-starvation cases and the two established 409 codes being
received as `HTTP_409`. The two directly changed hermetic suites report 38
cases: the same 5 intentional failures and 33 passing controls.

The nearest unchanged seven-file baseline was rerun and remains 89 PASS with
5 existing opt-in PostgreSQL cases skipped. `npm run typecheck` is PASS and
`git diff --check` is clean.

The new gated max-one PostgreSQL case was invoked with Testcontainers enabled,
but this environment reported `Could not find a working container runtime
strategy` before the test body and reported 9 skipped cases. This is neither a
semantic test result nor a PostgreSQL PASS. The gated case remains mandatory
GREEN evidence and may not be reported as PASS while skipped.
