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
