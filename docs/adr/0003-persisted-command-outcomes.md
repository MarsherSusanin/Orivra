# ADR 0003 — Persisted command outcomes are the production orchestration boundary

## Status

Accepted for Slice 003.

## Context

The domain lifecycle is event-sourced, but the production API and worker were
previously connected only by untyped command rows. A monolithic live runtime can
perform network calls yet cannot safely resume or project evidence after a crash.
In particular, a transaction hash held only in process memory is not durable.

## Decision

Every production worker handler returns a `ProductionCommandOutcome` containing
only versioned run events, immutable artifacts, and deduplicated next commands.
The PostgreSQL repository persists the entire outcome and completes the current
lease in one transaction.

Long waits are split into bounded polling commands. A handler may renew its lease
around a bounded operation, but it may not own an unbounded lifecycle loop.

Relayer preparation is a separate durable boundary: the exact signed raw bytes and
derived hash are committed before broadcast. Broadcast recovery is identity-based
and may reuse only those bytes. Once a successful broadcast marker exists, later
workers poll the recorded hash and cannot call the broadcaster.

Wallet preparation is synchronous and derived only from persisted preflight
evidence. The API never receives or stores a user private key.

## Consequences

- Restart behavior can be proven with fixture ports and PostgreSQL independently
  of Coston2 availability.
- Events, artifacts, and child commands cannot diverge through partial commits.
- Handler code remains deterministic while network-specific details stay behind
  typed ports.
- More command rows are created, but each command is bounded, idempotent, and
  independently observable.
