# Slice 023B1 final corrective RED — database clock authority

## Rejected candidate

- Candidate commit: `84c43f922b7ee66486696943a92c688ac34b4b41`
- Candidate tree: `c98d6b92c5fce2a3223ce6adb6ff52e4cb8af9b3`
- Role: Contract & Test Designer; tests and docs only.

The Core verifier passed the frozen tree. Independent Product Integration
Verification reproduced PostgreSQL `23514` in three real session cases: the API
created `issued_at` from application `Date`, the consume query wrote database
`now()`, and a small API/DB skew violated `consumed_at >= issued_at` before EOA
recovery. The same audit found that ADR 0024 omitted the existing public
`GET /v1/networks` exception from its bearer-route description.

## Frozen corrective contract

PostgreSQL is the only persisted wallet-auth clock authority:

- challenge creation reads a millisecond-truncated database issue time before
  building and persisting the canonical message; expiry is exactly five minutes;
- consumption keeps the expiry and precision predicates and writes a
  millisecond database time no earlier than the challenge issue time;
- browser-session provisioning reads its database issue time inside the locked
  transaction and uses the same issue/12-hour-expiry values in token persistence
  and the public session response;
- moving application `Date` far ahead or behind cannot alter persisted auth
  timestamps or break canonical, concurrent or durable invalid-signature flows.

## Intentional RED

Command:

```text
npx vitest run \
  apps/api/test/slice023b1-wallet-auth-persistence.contract.test.ts \
  apps/api/test/postgres/slice023b1-wallet-auth-migration.contract.test.ts \
  --reporter=verbose
```

Observed:

```text
Test Files  1 failed | 1 passed (2)
Tests       3 failed | 8 passed | 5 skipped (16)
```

The three expected hermetic failures prove the candidate still uses application
time for challenge creation, plain database `now()` for consumption, and
application time for session provisioning. Five real PostgreSQL cases,
including the new ahead/behind clock scenario, are gated and skipped here; a
skip is not claimed as PASS.

## Nearest green baseline

Command:

```text
npx vitest run \
  apps/api/test/slice023b1-cors-readiness.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  apps/api/test/api-contract.test.ts \
  apps/api/test/api-hardening.test.ts \
  apps/api/test/bootstrap-coverage.test.ts \
  --reporter=dot
```

Observed:

```text
Test Files  7 passed (7)
Tests       97 passed (97)
```

`npm run typecheck` and `git diff --check` pass. No production source, SQL
migration, dependency, real PostgreSQL PASS, coverage or full release matrix is
claimed.
