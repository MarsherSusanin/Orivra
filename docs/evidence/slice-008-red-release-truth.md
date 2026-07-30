# Slice 008 RED — release truth and hermetic PR

## Frozen baseline

- Production commit: `c192ed2a6f7a35ac4e0685833559bbbe452cab56`
- Production tree: `94d0726644131b810f4161eedd5c652c1d31e15f`
- Slice Contract/ADR documentation commit: `a912713`
- Core RED commit: `e6470f5c8b327b15047729774c6569818c7a69fc`
- Product RED commit: `f334c306ddaec9ec997f873c3a69ebbc8e56de88`

Only new contract, migration, acceptance tests and this evidence document were
added. Production sources, package manifests and existing tests were not
changed.

## RED matrix

| Contract | Expected production gap | RED count |
|---|---|---:|
| API diagnostic truth | latest versioned diagnostic and durable attempt count are absent; missing evidence does not fail closed | 2 |
| Core consumer ownership | proof verification silently schedules default safe consumer; invalid failed result is journaled | 2 |
| Relayer crash boundary | broadcast happens before a durable attempt and repeats after a simulated post-RPC crash | 1 |
| Credential variants | six separator/case/version variants are accepted in URL and manifest query sources | 12 |
| Worst-case gas reserve | gas cost and invalid/missing price/limit evidence are ignored | 5 |
| PostgreSQL migration | no independent broadcast-attempt timestamp/audit/grant | 1 |
| Web surface | sends `{}`, maps missing evidence to `CONSUMER_VERIFIED`, drops diagnostic version | 3 |
| Pull-request Action | API credentials required, bundle replay uses API, manifest mismatch is not locally checked | 2 |
| Merge Action | canonical-safe consumer intent is not submitted by the surface | 1 |
| Action entry | eager dependency construction escapes the error boundary | 1 |
| CLI help | six unit and six packaged help invocations require runtime configuration or exit non-zero | 12 |
| **Total hermetic RED** |  | **42** |

The combined focused command reported `42 failed | 2 passed | 1 skipped`.
The two passes are positive query/gas controls. The skipped test is the
opt-in real-PostgreSQL contract, which was run separately.

## Commands and evidence

Hermetic Slice 008 matrix:

```text
npm test -- --maxWorkers=1 --reporter=dot \
  packages/fdc-coston2/test/slice008-release-security.contract.test.ts \
  apps/worker/test/slice008-release-truth.contract.test.ts \
  apps/api/test/slice008-release-truth.contract.test.ts \
  apps/api/test/postgres/slice008-broadcast-attempt-migration.contract.test.ts \
  apps/api/test/postgres/slice008-terminal-products.contract.test.ts \
  src/slice008-release-truth.contract.test.ts \
  packages/action/test/slice008-hermetic-pr.contract.test.ts \
  packages/cli/test/slice008-offline-help.contract.test.ts
```

Result: `7 failed | 1 skipped` files; `42 failed | 2 passed | 1 skipped`
tests. Every failure is the frozen semantic mismatch described above.

Real PostgreSQL terminal contract:

```text
PROOFLINE_TESTCONTAINERS=1 npm test -- --maxWorkers=1 --reporter=dot \
  apps/api/test/postgres/slice008-terminal-products.contract.test.ts
```

Result: `1 failed`. A real `postgres:16-alpine` container reproduced the
ordering bug: exact idempotent read-back is rejected by `RUN_TERMINAL` before
intent lookup. The remaining codegen/share assertions are deliberately after
that first boundary and will become observable as the core writer advances the
implementation.

Type contract:

```text
npm run typecheck
```

Result: PASS.

Unchanged core controls:

```text
npm test -- --maxWorkers=1 --reporter=dot \
  packages/fdc-coston2/test/preflight.test.ts \
  packages/fdc-coston2/test/relayer.test.ts \
  apps/worker/test/slice007-release-graph-coverage.test.ts \
  apps/api/test/slice007-terminal-readiness.contract.test.ts \
  apps/api/test/postgres/migration-static.test.ts
```

Result: `5 passed` files; `51 passed` tests.

Unchanged product controls:

```text
npm test -- --maxWorkers=1 --reporter=dot \
  src/services/run-surface.test.ts \
  packages/action/test/action-contract.test.ts \
  packages/action/test/persisted-release-path.contract.test.ts \
  packages/cli/test/cli-contract.test.ts
```

Result: `4 passed` files; `26 passed` tests.

## Handoff constraints

- These Slice 008 tests are frozen acceptance contracts.
- Core and surface production authors must be different from both final
  verifiers.
- Consumer intent remains owned by Web, CLI or Action; the worker must not
  silently choose it.
- The two-invocation crash reproduction must become green without adding a
  second broadcast path.
- Real PostgreSQL, packaged CLI and Action entry tests are release gates, not
  optional unit substitutes.
