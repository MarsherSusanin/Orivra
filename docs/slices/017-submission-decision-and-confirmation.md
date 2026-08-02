# Slice 017 — Submission decision and confirmation

## User outcome

After a ready or acknowledged-attention preflight, a developer reviews one
immutable submission choice and confirms it once. The result is concrete:
wallet broadcast plus durable attachment, one authorized relayer command, or one
network-free replay command.

## 017A — Decision evidence

- Mode comes only from the persisted manifest projection and cannot be changed.
- The surface explains signer, payer, network effect and trust model for Wallet,
  Relayer or Replay.
- Before confirmation it shows Coston2, chain 114, registry-resolved `FdcHub`,
  request SHA-256, quoted fee/cap and the effective signer.
- Share access is read-only. A blocked preflight and terminal run cannot confirm.
- Changing mode links to a new Composer run; it never mutates the current run.

## 017B — Confirm and execute

- `POST /v1/runs/:id/submissions` accepts exactly the persisted mode and returns a
  versioned discriminated response.
- Preflight creates no relayer or replay effect command. Explicit confirmation is
  the only creation boundary for `SUBMIT_RELAYER` and `APPLY_REPLAY_EVIDENCE`.
- Wallet uses EIP-1193 on chain `0x72`; a returned tx hash is saved before API
  attachment. A saved hash is attached without another wallet call.
- Relayer confirmation persists one command; final worker authorization, exact
  target/calldata/value, caps, quota and balance floor remain mandatory.
- Replay confirmation persists one pure command and touches no wallet, RPC,
  relayer or source-host port.
- `APPLY_REPLAY_EVIDENCE` repeats the persisted replay-mode authorization at the
  final handler boundary.
- Wallet attachment is rejected before completed preflight and the worker proves
  the observed transaction hash equals the attached command hash before emitting
  `REQUEST_SUBMITTED`.
- Double click, reload and exact retries cannot create a second command or
  broadcast. Wallet rejection leaves the same run safely retryable.
- `SUBMISSION_REQUESTED` is emitted once from explicit confirmation with the
  persisted mode, never from render, hydration or share access.

## Public and persistence contracts

- Add a strict `SubmissionResponseV1` discriminated by `wallet | relayer |
  replay`, with run identity and effect-owner evidence.
- Extend the request schema to all three modes; production requires an explicit
  mode and idempotency key.
- Add migration `005` extending one active submission authority per run to
  `APPLY_REPLAY_EVIDENCE`, with empty/previous/idempotent and legacy-conflict
  Testcontainers coverage.
- Persisted mode mismatch, not-ready preflight, terminal state, duplicate intent,
  quota/cap rejection and malformed wallet transaction use stable safe errors.
- Relayer quota, global cap and balance-floor failures are non-retryable and use
  stable `RELAYER_QUOTA_EXHAUSTED`, `GLOBAL_FEE_CAP_EXCEEDED` and
  `BALANCE_FLOOR_VIOLATION` codes.
- Hermetic API/E2E composition also requires explicit replay confirmation; it may
  not preserve an automatic test-only path that production no longer has.

## TDD cadence

1. Focused RED: new public schema, API/worker/PostgreSQL/CLI/Web contracts and
   nearest Slice 016 baseline only.
2. GREEN core: contracts, API, worker, migration and wallet recovery coordinator;
   run only affected packages and direct dependants.
3. GREEN surfaces: Web decision/confirmation, CLI replay confirmation and Action
   compatibility; run typecheck, affected tests and affected coverage.
4. Refactor, then run the complete runbook matrix once before candidate freeze.
5. Two independent verifiers inspect the same tree; Product Verification runs
   desktop/mobile Wallet reject, Relayer confirm and Replay no-network journeys.

## Acceptance

- Property/contract tests prove mode immutability, exact idempotent intent and
  no-rebroadcast after recorded tx hash.
- API/worker/PostgreSQL tests prove no automatic effect after preflight and one
  explicit command after confirmation, including restart/race cases.
- Replay tests fail on any wallet/RPC/relayer/source call.
- Browser `1488×1058` and `390×844`: all modes, double click, reload, wallet
  rejection, keyboard/focus, Back/Forward, axe zero serious/critical, clean
  console/network and essential evidence without hover.
- Existing contracts/domain remain 100%; affected backend and Web coverage stay
  above repository gates. Full hermetic, PostgreSQL, Solidity, E2E, build and
  Sites pass before freeze.

## Exclusions

Waiting estimates, retry scheduling and terminal recovery actions remain Slice
018. Mainnet, custody, arbitrary wallet providers and relayer settings remain out
of scope.
