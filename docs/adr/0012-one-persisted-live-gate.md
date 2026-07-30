# ADR 0012 — One persisted live gate

## Status

Accepted for Slice 012.

## Decision

The merge-queue Action and the documented live acceptance command use one HTTP
client and one PostgreSQL-backed API/worker command graph. The runner proves a
release by reading durable journal, projection, bundle, and replay evidence; it
does not reproduce relayer signing or lifecycle orchestration in process.

Worker custody and release observation are separate trust boundaries. The
runner owns only an opaque project token. The worker owns the Coston2 relayer key
and verifier configuration, validates persisted policy evidence, and records the
broadcast attempt before network I/O.

## Consequences

The old direct live-gate runtime is removed instead of repaired. Live acceptance
now requires a reachable deployed API/worker/PostgreSQL stack, which is already a
release prerequisite. A missing endpoint or runner credential is an explicit
live blocker and cannot be reported as a hermetic pass.
