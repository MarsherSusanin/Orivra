# Slice 023A final corrective RED — auth response timestamps

## Rejected candidate

- Candidate commit: `7765e78610533bcc0407dbc6501a922d06c9c825`
- Candidate tree: `de373668ae5963249de292e0e359a8e04da26a49`
- Core verification passed, but independent Product verification rejected the
  candidate because public response schemas still accepted non-canonical auth
  timestamps.
- Role: Contract & Test Designer; tests/docs only, with no production,
  dependency or migration changes.

## Frozen boundary

Every response field backed by `AuthTimestampV1` uses exactly
`YYYY-MM-DDTHH:mm:ss.sssZ`:

- challenge `issuedAt` and `expiresAt`;
- session `issuedAt` and `expiresAt`;
- account-token `createdAt`, `expiresAt` and non-null `revokedAt`.

Canonical millisecond UTC values remain accepted. Missing milliseconds, numeric
offsets, RFC1123 and impossible calendar dates are rejected. Challenge and
session service results that violate this contract fail at the API output
boundary with a private sanitized `500`; the rejected timestamp is never
echoed.

## Intentional RED

Command:

```text
npx vitest run \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  --reporter=verbose
```

Observed:

```text
Test Files  2 failed | 1 passed (3)
Tests       3 failed | 24 passed (27)
```

Expected semantic reasons:

- the shared response timestamp schema accepts both missing milliseconds and a
  `+00:00` offset in all seven fields (14 accepted invalid field variants);
- an injected challenge with missing milliseconds escapes as `201`;
- an injected session with a numeric offset escapes as `201`.

The same focused run proves canonical timestamps, RFC1123 rejection, impossible
date rejection, exact challenge/session durations, UTF-8 message boundaries and
the earlier EIP-4361 builder contract remain green.

## Nearest green baseline

Command:

```text
npx vitest run \
  packages/contracts/test/public-contracts.test.ts \
  packages/contracts/test/slice022-network-capability.contract.test.ts \
  apps/api/test/api-contract.test.ts \
  apps/api/test/api-hardening.test.ts \
  apps/api/test/slice022-network-capability.contract.test.ts \
  --reporter=dot
```

Observed:

```text
Test Files  5 passed (5)
Tests       99 passed (99)
```

`npm run typecheck` and `git diff --check` pass. The full release matrix remains
deferred to candidate freeze.
