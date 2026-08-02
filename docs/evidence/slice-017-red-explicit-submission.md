# Slice 017 RED — explicit submission confirmation

## Frozen baseline

- Parent commit: `0728ba3bb87f54f5a3527b95fd61273edd3e3429`
- Parent tree: `d23989c845e80cdce982b4262c9de89d872f63f7`
- Slice Contract: `docs/slices/017-submission-decision-and-confirmation.md`
- ADR: `docs/adr/0018-explicit-submission-confirmation.md`

This wave adds tests and this evidence record only. Production sources,
migrations, CSS, package manifests and prior contracts are unchanged.

## Focused RED

The updated TDD cadence deliberately ran only the new Slice 017 tests and the
nearest unchanged Slice 016/submission controls. It did not run the full
repository matrix.

```text
npm run typecheck
PASS

npx vitest run \
  packages/contracts/test/slice017-submission-response.contract.test.ts \
  apps/api/test/slice017-explicit-submission.contract.test.ts \
  apps/worker/test/slice017-explicit-confirmation.contract.test.ts \
  packages/fdc-coston2/test/slice017-relayer-policy-errors.contract.test.ts \
  src/services/slice017-wallet-recovery.contract.test.ts \
  packages/cli/test/slice017-explicit-replay-confirmation.contract.test.ts \
  src/slice017-submission-decision.contract.test.tsx \
  apps/api/test/postgres/slice017-submission-authority-migration.contract.test.ts

Test Files  8 failed (8)
Tests       46 failed | 12 passed | 4 skipped (62)
```

The four skips are the explicit real-PostgreSQL opt-in. Their empty-chain,
previous-schema, idempotent reapply, one-authority and legacy-conflict cases are
frozen and must run with `PROOFLINE_TESTCONTAINERS=1` after migration 005
exists.

The 46 failures are semantic and expected:

- `WalletTransactionV1Schema` and strict `SubmissionResponseV1Schema` do not
  exist; the browser client still accepts legacy direct/nested and mismatched
  response identities.
- The HTTP test environment still permits omitted mode, rejects replay mode,
  and the production service returns unversioned wallet/relayer bodies.
- Replay confirmation cannot create `APPLY_REPLAY_EVIDENCE`; wallet preparation
  and wallet attachment do not uniformly require completed preflight; replay
  conflicts do not use the stable submission codes.
- `RUN_PREFLIGHT` still creates automatic relayer/replay children before user
  confirmation.
- `APPLY_REPLAY_EVIDENCE` lacks its final persisted replay-mode assertion, and
  wallet observation can replace the tx hash attached by the client.
- Relayer quota/global-cap/balance-floor failures are plain errors and become
  generic retry/exhaustion evidence instead of the stable non-retryable codes
  `RELAYER_QUOTA_EXHAUSTED`, `GLOBAL_FEE_CAP_EXCEEDED` and
  `BALANCE_FLOOR_VIOLATION`.
- Wallet recovery does not persist a valid broadcast hash before attachment, so
  reload would broadcast again. User rejection remains a green no-storage
  control.
- CLI replay run creation does not explicitly confirm persisted replay mode.
- Web still renders the intentional Slice 016 placeholder: it has no persisted
  decision region, immutable mode evidence, confirmation dedupe, safe error or
  explicit `SUBMISSION_REQUESTED` emission.
- Migration `005` does not exist, so replay is not part of the one-active-run
  submission-authority invariant.

One local replay path is already correctly pure: directly applying valid
persisted replay evidence uses no wallet, RPC, relayer or source-host port. That
test is a green discriminator and must stay green.

## Hermetic E2E RED

```text
npx vitest run --config vitest.e2e.config.ts \
  tests/e2e/slice017-explicit-replay.test.ts --reporter=dot

Test Files  1 failed (1)
Tests       1 failed (1)
```

The run reaches request/round/proof before `POST /submissions`; the frozen
expectation requires it to stop after completed preflight, then advance only
after one explicit replay confirmation. This exposes the alternate automatic
path in `apps/api/src/test-system.ts` without network access.

## Nearest unchanged GREEN controls

```text
Test Files  8 passed (8)
Tests       160 passed (160)
```

The controls cover public contracts, Slice 010 immutable submission authority,
Slice 016 worker preflight evidence, existing browser wallet hardening, CLI and
migration 004, plus the Slice 016B Preflight Workbench.

The existing hermetic replay baseline also remains green:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

`git diff --check` passes. There are no collection, type or test-harness
failures.

## Intentional reconciliation boundary

The following older controls encode the superseded automatic-child behavior and
must be reconciled only after the frozen Slice 017 contracts are green:

- `apps/worker/test/production-command-pipeline.contract.test.ts` expects
  `RUN_PREFLIGHT → SUBMIT_RELAYER`;
- `apps/worker/test/slice016-preflight-report.contract.test.ts` expects the
  accepted relayer child;
- `apps/worker/test/slice007-release-graph-coverage.test.ts` expects automatic
  replay application, including resumed preflight.

Do not reintroduce an automatic child to preserve those assertions. Update the
controls to insert the explicit submission boundary while preserving their
remaining lifecycle, replay and evidence checks.

Browser geometry, axe, console/network and desktop/mobile journeys remain the
Product Integration Verification gate after GREEN surfaces. RED freezes only
contractable DOM behavior and performs no visual implementation.
