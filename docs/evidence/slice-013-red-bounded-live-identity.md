# Slice 013 RED evidence — bounded live deadline and candidate identity

## Frozen candidate

- Parent commit: `6d3e7e53812cfc3bc12be3dd7e07489102d5b930`
- Parent tree: `da672d0547d53c88491a883e3ef6daf927262e40`
- Contract: `tests/slice013-bounded-live-identity.contract.test.ts`
- Production and package sources changed in this RED wave: none

## Behavioral contract

The frozen test exercises public behavior rather than implementation shape:

1. A never-settling HTTP request receives an abort deadline and becomes the
   stable non-retryable `RELEASE_GATE_TIMEOUT` after fake time advances.
2. Run creation, relayer readiness, proof projection, consumer verification,
   terminal projection, bundle export, and replay consume one injected-clock
   budget. When bundle export reaches the absolute deadline, replay is not
   requested.
3. A timeout outside `1..600000` and a malformed 40-hex commit/tree identity
   fail before the first HTTP request.
4. The Action rejects malformed or environment-mismatched result identity and
   does not upload an artifact.
5. An exact valid 40-hex pair remains accepted, and the hermetic PR replay path
   remains independent of live identity.

No real clock wait or external network is used.

## Expected RED

Command:

```text
npx vitest run tests/slice013-bounded-live-identity.contract.test.ts tests/slice012-persisted-live-gate.contract.test.ts --reporter=verbose
```

Observed result:

```text
Test Files  1 failed | 1 passed (2)
Tests       13 failed | 7 passed (20)
```

The failures are semantic and match the Slice 013 trigger:

- hung fetch remained `pending` after the deadline;
- the cumulative fixture resolved and issued replay after the shared budget;
- timeout values `0`, `-1`, and `600001` reached `fetch`;
- four malformed commit/tree variants reached `fetch`;
- four malformed or mismatched Action result identities returned success and
  were eligible for upload.

The two Slice 013 controls were GREEN: the exact valid identity pair uploaded
once, and local PR replay stayed GREEN. All five frozen Slice 012 tests remained
GREEN, demonstrating that the new RED does not rewrite the prior contract.

## Static gate

Command:

```text
npm run typecheck
```

Observed result: PASS (`tsc --noEmit`). `git diff --check` also passed.
