# ADR 0007 — One terminal release command graph per run

## Status

Accepted for Slice 007.

## Decision

Run intent, not an HTTP request or worker lease, is the idempotency boundary. A run
may persist at most one relayer transaction identity and at most one successful
broadcast. Submission endpoints may return the existing command/result, but cannot
create another spend path.

Every production surface advances the same persisted graph. Successful preflight
schedules the next mode-specific command; replay terminates from persisted replay
evidence, while live mode advances receipt, Relay, DA proof, verification, safe
consumer diagnostics, and release evidence. Terminal success or failure is a
versioned append-only event and makes every mutation endpoint immutable.

Action identity is derived from immutable GitHub repository, event, commit, tree,
workflow, job, and submission mode inputs. Time and process-local counters may be
used for polling telemetry, never for run or command idempotency. The Action is a
project-token client only; signing material remains in the worker environment.

External I/O uses one deadline that includes name resolution and response body
consumption. A timeout aborts the operation and is normalized into durable terminal
evidence when retries are exhausted.

## Consequences

The PostgreSQL schema gains uniqueness and conflict behavior for relayer identity.
Legacy live runtime composition is deleted from production bootstrap. Tests must
exercise replay/live completion through public persisted ports and rebuild terminal
state solely from ordered events.
