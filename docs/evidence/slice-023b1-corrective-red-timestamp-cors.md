# Slice 023B1 corrective RED — timestamp precision and CORS

## Rejected candidate

- Candidate commit: `403d2d309de14c11331aa1643ddaa24f5eb0a1de`
- Candidate tree: `9d0ef3954e2cc34c3ed2757d67a33f7ba2ee208c`
- Role: Contract & Test Designer; this correction changes tests and docs only.

Independent verification reproduced two P1 gaps. PostgreSQL accepted paired
`+1 microsecond` changes to the challenge timestamps, while the driver hydrated
both values as millisecond JavaScript dates; canonical reconstruction therefore
could not observe the mutation. Separately, a browser preflight from the Sites
origin reached bearer authentication and returned `401` without CORS headers,
so the documented separately hosted API could not be used by the Web client.

## Frozen corrective contract

Migration 006 must reject non-millisecond `issued_at` and `expires_at` values.
The atomic consume `UPDATE` must independently require both values to equal
their millisecond truncation. The gated real PostgreSQL contract covers direct
sub-millisecond insertion, a paired microsecond mutation with constraints
temporarily removed to exercise consume-time defense, absence of recovery or
provisioning, retry behavior, and a canonical millisecond success.

The current browser `/v1/*` API surface receives one exact configured-origin
CORS policy. Representative public networks, wallet auth, protected success,
protected rejection and `Location` responses carry the authority. Valid
`GET`/`POST`/`DELETE` preflights with the allowlisted request headers complete
before bearer, idempotency and service ports. Invalid preflights fail privately
without CORS authority. Wildcards and credentialed CORS are forbidden;
server-to-server no-`Origin` behavior and wallet-auth exact actual-origin checks
are preserved.

## Intentional RED

Command:

```text
npx vitest run \
  apps/api/test/slice023b1-cors-readiness.contract.test.ts \
  apps/api/test/slice023b1-wallet-auth-persistence.contract.test.ts \
  apps/api/test/postgres/slice023b1-wallet-auth-migration.contract.test.ts \
  --reporter=verbose
```

Observed:

```text
Test Files  3 failed (3)
Tests       14 failed | 10 passed | 4 skipped (28)
```

Expected RED reasons are isolated: twelve CORS assertions see bearer `401` or
missing exact-origin headers, one consume-query assertion lacks the two
millisecond guards, and one migration source assertion lacks the timestamp
constraints. The four real PostgreSQL cases are gated and skipped here; a skip
is not claimed as PASS.

## Nearest green baseline

Command:

```text
npx vitest run \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  apps/api/test/api-contract.test.ts \
  apps/api/test/api-hardening.test.ts \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/slice022-network-capability.contract.test.ts \
  --reporter=dot
```

Observed:

```text
Test Files  7 passed (7)
Tests       89 passed (89)
```

`npm run typecheck` passes. No production source, SQL migration, dependency,
full matrix, affected coverage, real PostgreSQL PASS or release PASS is claimed.
