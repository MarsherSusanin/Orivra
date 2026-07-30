# Slice 003 RED evidence — production pipeline wave A

## Baseline

- Parent commit: `0d4bd7fdbf7e111f9c1e5cb0baeb695e989f402d`
- Scope: tests and RED evidence only; no production source changed.
- External dependencies: none. No live Coston2, public network, Docker, or
  Testcontainers execution is part of this wave.

## Frozen contracts

- Production worker exports a concrete handler registry covering every reachable
  command in the Slice 003 graph.
- Fixture ports must produce the seven ordered public lifecycle events. A consumer
  invariant is a terminal `CONSUMER_VERIFIED` result with `passed: false`, not a
  retryable worker failure.
- Relayer preparation persists one signed transaction identity before broadcast,
  recovery never signs a replacement, and an existing broadcast marker prevents
  another broadcaster call.
- Wallet submission synchronously returns the exact unsigned transaction derived
  from persisted preflight evidence; no orphaned `SUBMIT_WALLET` command is used.
- Submission and share mutations verify project/run ownership. An idempotency key
  cannot silently change its run or command intent.
- PostgreSQL loads one persisted execution context, renews only a current lease,
  and commits events/artifacts/deduplicated child commands plus lease completion
  atomically.
- Proof-bundle assembly selects only the persisted journal and typed evidence,
  writes canonical replay bytes, and excludes authorization and signed material.

## Focused RED command

```text
npx vitest run \
  apps/worker/test/production-command-pipeline.contract.test.ts \
  apps/worker/test/persisted-bundle-assembler.contract.test.ts \
  apps/api/test/production-service-pipeline.contract.test.ts \
  apps/api/test/postgres/persisted-command-outcome.contract.test.ts \
  --reporter=verbose
```

Observed result: **4 files failed, 13 tests failed, 0 tests passed** for the
expected missing production behavior:

1. `createProductionCommandHandlers` is not exported and no production handler
   registry exists.
2. `assemblePersistedProofBundle` is not exported.
3. Wallet submission returns only `{ accepted, runId }`.
4. Foreign-project submission and share creation are accepted.
5. Conflicting submission intent silently resolves through `ON CONFLICT DO
   NOTHING`.
6. `loadRunExecutionContext` and `renewLease` are absent.
7. `completeCommand` ignores `nextCommands`, so child scheduling is neither
   persisted nor rolled back with stale completion.

These are semantic RED assertions. The files collect and execute normally; no
failure is caused by an unresolved import or a TypeScript compile error.

## Compile gate

```text
npm run typecheck
```

Observed result: **PASS**.

