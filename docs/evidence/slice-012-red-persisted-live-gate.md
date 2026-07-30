# Slice 012 RED — one persisted live acceptance gate

## Frozen baseline

- Commit: `ae1f0fc75cbf3f1d9639077a17f643602598cef8`
- Tree: `852503c9c9b01c47b24d23259e6299b921b3f362`
- Contract: `docs/slices/012-persisted-live-acceptance.md`
- ADR: `docs/adr/0012-one-persisted-live-gate.md`

This RED wave adds only the Slice 012 contract test and this evidence file. No
production source or package script was changed.

## Focused RED

Command:

```text
npm test -- --run tests/slice012-persisted-live-gate.contract.test.ts --reporter=dot
```

Exact summary:

```text
xxx··

Test Files  1 failed (1)
     Tests  3 failed | 2 passed (5)
Duration  345ms
EXIT_CODE=1
```

The three expected semantic failures prove that the existing candidate still:

1. imports `runLiveCoston2Gate` from `apps/worker/src/live-gate` instead of
   constructing `createPersistedActionRunClient` for the documented
   `npm run test:live:coston2` path;
2. omits `PROOFLINE_API_URL`, `GITHUB_SHA`, and `PROOFLINE_TREE_HASH` from the
   runner gate while accepting `PROOFLINE_COSTON2_PRIVATE_KEY` and
   `PROOFLINE_VERIFIER_API_KEY` in the runner process;
3. retains `apps/worker/src/live-gate.ts`,
   `apps/worker/src/live-gate-runtime.ts`, the obsolete hardening test, and
   stale consumers. The static documented-release import graph reaches all
   three direct-gate files.

Representative exact assertions:

```text
the documented live runner must construct the production persisted client:
expected false to be true

PROOFLINE_API_URL must gate the documented live runner:
expected false to be true

PROOFLINE_COSTON2_PRIVATE_KEY belongs only to the deployed worker:
expected true to be false

apps/worker/src/live-gate.ts must be deleted:
expected true to be false

expected [
  "tests/live/coston2.live.test.ts",
  "apps/worker/src/live-gate.ts",
  "apps/worker/src/live-gate-runtime.ts"
] to deeply equal []
```

No live network operation was attempted. Missing live configuration remains an
external blocker and is not replaced by hermetic evidence.

## Persisted Action positive controls

Command:

```text
npm test -- --run tests/slice012-persisted-live-gate.contract.test.ts -t "Slice 012 persisted evidence controls" --reporter=dot
```

Exact result:

```text
---··

Test Files  1 passed (1)
     Tests  2 passed | 3 skipped (5)
Duration  287ms
EXIT_CODE=0
```

These controls exercise `createPersistedActionRunClient` behaviorally through a
mock HTTP API. They prove:

- create, relayer submission, proof-boundary polling, canonical-safe consumer
  verification, terminal polling, bundle export, and replay use the persisted
  API surface;
- published `persistedRun` has the same `runId` and positive final sequence;
- the exact exported bundle string is sent to `/v1/replays` and must return
  `byteIdentical: true`;
- `broadcastCountAfterRecordedHash` is read from the final projection: `0` is
  accepted, while a projection value of `2` is preserved and rejected by the
  release gate. This prevents a runner-side constant from satisfying the gate.

## Type safety

Command and exact result:

```text
npm run typecheck

> proofline@0.0.0 typecheck
> tsc --noEmit

EXIT_CODE=0
```

The expected RED is therefore limited to the three frozen Slice 012 release
semantics; the already-implemented persisted client controls and type system are
green.
