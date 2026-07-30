# Slice 002 remediation RED evidence

Base commit: `f02e821` (`docs: define verifier remediation slice`).

The existing production and test tree was frozen before this wave. The pre-existing
untracked replay semantic contract at
`packages/domain/test/replay-semantic-integrity.contract.test.ts` was preserved and
was not edited or staged by this role.

## Baseline

Command:

```text
npx vitest run --exclude='**/verifier-remediation.contract.test.ts' --exclude='tests/production-surfaces.contract.test.ts' --exclude='src/production-run-surface.contract.test.tsx' --exclude='packages/domain/test/replay-semantic-integrity.contract.test.ts'
```

Result: **GREEN** — 33 files passed, 1 skipped; 347 tests passed, 1 skipped.

## Frozen RED contracts

- `packages/fdc-coston2/test/verifier-remediation.contract.test.ts`
  - alternate IPv6/IPv4 SSRF representations;
  - a caller-owned deadline even when dispatch ignores `AbortSignal`;
  - one canonical URL for sampling and verifier preparation;
  - non-negative, manifest-capped fee quotes for wallet and relayer modes;
  - relayer command-fingerprint binding and recovery-broadcast audit.
- `apps/api/test/verifier-remediation.contract.test.ts`
  - expired lease reclaim through `FOR UPDATE SKIP LOCKED`;
  - stale/expired completion and retry rejection;
  - strict endpoint-specific bodies with signing material rejected;
  - explicit least-privilege worker grants.
- `tests/production-surfaces.contract.test.ts`
  - concrete `createLiveCoston2Runtime` and default live-gate composition;
  - clean runnable API, worker, CLI, and Action package artifacts;
  - complete Action commit/tree/no-rebroadcast evidence.
- `src/production-run-surface.contract.test.tsx`
  - deep-run routing, API hydration, terminal failure rendering, and session-only
    project-token onboarding.

Focused commands:

```text
npx vitest run packages/fdc-coston2/test/verifier-remediation.contract.test.ts apps/api/test/verifier-remediation.contract.test.ts src/production-run-surface.contract.test.tsx
npx vitest run tests/production-surfaces.contract.test.ts --reporter=verbose
```

Result: **RED for the expected production gaps**.

- Adapter/API/Web: 19 failed, 3 passed. Failures identify missing IPv6
  canonicalization, non-cooperative timeout enforcement, canonical verifier URL,
  fee envelope, relayer fingerprint/recovery audit, lease reclaim/staleness,
  strict API schemas, least privilege, deep route/hydration, terminal failure, and
  token onboarding.
- Production surfaces: 8 failed. Failures identify the absent live runtime module,
  absent default runtime factory, missing package build/start metadata/artifacts,
  and incomplete Action release evidence.

The three currently passing remediation assertions are controls: one alternate IPv6
representation and a private-key-named body are already rejected, while a valid
transaction-hash-only API body is already accepted.
