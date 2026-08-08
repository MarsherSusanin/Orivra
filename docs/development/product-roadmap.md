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
| 018 | Restart-safe waiting, retry and terminal recovery semantics | Complete; independently verified |
| 019 | Consumer evidence matrix and deterministic safe artifact | Complete; independently verified in the final handoff journey |
| 020 | Evidence receipt, integration package and read-only handoff | Complete; independently verified |
| 021B | Deterministic local product QA report | Complete; independently verified |

## Completed pre-infrastructure product journey

The roadmap now delivers one coherent local and persisted journey from run
discovery through evidence handoff:

- recovery distinguishes waiting, same-command retry and terminal new-run
  outcomes without rebroadcast after a recorded transaction hash;
- Consumer Lab persists exact invariant evidence and deterministic safe Solidity
  bytes;
- Integration Package binds receipt, bundle, manifest and generated consumer,
  then hands them to a read-only fragment share recipient;
- local product reporting reduces bounded privacy-safe events into a strict
  aggregate-only `ProductQaReportV1` with deterministic canonical bytes.

No external analytics provider, deployment automation or live-infrastructure
PASS is part of these slices.

The next roadmap is operational rather than another product module: select and
record the API/worker/PostgreSQL platform, token provisioning, secrets,
backup/restore, observability and rollback model; then configure hosted CI and
run the persisted live Coston2 gate. None of that infrastructure is currently
present in this repository.

## Validation policy

Each row above is a separate candidate. RED/GREEN development stays focused and
fast; the full matrix runs before that row is frozen, followed by two independent
PASS reports on one tree hash. See `docs/development/roles.md` and
`docs/runbook.md` for the exact cadence and commands.

Slice 017 passed both independent verification roles on commit
`57099232f957123f11574e8137948de1467d1d6d` and tree
`3d99a54a249648781f63afb8519074b1b92c38a1`. Slice 020, including the complete
Consumer Lab handoff, passed both roles on commit
`24957228b59b32f0df2d77b902cd177af0489c4b` and tree
`e2813a3eafec08b28f3b88f780e33a5ca1b91e28`. Slice 021B passed both roles on
commit `b91b4da15bbbc3695fa6b83285652c90841383ea` and tree
`13384b721308a1e1a04319c0391679741fb01760`.
