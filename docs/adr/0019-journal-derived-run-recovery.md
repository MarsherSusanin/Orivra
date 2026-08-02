# ADR 0019 — Journal-derived run recovery

## Status

Accepted for Slice 018.

## Context

The persisted command queue already records attempts, leases and `available_at`,
but the public run projection reduces every temporary failure to generic active
or terminal stage copy. A reload cannot explain whether Proofline is safely
waiting, retrying the same command, or requires a new run. Adding a mutable
recovery table would create a second source of truth beside the append-only run
journal and could disagree with the command queue after a crash.

Recovery annotations also cannot be treated as lifecycle transitions. The
current projector uses the raw event index as the lifecycle index, so inserting
an observation event would otherwise advance the six-stage state machine.

## Decision

Recovery is an append-only journal concern. `STAGE_WAITING`,
`STAGE_RETRY_SCHEDULED` and `RUN_RESUMED` are strict `RunEventV1` variants that
never advance a lifecycle stage. `RunProjectionV1.recovery` is derived from the
latest unresolved recovery annotation and is never stored independently.

`RunRecoveryV1` exposes only bounded, redacted facts: state, lifecycle stage,
attempt, optional retry time, resume checkpoint, enumerated preserved-evidence
classes, last update, normalized error and retry safety. It never contains raw
URLs, calldata, transaction bodies, credentials, stacks or adapter payloads.

The projector validates journal sequence across all events but validates
lifecycle order using lifecycle events only. Recovery attempt numbers are
monotonic for a command. `RUN_RESUMED` must correspond to an earlier waiting or
scheduled annotation and clears the active recovery view. A successful
lifecycle transition also clears a stale recovery view. No event is accepted
after `RUN_FAILED` or `CONSUMER_VERIFIED`.

The command repository appends retry observations in the same transaction that
requeues a command. A retry claim appends `RUN_RESUMED` in the same transaction
that increments the attempt and acquires the lease, before external I/O. Journal
dedupe identity for recovery annotations is derived from command, event type and
attempt; the public `commandId` remains the real effect command. Exact repeats
are idempotent and conflicting annotations fail closed.

An expired leased attempt is itself persisted recovery evidence. Reclaim first
appends a generic, secret-free `STAGE_RETRY_SCHEDULED` annotation for the lost
attempt and then `RUN_RESUMED` for the newly claimed attempt in the same
transaction, before external I/O. Recovery messages are selected from a closed
public vocabulary; adapter-provided message text is never copied into recovery.

Waiting is reserved for an already-observed asynchronous effect: a recorded
transaction receipt wait, Relay finalization or DA availability. It has no
manual retry. Retryable means a transport or timeout failure before a new
effect, and the same persisted command is retried automatically. A recorded
transaction hash always switches recovery to observation and can never
authorize another broadcast.

Transaction revert, consensus miss and invalid proof terminalize the run and
require a new run from the persisted manifest. Ambiguous post-effect evidence
requires operator review. Consumer invariant failure remains consumer evidence,
not a lifecycle transport failure, and leads to Consumer Lab in Slice 019.

No schema migration is required. Existing `run_commands.attempts`,
`available_at`, `last_error`, `run_events` and the cached projection are
sufficient. Real PostgreSQL restart, lease reclaim and idempotency tests are
still mandatory.

## Consequences

Recovery survives API, Web and worker restarts and can be replayed from the same
journal as the lifecycle. API and share readers receive the same projection;
share access remains read only. There is no manual retry endpoint and no second
effect path. The Web may refresh evidence or create a new run when authorized,
but cannot mutate a terminal run.

Adding recovery events changes journal projection and proof-bundle event
contents, so contracts/domain coverage, deterministic replay, PostgreSQL,
worker no-rebroadcast, Web reload/offline acceptance and the full candidate
matrix are release gates for Slice 018.
