# Slice 023C1 RED — Web wallet access and session controller

## Baseline

- Accepted parent commit: `8cbff182b04eb8ecafee33ff7e2995fab228e208`
- Accepted parent tree: `5e3f6ecd2ef5cb373049fd8803a817a39592e0ee`
- Role: Contract & Test Designer; tests and docs only.

## Frozen boundary

The Web now has one intended transport contract for the seven public/network,
wallet-auth and browser-only account methods, plus a pure controller for the
`proofline:project-token` session lifecycle. RED freezes strict schema parsing,
exact empty sign-out, safe fetch settings, protected-only authorization,
sanitized errors, corruption recovery, offline retry, in-memory privacy-mode
fallback, single-flight/stale-attempt safety and zero auth analytics/log/URL
side effects.

Wallet-provider discovery/signing and rendered Settings remain later 023C
waves. No React, production service, dependency, public schema, API,
PostgreSQL, Sites or release-path change is part of this freeze.

## Intentional RED

```text
npx vitest run \
  src/services/slice023c1-wallet-access-client.contract.test.ts \
  src/services/slice023c1-wallet-session-controller.contract.test.ts \
  --reporter=dot
```

Observed before implementation:

```text
Test Files  2 failed (2)
Tests       15 failed (15)
```

Every failure has the same expected root cause: the frozen production modules
`src/services/wallet-access-client.ts` and
`src/services/wallet-session-controller.ts` do not exist. Dynamic test imports
keep the repository typecheck green while preserving all acceptance cases for
the GREEN author.

## Nearest green baseline

```text
npx vitest run \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  src/services/run-client-hardening.test.ts \
  src/services/run-list-client.test.ts \
  src/product-entry.contract.test.tsx \
  src/product-entry.states.test.tsx \
  --reporter=dot
```

Observed:

```text
Test Files  5 passed (5)
Tests       48 passed (48)
```

These are the unchanged strict auth schemas and current Web transport/product
entry boundaries. No broad Web coverage, browser, Sites or full matrix is
required at this stage.

`npm run typecheck` and `git diff --check` pass. This RED claims no affected
coverage or release PASS.
