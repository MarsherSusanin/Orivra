# Slice 005 RED evidence — product/runtime wave B

## Baseline

- Parent commit: `c16e268e7491293c70fd7201e87e55720e93d778`.
- Scope: new contract tests and this RED evidence only. Production source,
  configuration, and previously frozen tests are unchanged.
- Network: hermetic. Package artifacts execute as child Node processes; API
  behavior uses injected `fetch` responses only.

## Frozen product contracts

- A clean-built worker artifact must reach the expected missing-`DATABASE_URL`
  fail-fast under Node 22, never an esbuild dynamic-require failure.
- The clean-built Action artifact must execute its declared node20-targeted
  contract and reach a controlled Proofline failure, never a dynamic
  `require("os")` failure.
- `run create --mode relayer` creates the run and then requests its submission.
  Wallet submission retries transient preflight `404` responses, succeeds once
  evidence is durable, and bounds a permanently unavailable preflight to at most
  60 seconds of injected sleep.
- The production Action exposes an injectable
  `createPersistedActionRunClient`. Pull-request replay parses a
  `Web2JsonManifestV1`, creates and observes the API-backed run, exports its
  bundle, and verifies it through `/v1/replays`. PR and merge evidence must bind
  to the same persisted `runId` and positive journal sequence; mismatched
  synthetic identity fails closed.
- When async consumer verification resolves, focus moves to the meaningful
  result action. Escape then closes the dialog and restores the opening trigger.

The Action client factory is a deliberate new public seam. The previous opaque
callback allowed the entry point to pass manifest bytes to `replayProofBundle`
and allowed the live gate to return an in-memory-only identity, neither of which
could be proven API-backed.

## Focused RED command

```text
npx vitest run \
  tests/runtime-artifact-execution.contract.test.ts \
  packages/cli/test/submission-readiness.contract.test.ts \
  packages/action/test/persisted-release-path.contract.test.ts \
  src/VerificationDialog.async-focus.contract.test.tsx \
  --reporter=verbose
```

Observed result: **4 files failed, 11 tests failed**. Every failure is the
expected product behavior:

1. worker artifact stops at dynamic `require("node:assert")`;
2. Action artifact stops at dynamic `require("os")`;
3. relayer mode omits the submission call;
4. wallet mode treats the first preflight `404` as terminal;
5. the persisted Action replay/live client seam is absent;
6. PR and merge accept mismatched synthetic run identity;
7. completed verification leaves focus on `body`, so Escape no longer reaches
   the dialog.

There are no unresolved fixture imports, external requests, or real-time waits.

## Compile gate

```text
npm run typecheck
```

Observed result: **PASS**.

The pre-existing Docker/Testcontainers readiness failure remains a separate RED
contract and was not changed or re-timed in this wave.
