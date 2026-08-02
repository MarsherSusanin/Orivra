# Slice 017 corrective RED — wallet rebroadcast and replay failure stage

## Frozen rejected candidate

- Parent commit: `04d7040879e7c4187f4c150a2dddaf813ed5f69c`
- Parent tree: `8b48081f76c483b25725825eff31911ebbde8fff`
- Scope: tests and this evidence record only; production sources, schemas,
  migrations, package manifests and release artifacts are unchanged.

This wave freezes the final verifier findings around persisted wallet authority,
ambiguous provider results and replay failure projection. It does not rerun the
full repository matrix.

## Focused RED

Command:

```text
npx vitest run \
  src/slice017-submission-decision.contract.test.tsx \
  apps/api/test/slice017-explicit-submission.contract.test.ts \
  src/services/slice017-wallet-recovery.contract.test.ts \
  apps/api/test/postgres/slice007-terminal-repository-coverage.test.ts \
  --reporter=dot
```

Observed result after freezing the contracts:

```text
Test Files  4 failed (4)
Tests       6 failed | 63 passed (69)
```

The six failures are intentional and semantic:

- A hydrated nonterminal wallet run already at `Request: Submitted` still
  renders an enabled `Confirm wallet submission` action. Persisted transaction
  evidence is visible, so this is specifically a rebroadcast-authority error.
- Production `createSubmission(wallet)` returns a fresh unsigned transaction
  after a noncancelled `ATTACH_WALLET_TRANSACTION` authority survives restart,
  and also when the persisted projection already proves request completion.
- A successful `eth_sendTransaction` call returning a malformed hash clears
  `wallet-broadcast-pending`; the next invocation could therefore broadcast
  again instead of failing closed as ambiguous.
- PostgreSQL maps `APPLY_REPLAY_EVIDENCE` terminal failure to `preflight` in
  both the command mapping and a composed journal/projection path. The correct
  stage is `request`, preserving completed preflight evidence.

Green discriminators in the same files preserve exact wallet-attachment
idempotency with one command, numeric EIP-1193 `4001` retryability, non-`4001`
ambiguous failure behavior, every other command-stage mapping, and prior
wallet/relayer/replay confirmation contracts.

## Nearest unchanged controls

Command:

```text
npx vitest run \
  src/services/run-hydration.test.ts \
  src/services/run-client-hardening.test.ts \
  apps/api/test/slice017-submission-race-addendum.contract.test.ts \
  apps/worker/test/slice017-explicit-confirmation.contract.test.ts \
  --reporter=dot
```

Observed result:

```text
Test Files  4 passed (4)
Tests       44 passed (44)
```

`npm run typecheck` and `git diff --check` pass. No full suite, coverage run,
real PostgreSQL container, browser visual pass or live network gate was run.

## Frozen implementation contract

Once wallet submission authority or `REQUEST_SUBMITTED` evidence exists, Web
hydration and API reload must expose the submitted state without creating a new
wallet intent. Exact attachment retry remains idempotently accepted; competing
unsigned-transaction preparation fails with stable HTTP `409` and
`SUBMISSION_INTENT_CONFLICT` before returning transaction data.

Malformed successful provider results retain the pending recovery marker,
never attach, and make subsequent invocation fail ambiguous without provider
I/O. EIP-1193 `4001` remains the sole explicit rejection path that clears the
pending marker.

`APPLY_REPLAY_EVIDENCE` terminal failures map to `request`; the resulting
`RUN_FAILED` projection keeps preflight `completed` and marks request `failed`.
