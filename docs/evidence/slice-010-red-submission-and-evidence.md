# Slice 010 RED — one submission and complete evidence

## Frozen baseline

- Production commit: `2b3a03ecf3930e666d461e603dae6e2e6efb9b8e`
- Production tree: `4081a262817e7f77b66ca8f441c70843476dd433`
- Contract: `docs/slices/010-one-submission-and-complete-evidence.md`
- Decision: `docs/adr/0010-manifest-owned-submission-and-evidence-ui.md`

This wave adds only new API, worker, migration, Web, and mobile contract tests
plus this evidence document. Production sources, package manifests, migrations,
and all previously frozen tests are unchanged.

## Focused hermetic RED

```text
npm test -- --maxWorkers=1 --reporter=dot \
  apps/api/test/slice010-submission-mode.contract.test.ts \
  apps/worker/test/slice010-submission-mode-defense.contract.test.ts \
  src/slice010-diagnostic-evidence.contract.test.ts \
  src/slice010-mobile-footer-children.contract.test.ts \
  apps/api/test/postgres/slice010-one-submission-migration.contract.test.ts

Test Files  5 failed (5)
Tests       15 failed | 2 passed | 3 skipped (20)
```

The fifteen failures are semantic:

- API accepts five forbidden mode combinations: wallet-to-relayer, relayer
  wallet attachment, and all three live wallet/relayer operations on replay.
- Worker executes four mismatched persisted commands; relayer paths reach the
  signer and wallet paths reach transaction observation instead of failing with
  `SUBMISSION_MODE_MISMATCH` before I/O.
- Consumer Lab ignores `evidence.missingChecks`, so one diagnostic containing
  `scheme`, `host`, `path`, and `query` renders all four invariants as passed.
- The mobile structural contract fails all three required states: initial and
  hydrated retry reserve 68px where at least 74px is required; bundle-verified
  reserves 76px where the full wrapped guidance copy requires at least 99px.
- No additive `002_*.sql` migration owns the cross-kind command invariant or
  fail-closed legacy-data check.

The two passing controls are exact selected-path idempotent retries for wallet
and relayer. The three skipped tests are the explicit Testcontainers opt-in.

## Real PostgreSQL RED

With local Docker access enabled, the same migration file was run against
PostgreSQL 16:

```text
DOCKER_HOST=unix:///Users/ivanradaev/.docker/run/docker.sock \
PROOFLINE_TESTCONTAINERS=1 npm test -- --maxWorkers=1 --reporter=dot \
  apps/api/test/postgres/slice010-one-submission-migration.contract.test.ts

Test Files  1 failed (1)
Tests       4 failed | 1 passed (5)
```

Both static migration contracts fail. More importantly, both competing inserts
commit on the real database, and reapplying the current migration to legacy
dual-path rows succeeds instead of failing closed. Cancelled history followed by
one active wallet command is the green database discriminator.

## Chromium geometry evidence

The production UI was opened in Chromium at 390×844. Every `.action-footer`
child was measured against fixed navigation at `y=776`:

| State | Child | Bottom | Gap to navigation | Result |
|---|---|---:|---:|---|
| Initial | Full next-step sentence | 774 | 2px | RED |
| Initial | Export bundle | 755 | 21px | PASS |
| Hydrated retry | Full next-step sentence | 774 | 2px | RED |
| Hydrated retry | Export bundle | 755 | 21px | PASS |
| Bundle verified | Full next-step sentence | 791 | -15px | RED |
| Bundle verified | Bundle verified | 755 | 21px | PASS |

The required clearance is at least 8px for every child. The bundle state is the
worst case because the secondary link leaves less width and the complete sentence
wraps to 68px height. Browser console evidence contained zero errors and zero
warnings, so the failure is geometric rather than a runtime fallback.

## Green controls

```text
npm test -- --maxWorkers=1 --reporter=dot \
  apps/api/test/production-service-coverage.test.ts \
  apps/worker/test/slice007-release-graph-coverage.test.ts \
  src/services/run-surface.test.ts \
  src/mobile-safe-area.contract.test.ts \
  src/slice007-mobile-reserve.contract.test.ts \
  apps/api/test/postgres/migration-static.test.ts

Test Files  6 passed (6)
Tests       49 passed (49)
```

`npm run typecheck` passes.

## Frozen handoff

- Do not weaken `SUBMISSION_MODE_MISMATCH`, pre-insert/pre-I/O assertions, exact
  retry controls, known missing-check allowlist, full mobile copy, or real-PG
  concurrency assertions.
- The database invariant spans both command kinds per run while excluding only
  `status = 'cancelled'`; per-kind uniqueness is insufficient.
- The final mobile gate must repeat the Chromium inequality for every footer
  child in all three states: `child.bottom + 8 <= navigation.top`.

## Superseded-control reconciliation

The frozen production candidate for reconciliation was:

- Commit: `1c9391150ed09625213aa1d3beeeef3b06c35594`
- Tree: `9810589deff5058c8445cb3d45d44131a4c38e4d`

The production candidate satisfied the frozen Slice 010 contracts, while seven
pre-existing controls still encoded the superseded dual-authority or 68px-only
assumption. The reconciliation changes tests only:

- API SQL mocks now return each persisted manifest;
- relayer API fixtures persist relayer manifests, while wallet attachment uses a
  distinct wallet run instead of constructing both submission paths on one run;
- worker relayer fixtures keep the `RUN_CREATED` payload and loaded execution
  context on the same relayer manifest;
- replay, wallet, and relayer worker fixtures select only their authorized path;
- the original mobile safe-area control derives its reserve from fixed navigation
  plus the eight-pixel ADR 0010 clearance instead of requiring the obsolete
  literal `68px`.

No frozen Slice 010 test, production source, migration, package manifest, or build
artifact changed.

Affected controls:

```text
Test Files  7 passed (7)
Tests       50 passed (50)
```

Frozen Slice 010:

```text
Test Files  5 passed (5)
Tests       17 passed | 3 skipped (20)
```

The three skips remain the explicit Testcontainers opt-in for the root real-PG
gate.

Full hermetic suite:

```text
Test Files  93 passed | 4 skipped (97)
Tests       759 passed | 9 skipped (768)
```

`npm run typecheck` — PASS.
