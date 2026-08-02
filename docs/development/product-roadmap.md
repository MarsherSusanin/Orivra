# Proofline product roadmap

The product journey is delivered as independently frozen vertical slices:

`Runs → Manifest → Preflight → Submission → Lifecycle → Consumer Lab → Evidence handoff`

## Status

| Slice | Outcome | Status |
|---|---|---|
| 014 | Honest routing and persisted run discovery | Complete |
| 015 | Four-step manifest Composer and recoverable local draft | Complete |
| 016 | Persisted preflight evidence and decision Workbench | Complete; independently verified |
| 017A | Manifest-owned submission decision and confirmation evidence | Complete; independently verified |
| 017B | Wallet, relayer and replay confirmation through one persisted path | Complete; independently verified |
| 018 | Restart-safe waiting, retry and terminal recovery semantics | Implemented; candidate freeze gates pending |
| 019 | Consumer evidence matrix and deterministic safe artifact | Pending |
| 020 | Evidence receipt, integration package and read-only handoff | Pending |
| 021B | Deterministic local product funnel report | Pending |

## Current Slice 018 objective

Make every long-running or interrupted Coston2 stage explain its persisted state
without creating another effect path. Recovery is derived from append-only
events and the existing command queue, survives restart, and distinguishes safe
waiting from same-command retry and terminal new-run outcomes.

- Waiting transaction, Relay and DA stages have no manual retry.
- Retryable pre-effect failure reuses the same persisted command.
- A recorded transaction hash is observation-only and forbids rebroadcast.
- Terminal revert, consensus miss and invalid proof create a new run from the
  persisted manifest; the original journal stays immutable.
- Consumer invariant failure routes to Slice 019 Consumer Lab.

## Validation policy

Each row above is a separate candidate. RED/GREEN development stays focused and
fast; the full matrix runs before that row is frozen, followed by two independent
PASS reports on one tree hash. See `docs/development/roles.md` and
`docs/runbook.md` for the exact cadence and commands.

Slice 017 passed both independent verification roles on commit
`57099232f957123f11574e8137948de1467d1d6d` and tree
`3d99a54a249648781f63afb8519074b1b92c38a1`. Slice 018 is not complete until its
full freeze matrix and both independent verification roles PASS one new,
identical tree hash.
