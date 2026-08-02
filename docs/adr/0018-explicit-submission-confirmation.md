# ADR 0018 — Explicit submission confirmation

## Status

Accepted for Slice 017.

## Context

The manifest already owns an immutable `wallet`, `relayer`, or `replay` mode and
the API/worker reject mismatched effects. However `RUN_PREFLIGHT` currently
creates relayer and replay child commands automatically. A Web confirmation
surface would therefore be cosmetic: the effect may start before the user sees
it. Wallet submission has a second recovery gap: if the wallet returns a valid
transaction hash and API attachment fails, retrying the whole operation can ask
the wallet to broadcast again.

## Decision

Successful preflight persists evidence only. It never creates
`SUBMIT_RELAYER` or `APPLY_REPLAY_EVIDENCE`. One explicit project-authorized
`POST /v1/runs/:id/submissions` request confirms the immutable manifest mode:

- `wallet` returns a schema-validated unsigned Coston2 transaction and performs
  no external effect;
- `relayer` persists one `SUBMIT_RELAYER` command;
- `replay` persists one `APPLY_REPLAY_EVIDENCE` command and cannot touch RPC,
  wallet or relayer ports.

The response is a versioned discriminated public contract identifying the run,
mode and effect owner (`wallet`, `worker`, or `none`). Request mode must equal the
persisted manifest and preflight must be completed. Share access remains read
only. PostgreSQL extends the one-active-submission invariant to replay commands;
idempotent retries return the same accepted intent and conflicting mode, key or
payload fails closed.

Every final worker handler repeats the persisted-mode authorization. Replay
evidence cannot be applied to a wallet or relayer manifest even if an internal
caller injects the command. Wallet attachment requires completed preflight and
the transaction returned by the observation adapter must have the exact hash
that the project attached, in addition to matching chain, target, calldata and
value.

The Web derives decision evidence from the persisted `PreflightReportV1` and
hydrated manifest mode. It does not let the user switch mode on an existing run.
Changing mode starts a new Composer run. The confirmation shows Coston2 chain
114, registry-resolved `FdcHub`, request identity, fee/cap, signer, payer and
trust model before any effect.

For EIP-1193 wallet execution, the client stores a returned transaction hash in
session-scoped recovery state before API attachment. A retry or reload with that
hash attaches it first and never calls `eth_sendTransaction` again. User
rejection records no transaction or command and leaves confirmation retryable.
The API never receives a private key.

CLI and Action use the same persisted submission endpoint. Local PR replay stays
unchanged and network-free; persisted replay confirmation becomes explicit.

Relayer quota, global fee-cap and balance-floor rejections are stable,
non-retryable configuration failures. They cannot degrade into generic transport
retry and `COMMAND_RETRY_EXHAUSTED` evidence.

## Consequences

Slice 017 changes worker command creation and PostgreSQL submission uniqueness,
so migration, restart/idempotency and no-effect replay tests are mandatory.
Existing tests that expect automatic relayer/replay continuation after preflight
must be replaced only through an intentional RED reconciliation wave. Recovery
timers and post-submission lifecycle copy remain Slice 018.
