# Slice 011 — Relayer effect boundary

## Trigger

Independent verification of commit
`76ed148a0dfa545a8801f66842613df5ecae79d7`, tree
`ac80a5d15050e32c3eff6db8a6f9969658c16f31`, reproduced an unauthorized
relayer broadcast from a persisted downstream command on a wallet run.

## Frozen acceptance contract

- Every worker handler capable of claiming or broadcasting a relayer transaction
  independently proves `manifest.submission.mode === "relayer"` immediately after
  loading the run context.
- A wallet or replay run presented with `BROADCAST_RELAYER_TRANSACTION` returns a
  stable `SUBMISSION_MODE_MISMATCH` before relayer lookup, attempt claim, RPC
  lookup, broadcast, marker write, event creation, or child command creation.
- A valid relayer run retains attempt-before-I/O, no-rebroadcast recovery, identity
  validation, and receipt scheduling behavior.
- The public API and PostgreSQL one-submission invariant remain unchanged; this
  slice is defense-in-depth for corrupted or internally injected commands.

## Cycle

1. Contract & Test Designer freezes wallet/replay RED and a relayer control.
2. Core Implementer adds the minimum production guard.
3. Root reruns every release gate and freezes a new candidate.
4. Two fresh read-only verifiers must sign the same hash.
