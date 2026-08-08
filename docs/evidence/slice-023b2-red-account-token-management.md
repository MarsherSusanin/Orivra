# Slice 023B2 RED — account token management

## Baseline

- Accepted parent commit: `b9c008f84b4e8147dd50a5925efbd03d048cd3fe`
- Accepted parent tree: `60216528160cc63bf07598ba9a11d25d191adcc3`
- Role: Contract & Test Designer; tests and docs only.

## Frozen decisions

The account surface is authorized only by a browser-kind wallet session using
private authentication evidence. CLI, Action and legacy credentials keep their
ordinary project authority but cannot mint or revoke credentials. Issuance keys
are exact random-looking 256-bit route-specific values. The raw token is shown
only for the first committed effect; retry returns a stable private `409`, not a
replayed or deterministically regenerated secret.

The slice also restores the originally planned current-session DELETE route:
one exact browser token is revoked by its authenticated private IDs and the
empty `204` response cannot serialize service data.

## Intentional RED

```text
npx vitest run \
  apps/api/test/slice023b2-account-token-routes.contract.test.ts \
  apps/api/test/slice023b2-account-token-service.contract.test.ts \
  apps/api/test/postgres/slice023b2-account-tokens.contract.test.ts \
  --reporter=dot
```

Observed:

```text
Test Files  3 failed (3)
Tests       20 failed | 5 skipped (25)
```

Failures are decision-complete and expected: exact routes and private headers
are absent, production authentication does not expose credential-kind/private
IDs, account service methods do not exist, and migration 007 is absent. The five
real PostgreSQL cases are gated and skipped; they are not PASS evidence.

## Nearest green baseline

```text
npx vitest run \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  apps/api/test/slice023b1-wallet-auth-persistence.contract.test.ts \
  apps/api/test/slice023b1-cors-readiness.contract.test.ts \
  apps/api/test/api-contract.test.ts \
  apps/api/test/api-hardening.test.ts \
  --reporter=dot
```

Observed:

```text
Test Files  7 passed (7)
Tests       92 passed (92)
```

`npm run typecheck` and `git diff --check` pass. No production source, SQL
migration, public schema, dependency, real PostgreSQL PASS, coverage or full
suite is part of this RED freeze.
