# ADR 0005 — CLI, Action, and live gates use one persisted release path

## Status

Accepted for Slice 005.

## Decision

Web, CLI, pull-request replay, and merge-queue live execution create or resume the
same API-backed run and observe its append-only journal. A merge gate may inject
live Coston2 ports, but it may not create a synthetic run or hold the only copy of
transaction identity in memory.

External waits are separate bounded commands with retry deadlines. Receipt
observation does not imply Relay finalization; the finalized event is emitted only
after Relay confirms the computed round. Exhaustion writes public failure evidence
and terminates the projection.

Relayer identity is immutable after preparation. The signed bytes, derived hash,
fingerprint, target, calldata, value, nonce, and caps commit before network I/O.
Recovery resolves the recorded hash first and may rebroadcast only the exact bytes
when no successful broadcast marker exists.

Proof bundles are accepted only when the received UTF-8 bytes equal canonical
serialization and persisted proof/codegen evidence agrees with the journal.
