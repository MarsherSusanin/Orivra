# Slice 023B1 corrective RED — persisted challenge integrity

## Rejected candidate

- Candidate commit: `b777b722401a524a39c22b792525054cbc2b2549`
- Candidate tree: `16e8872be1d842588cc7d4200f4f61e69dbe38df`
- Role: Contract & Test Designer; tests/docs only, with no production,
  dependency or SQL migration changes.

The candidate trusted the persisted message directly. Its consumption query did
not return the nonce, so the service could not reconstruct the server-authored
EIP-4361 message from the configured Web authority and stored input fields.

## Intentional corrective RED

Command:

```text
npx vitest run \
  apps/api/test/slice023b1-wallet-auth-persistence.contract.test.ts \
  --reporter=verbose
```

Observed:

```text
Test Files  1 failed (1)
Tests       5 failed | 3 passed (8)
```

Expected semantic reasons:

- the atomic consume query omits the persisted 32-byte nonce from `RETURNING`;
- stored message-byte, domain, nonce and timestamp corruption each reaches EOA
  recovery and returns `WALLET_SIGNATURE_INVALID` instead of failing closed as
  `CHALLENGE_UNAVAILABLE`.

The same focused run proves canonical challenge creation, valid session
provisioning and the original invalid-signature path remain green. Invalid
signatures still commit before recovery, call recovery with the canonical
message, return `WALLET_SIGNATURE_INVALID`, and make retry unavailable.

## Corrective contract

After atomic consumption commits, the service rebuilds EIP-4361 from the
configured `publicWebOrigin` and persisted address, nonce, `issued_at` and
`expires_at`. The UTF-8 bytes must exactly equal the persisted message before
any recovery call. Corruption is durably consumed, returns the same fixed
private `409 CHALLENGE_UNAVAILABLE`, invokes neither recovery nor provisioning,
and remains unavailable on retry.

## Nearest green baseline

Command:

```text
npx vitest run \
  apps/api/test/postgres/slice023b1-wallet-auth-migration.contract.test.ts \
  apps/api/test/postgres/testcontainers.test.ts \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  --reporter=dot
```

Observed:

```text
Test Files  5 passed | 1 skipped (6)
Tests       43 passed | 4 skipped (47)
```

The skipped tests are the unchanged real PostgreSQL gates and are not claimed
as PASS. `npm run typecheck` and `git diff --check` pass. No full matrix or real
PostgreSQL PASS is claimed.
