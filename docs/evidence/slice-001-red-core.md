# Slice 001 RED evidence — contracts and pure domain

Recorded against baseline `8d49ac4` on 2026-07-30.

## Frozen RED scope

- Versioned Zod wire schemas for `Web2JsonManifestV1`, `RunEventV1`, `RunProjectionV1`, `DiagnosticV1`, `ProofBundleV1`, and `NormalizedFdcError`.
- Safe-GET manifest validation plus deterministic URL canonicalization.
- Strict append-only sequencing, command idempotency, conflicting-key rejection, monotonic six-stage projection, and terminal-state rejection.
- Stable consumer diagnostics for scheme, normalized host, path-prefix boundary, and expected query values.
- Canonical JSON, SHA-256 proof bundles, deterministic replay, secret rejection, and mutation detection.
- Reviewed Solidity golden output that checks scheme, host, path, and query before registry-resolved `verifyWeb2Json`.
- `fast-check` properties for lifecycle ordering and proof-response mutation.

Production modules under `packages/contracts/src` and `packages/domain/src` are intentionally absent in this wave. No production implementation was added.

## Expected RED commands

```text
npm run test:contracts
npm run test:core
npm test
```

Observed primary failures:

```text
FAIL packages/contracts/test/public-contracts.test.ts
Error: Cannot find module '../src/index'

FAIL packages/domain/test/bundle-replay.test.ts
FAIL packages/domain/test/codegen.test.ts
FAIL packages/domain/test/diagnostics.test.ts
FAIL packages/domain/test/run-lifecycle.test.ts
Error: Cannot find module '../src/index'
```

The missing-module failures are the intended RED boundary: the tests name the public exports that the Core Implementer must supply. The full run reports `5 failed | 1 passed` test files; the existing cockpit suite remains green with `3 passed` tests.

## Harness evidence

- `npm install` completes with the two workspace packages linked.
- `npx vitest run src/App.test.tsx` passes all three pre-existing UI tests.
- Vitest transforms every new test file before failing at the deliberate missing production entrypoints.
- Coverage is configured through V8 and exposed as `npm run test:coverage`; thresholds are applied by later GREEN verification once the production sources exist.

## Contract freeze

The tests, fixtures, manifest shape, event vocabulary, stable diagnostic/error codes, bundle envelope, public function names, and Solidity golden file are frozen for the GREEN core wave. Changes require a new Contract/Test Designer wave and replacement RED evidence.
