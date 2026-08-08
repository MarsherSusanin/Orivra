# Slice 023A RED — wallet auth contracts

## Frozen parent

- Parent commit: `74e7fe503e0970eb1cf47dd361092ea7d515e44d`
- Parent tree: `58173f083241014729ea6ed8ddf49691bc142536`
- Role: Contract & Test Designer; tests/docs only, no production, dependency or
  migration changes.

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
Test Files  3 failed (3)
Tests       17 failed | 1 passed (18)
```

Expected semantic reasons:

- wallet challenge/session/account/token schemas are not exported;
- `apps/api/src/wallet-auth.ts` does not exist;
- both public auth routes currently stop at the bearer guard with `401`;
- strict V1/caller-authority, exact-Origin and Request-level 8 KiB failures therefore also stop
  at `401` rather than their frozen `400`, `403` and `413` contracts;
- the one green test proves unrelated routes are still bearer-protected.

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

The 8 KiB test covers the Fetch `Request` boundary only; 023D owns a separate
pre-buffer Node stream limit RED. `npm run typecheck` and `git diff --check`
pass. PostgreSQL, Web, quotas,
coverage and the full release matrix are deliberately deferred to their owning
GREEN waves and candidate freeze.

The independently discovered timestamp-canonicalization and UTF-8 byte-limit
gaps are frozen separately in
[Slice 023A corrective RED](slice-023a-corrective-red-auth-canonicalization.md).
