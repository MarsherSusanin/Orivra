# Slice 004 RED evidence — production coverage seams

Candidate baseline: `9e4a2b7`.

This RED wave freezes four hermetic public seams before production refactoring:

1. Live Coston2 ports accept explicit RPC, DA, DNS, HTTPS, JQ, and clock adapters; the live gate reuses that staged pipeline instead of maintaining a second lifecycle.
2. Worker composition and the idle loop are exported, dependency-injected, and testable without real process signals or timers.
3. CLI production API, wallet, clock, filesystem, and I/O dependencies are constructed from explicit inputs; user private keys stay local.
4. GitHub Action replay, live, artifact, environment, and failure-boundary dependencies are constructed from explicit inputs.

The coverage contract additionally requires production service/bootstrap modules to be included and permits exclusions only for four exact thin invocation shims. Thresholds remain 90% lines and 85% branches.

Expected RED causes on the baseline:

- live port/runtime factories ignore injected adapters and the live gate retains a duplicate direct RPC lifecycle;
- `apps/worker/src/bootstrap.ts` does not exist;
- `createProductionCliDependencies` is not public or injectable;
- `packages/action/src/runtime.ts` does not exist;
- backend coverage omits the production API service/bootstrap and has no exact shim exclusion list.

No test in this wave may access live Coston2, mutate process signals, or wait on real time.

## Captured RED run

Command:

```text
npx vitest run apps/worker/test/live-runtime-adapter.contract.test.ts apps/worker/test/production-bootstrap.contract.test.ts packages/cli/test/production-adapter.contract.test.ts packages/action/test/production-adapter.contract.test.ts --reporter=verbose
```

Result: **4 failed files, 9 expected failed tests**.

- The existing port factory ignored all injected client factories.
- The existing live runtime attempted its duplicate direct RPC path; the test-local `fetch` guard rejected it before any live network access.
- Worker bootstrap and Action runtime dynamic imports failed because the production modules do not exist yet.
- The CLI module did not export `createProductionCliDependencies`.
- The backend coverage configuration omitted the explicit production service/bootstrap entries and exact shim exclusions.

Production typecheck control:

```text
npm run typecheck
```

Result: **PASS**.
