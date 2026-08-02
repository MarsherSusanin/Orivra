# Proofline product roadmap

The product journey is delivered as independently frozen vertical slices:

`Runs → Manifest → Preflight → Submission → Lifecycle → Consumer Lab → Evidence handoff`

## Status

| Slice | Outcome | Status |
|---|---|---|
| 014 | Honest routing and persisted run discovery | Complete |
| 015 | Four-step manifest Composer and recoverable local draft | Complete |
| 016 | Persisted preflight evidence and decision Workbench | Complete; independently verified |
| 017A | Manifest-owned submission decision and confirmation evidence | In progress |
| 017B | Wallet, relayer and replay confirmation through one persisted path | Planned in current slice |
| 018 | Restart-safe waiting, retry and terminal recovery semantics | Pending |
| 019 | Consumer evidence matrix and deterministic safe artifact | Pending |
| 020 | Evidence receipt, integration package and read-only handoff | Pending |
| 021B | Deterministic local product funnel report | Pending |

## Current Slice 017 objective

Replace the temporary submission placeholder with one explicit confirmation
boundary. The mode is already immutable in `Web2JsonManifestV1`; the user reviews
the persisted Coston2 request, signer/payer model, request identity and fee before
exactly one effect is authorized.

- Wallet: the browser prepares an unsigned Coston2 transaction, asks an EIP-1193
  wallet to broadcast, persists the returned hash before attachment, and never
  rebroadcasts a recorded hash.
- Relayer: confirmation persists one authorized worker command; the worker keeps
  final-effect authorization, quota, cap and balance-floor enforcement.
- Replay: confirmation persists one replay command and guarantees zero RPC or
  broadcast effects.
- Preflight alone never starts relayer or replay execution.
- Rejection, double click and reload preserve a safe, resumable run.

## Validation policy

Each row above is a separate candidate. RED/GREEN development stays focused and
fast; the full matrix runs before that row is frozen, followed by two independent
PASS reports on one tree hash. See `docs/development/roles.md` and
`docs/runbook.md` for the exact cadence and commands.
