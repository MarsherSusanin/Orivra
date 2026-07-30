# ADR 0013 — One deadline and bound release evidence

## Status

Accepted for Slice 013.

## Decision

The live merge gate owns one absolute monotonic deadline. Nested lifecycle
operations receive only the deadline, never a fresh duration. HTTP requests race
against an abortable remaining-time timer, so a stalled transport cannot outlive
the release budget.

Commit and tree identity are treated as a pair of public security claims. Both
are validated as Git object hashes at the observer boundary and the final Action
compares returned evidence with its own expected pair before publishing.

## Consequences

The nominal ten-minute gate now includes all polling and network time. A timeout
may leave the persisted run resumable in PostgreSQL, but the current Action fails
closed and publishes no success artifact. A later merge-queue retry reuses API
idempotency semantics rather than extending the original execution invisibly.
