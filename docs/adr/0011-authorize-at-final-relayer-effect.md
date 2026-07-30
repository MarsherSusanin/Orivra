# ADR 0011 — Authorize at the final relayer effect

## Status

Accepted for Slice 011.

## Decision

Authorization at command creation is necessary but not sufficient. Persisted
commands may be corrupted, migrated, replayed, or inserted by an internal caller.
Therefore the final handler that claims the single broadcast attempt and can call
the RPC must re-authorize the persisted manifest mode before touching any relayer
repository or network port.

## Consequences

The broadcast handler duplicates one inexpensive manifest-mode assertion. This is
intentional defense-in-depth; it prevents external spending even if every upstream
API and database boundary is bypassed.
