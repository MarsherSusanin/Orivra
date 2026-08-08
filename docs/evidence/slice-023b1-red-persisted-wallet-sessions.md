# Slice 023B1 RED — persisted wallet sessions

## Frozen parent

- Parent commit: `50f188619b78873e6ef14af39151560688692a1a`
- Parent tree: `5d11688cfb2d03b8b2fbe304f08d1bbad0e70f75`
- Role: Contract & Test Designer; tests/docs only. No production code,
  dependency or SQL migration is included in this RED commit.

## Intentional RED

Command:

```text
npx vitest run \
  apps/api/test/slice023b1-wallet-auth-persistence.contract.test.ts \
  apps/api/test/postgres/slice023b1-wallet-auth-migration.contract.test.ts \
  apps/api/test/postgres/testcontainers.test.ts \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  --reporter=verbose
```

Observed:

```text
Test Files  3 failed | 3 passed | 1 skipped (7)
Tests       8 failed | 38 passed | 4 skipped (50)
```

Expected semantic reasons:

- production service has no persisted challenge/session methods (three RED);
- production bootstrap still substitutes a placeholder Web origin (one RED);
- project-token authentication does not filter expiry (one RED);
- additive migration 006 is absent, so its three static contracts are RED.

The three B1 real PostgreSQL cases and the aggregate migration suite are
deliberately `runIf`-gated and skipped in this hermetic RED run. They are frozen
GREEN requirements, not PostgreSQL PASS evidence.

## Nearest green baseline

Command:

```text
npx vitest run \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  apps/api/test/api-contract.test.ts \
  apps/api/test/api-hardening.test.ts \
  apps/api/test/postgres/migration-static.test.ts \
  apps/api/test/postgres/repository-contract.test.ts \
  --reporter=dot
```

Observed:

```text
Test Files  7 passed (7)
Tests       81 passed (81)
```

`npm run typecheck` and `git diff --check` pass. No coverage, full repository
matrix or real PostgreSQL PASS is claimed at RED freeze.
