# Slice 017 corrective RED — zero relayer quota

## Frozen rejected candidate

- Parent commit: `74f096620aa42b20ea2d8a48409f80e647bea673`
- Parent tree: `9f33a048a5b94344acd75c70a1e75865116beb90`
- Scope: worker tests and this evidence record only; production sources,
  schemas, migrations and release artifacts are unchanged.

This wave converts the P1 verifier finding into a composed behavioral contract.
Persisted `quotaRemaining: 0` is valid policy evidence. It is a policy outcome,
not corrupt evidence, and must reach `validateRelayerSubmission` so the worker
records the stable terminal `RELAYER_QUOTA_EXHAUSTED` result.

## Focused RED

Command:

```text
npx vitest run \
  apps/worker/test/live-runtime-ports-coverage.test.ts \
  --reporter=verbose
```

Observed result:

```text
Test Files  1 failed (1)
Tests       2 failed | 21 passed (23)
```

Both failures are intentional and have the same production cause:

- the live relayer-policy parser rejects zero before the domain validator and
  returns `schema-invalid / RELAYER_POLICY_EVIDENCE_INVALID`;
- the composed path `loadRelayerPolicy → persisted artifact → production
  handler → live ports → validator` therefore records the same incorrect code
  instead of `configuration / RELAYER_QUOTA_EXHAUSTED`.

The green discriminators prove that negative, noninteger and malformed quota
evidence still fails closed as `RELAYER_POLICY_EVIDENCE_INVALID`, positive quota
still signs and persists the next broadcast command, and zero-quota processing
performs neither wallet signing nor raw transaction broadcast.

## Nearest unchanged controls

Command:

```text
npx vitest run \
  packages/fdc-coston2/test/relayer.test.ts \
  packages/fdc-coston2/test/slice017-relayer-policy-errors.contract.test.ts \
  apps/worker/test/slice017-explicit-confirmation.contract.test.ts \
  apps/api/test/postgres/slice007-terminal-repository-coverage.test.ts \
  --reporter=dot
```

Observed result:

```text
Test Files  4 passed (4)
Tests       55 passed (55)
```

`npm run typecheck` and `git diff --check` pass. No full suite, coverage run,
real PostgreSQL container or live network gate was run in this RED wave.

## Frozen implementation contract

The production live parser must accept integer `quotaRemaining >= 0` while
continuing to reject negative, noninteger and malformed values. Zero must reach
the unchanged relayer validator and become a non-retryable terminal
`RELAYER_QUOTA_EXHAUSTED` failure before signing, persistence or broadcast.
