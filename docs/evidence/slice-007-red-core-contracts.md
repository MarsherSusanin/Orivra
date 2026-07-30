# Slice 007 RED — core behavioral contracts

## Provenance

- Role: Slice 007 Contract & Test Designer (not a later verifier).
- Frozen base commit: `dbc126807b71b16a93ed24be68307dfafc7205de`.
- Scope: new test and evidence files only. Production, configuration, migrations,
  and previously frozen tests were not edited.

## Frozen contracts

1. A run can create at most one relayer transaction/spend, including after a
   different idempotency key, a terminal journal, and a new worker repository
   instance. PostgreSQL must enforce unique relayer identity by `run_id`.
2. Exhausted/terminal work is represented by a strict versioned `RUN_FAILED`
   event. Projection rebuilds its failed stage and evidence from the journal,
   and later lifecycle mutations are rejected.
3. Wallet submission before durable preflight evidence raises stable public
   code `PREFLIGHT_NOT_READY`. The API preserves the code and the production CLI
   performs its bounded retry rather than treating the first 404 as final.
4. The safe-fetch deadline starts before DNS and aborts a stalled lookup. The
   DA request also has an aborting deadline and reports a normalized timeout.
5. Public Web2Json query names reject `access_token`, `client_secret`,
   `password`, `X-Amz-Credential`, and `X-Amz-Signature`.
6. Solidity URL enforcement rejects duplicate expected query keys in either
   ordering, even when one value matches.
7. A real PostgreSQL instance demonstrates create-run idempotency/conflict,
   expired-lease reclaim after a repository restart, and durable event/artifact
   resume. It also exposes the missing per-run relayer uniqueness constraint.

## Hermetic RED evidence

Command:

```text
npx vitest run apps/worker/test/slice007-run-invariants.contract.test.ts packages/contracts/test/slice007-terminal-failure.contract.test.ts apps/api/test/slice007-terminal-readiness.contract.test.ts packages/fdc-coston2/test/slice007-network-security.contract.test.ts contracts/test/slice007-duplicate-query-evm.contract.test.ts --reporter=verbose
```

Result: **23 failed, 2 passed** across five files. All failures are behavioral;
the suite transformed and imported every target successfully.

| Contract area | RED count | Expected current behavior observed |
|---|---:|---|
| Relayer/worker invariants | 4 | second key and terminal run still sign; schema lacks `UNIQUE(run_id)`; unknown command lacks terminal evidence |
| Terminal event/projection | 3 | `RUN_FAILED` is absent from the event discriminator, cannot rebuild, and therefore cannot enforce post-failure immutability |
| API terminal/readiness | 7 | five terminal mutations still resolve; service omits `PREFLIGHT_NOT_READY`; API/CLI path converts it into a final request failure |
| DNS/DA/credential security | 7 | DNS hangs beyond its deadline; DA ignores the requested deadline; five credential-name variants are accepted |
| Solidity query cardinality | 2 | both duplicate-key orderings execute successfully instead of reverting |

Positive hermetic controls passed:

- ordinary public query names remain accepted;
- exactly one matching Solidity query pair succeeds in a real offline EVM.

## Real PostgreSQL RED evidence

Command (with local Docker runtime access):

```text
PROOFLINE_TESTCONTAINERS=1 npx vitest run apps/api/test/postgres/testcontainers-command-integrity.contract.test.ts --reporter=verbose
```

Result: **1 failed, 2 passed** against `postgres:16-alpine`.

- RED: a second distinct relayer transaction for the same run inserts
  successfully; the expected SQLSTATE `23505` is absent.
- PASS control: repeated identical `createRun` returns the same run and a
  conflicting manifest maps to status 409.
- PASS control: a fresh repository reclaims an expired lease at attempt 2,
  completes it, and another fresh repository reloads ordered events,
  projection, and byte-identical immutable evidence.

Combined Slice 007 core contract result: **24 semantic RED, 4 PASS controls**.

## Compile control

```text
npm run typecheck
```

Result: **PASS** (`tsc --noEmit`). This rules out missing imports and TypeScript
fixture errors as the cause of RED.
