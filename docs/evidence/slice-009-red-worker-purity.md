# Slice 009 RED — production worker purity

## Frozen baseline

- Production commit: `f00445778ffe2222a2843b1025f8357950e657c9`
- Production tree: `6def7cc59f982e63848025c363d2d982a8314958`
- Contract: `docs/slices/009-production-worker-purity.md`
- Decision: `docs/adr/0009-no-test-custody-code-in-worker-artifact.md`

Only the frozen contract test and this evidence document are added. Production
sources, package manifests, prior tests, and all Slice 008 frozen contracts are
unchanged.

## Semantic RED

The exact production worker artifact was rebuilt before scanning:

```text
npm --workspace @proofline/worker run build
```

The build completed successfully and left the tracked artifact unchanged.

Contract command:

```text
npm test -- --maxWorkers=1 --reporter=verbose \
  apps/worker/test/slice009-production-worker-purity.contract.test.ts
```

Result: `2 failed | 2 passed`.

The source/import-graph failure reports all seven forbidden compatibility
markers:

```text
injectable createRuntime input
compatibility runtime composition
project token custody field
private key execution transport
wildcard private-key lookup
synthetic live command
legacy credential error
```

The built-artifact failure independently reports all seven shipped markers:

```text
project-token environment compatibility
projectToken execution field
privateKey execution field
wildcard private-key lookup
injectable compatibility runtime
synthetic live handler marker
legacy credential error
```

The two passing discriminator controls prove that the contract is not a broad
ban on private-key implementation code: it requires the exact internal
`PROOFLINE_COSTON2_PRIVATE_KEY` read in the persisted live pipeline and verifies
that the narrow `live-gate.ts` utility is outside the production import graph.

## Green baseline controls

```text
npm test -- --maxWorkers=1 --reporter=dot \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/live-runtime-ports-coverage.test.ts \
  apps/worker/test/production-command-pipeline.contract.test.ts \
  apps/worker/test/slice007-run-invariants.contract.test.ts \
  apps/worker/test/slice007-release-graph-coverage.test.ts \
  apps/worker/test/final-lifecycle-relayer.contract.test.ts
```

Result: `6 passed` files; `48 passed` tests.

## Frozen handoff

- Production must not weaken marker matching or remove the positive internal-key
  discriminator to obtain GREEN.
- Source graph and rebuilt artifact must both become green.
- Test-only live-gate utilities may remain, but cannot be reachable from
  `apps/worker/src/entry.ts` or `apps/worker/src/bootstrap.ts`.
- Any obsolete bootstrap-injection tests are reconciled only after the production
  candidate satisfies this frozen contract.

## Superseded-control reconciliation

The frozen production candidate was:

- Commit: `90d7d668a5b9906926f39884c21c462de3b96b7c`
- Tree: `bdff8e58e81adbeeeec68839725645d5ab21600c`

That candidate satisfied the frozen purity contract but left fourteen earlier
expectations tied to the deleted production injection seam. The reconciliation
changes only six pre-existing test files:

- production bootstrap now composes and asserts only repository and persisted
  pipeline ports;
- bootstrap coverage uses throwing credential getters to prove that neither a
  project token nor an execution private key is requested;
- `RUN_LIVE_COSTON2` is asserted to fail with `WORKER_HANDLER_MISSING`, including
  under `NODE_ENV=test`;
- the legacy orchestrator tests import `createLiveCoston2Runtime` only from the
  isolated `live-gate-runtime.ts` module and assert that `live-runtime.ts` does
  not export it;
- obsolete `createRuntime` mocks and production-bootstrap arguments are removed.

Affected controls:

```text
6 passed files
35 passed tests
```

Frozen Slice 008 and Slice 009 controls:

```text
8 passed | 1 skipped files
48 passed | 1 skipped tests
```

Type contract: `npm run typecheck` — PASS.

Full hermetic result:

```text
88 passed | 4 skipped files
742 passed | 6 skipped tests
```

There are no remaining hermetic failures. The skipped controls retain their
explicit external-runtime opt-in and are left for the root release gate.
