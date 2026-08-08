# Slice 023A corrective RED — auth canonicalization

## Rejected candidate

- Candidate commit: `1a18d54bb50215735cba6a3b354166800b33a00a`
- Candidate tree: `5fbb0b3c20137977b3449ce08a56f707966e111b`
- Role: Contract & Test Designer; tests/docs only, with no production,
  dependency or migration changes.

Two independent verification findings reject this candidate:

1. The EIP-4361 builder accepts parseable RFC1123 and non-canonical RFC3339
   timestamps instead of requiring canonical millisecond UTC values.
2. The public challenge schema counts JavaScript characters, allowing an
   EIP-4361 message above the 8192-byte UTF-8 boundary to escape through the
   builder and API output.

## Intentional corrective RED

Command:

```text
npx vitest run \
  apps/api/test/slice023a-wallet-auth-pure.contract.test.ts \
  packages/contracts/test/slice023a-wallet-auth.contract.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  --reporter=verbose
```

Observed:

```text
Test Files  3 failed (3)
Tests       4 failed | 19 passed (23)
```

Expected semantic reasons:

- `buildEip4361Message` accepts RFC1123 and other parseable but non-canonical
  timestamp representations;
- the builder returns a message above 8192 UTF-8 bytes;
- `WalletChallengeV1Schema` accepts 4097 two-byte `é` characters (8194 bytes);
- the challenge route returns an oversized service result with `201` instead
  of a sanitized private `500`.

The same corrective tests preserve both exact boundaries: canonical
millisecond-UTC timestamps are accepted, 8192-byte ASCII and multibyte messages
are accepted, and an exact 8192-byte auth Request body still reaches the
service.

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
deferred; this corrective RED changes only the rejected candidate's frozen
auth contract and its focused evidence.
