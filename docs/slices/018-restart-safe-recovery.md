# Slice 018 — Restart-safe recovery

## User outcome

During a long Coston2 run, the developer sees whether Proofline is safely
waiting, automatically retrying the same persisted command, or stopped with a
terminal result. Reload and worker restart preserve the run, its evidence and
the exact continuation point. No recovery action can accidentally broadcast a
second transaction.

## 018A — Recovery semantics

- Add strict `RunRecoveryV1`, recovery checkpoint and preserved-evidence
  contracts.
- Add `STAGE_WAITING`, `STAGE_RETRY_SCHEDULED` and `RUN_RESUMED` to
  `RunEventV1` without advancing the six lifecycle stages.
- Expose unresolved recovery as optional `RunProjectionV1.recovery`; derive it
  exclusively from ordered events.
- Waiting covers recorded transaction, Relay and DA pending states and never
  offers manual retry.
- A safe pre-effect transport or timeout failure requeues the same command with
  persisted `retryAfter`; claim records `RUN_RESUMED` before the next I/O.
- A recorded transaction hash forbids rebroadcast. Recovery may only observe the
  recorded effect.
- Transaction revert, consensus miss and invalid proof emit a stable terminal
  failure whose safe next step is a new run from the persisted manifest.
- Consumer invariant failure remains a consumer result and never becomes a
  lifecycle recovery failure.
- `RUN_FAILED` and completed consumer results remain terminal and immutable.

## 018B — Recovery surface

The active-stage surface shows:

- what Proofline is doing and the expected wait;
- last persisted update and optional retry time;
- enumerated evidence already preserved;
- the exact resume checkpoint and retry-safety rule;
- one safe primary action when action is possible.

Waiting has no mutation button. Retryable recovery offers only status refresh
while the queue retries automatically. A recoverable terminal result offers one
project-authorized `Create new run` action using the original persisted manifest;
share access remains read only. Ambiguous post-effect state offers operator
review, never retry. Consumer failure points to Consumer Lab.

Stale, offline and partial reads keep previously persisted evidence visible and
identified as such. Polling resumes with the same run ID and event cursor;
missing in-memory journal state refetches from sequence zero. Back, forward and
reload do not create a new run or command.

## Public and persistence contracts

- `RunRecoveryV1`: version, `waiting | retryable | terminal`, stage, attempt,
  optional `retryAfter`, resume checkpoint, unique preserved-evidence classes,
  `updatedAt`, normalized error and retry safety.
- `RunEventV1`: the three strict recovery variants with server-derived redacted
  payloads.
- `RunProjectionV1.recovery`: optional and replay-derived.
- Existing `GET /v1/runs/:id` and `/events?after=` expose recovery; no new
  mutation endpoint is added.
- Existing PostgreSQL schema is sufficient. Retry/reclaim transactions append
  recovery events atomically and use command/type/attempt dedupe identity.

## TDD cadence

1. Freeze focused RED contracts for schemas, recovery projection properties,
   worker classification, PostgreSQL retry/reclaim, API hydration and Web
   recovery states.
2. GREEN core changes contracts/domain and proves event order, monotonic stages,
   terminal immutability and deterministic replay.
3. GREEN adapters atomically journal retry/resume, preserve no-rebroadcast and
   classify waiting versus terminal evidence.
4. GREEN Web adds persisted waiting/retryable/terminal, stale/offline/partial
   and new-run surfaces without changing the accepted cockpit hierarchy.
5. Run affected coverage during the wave, then the complete runbook matrix once
   before candidate freeze.
6. Two independent verifiers inspect the same tree. Product Verification runs
   desktop/mobile restart, offline, stale, retry and terminal journeys.

## Acceptance

- Property tests cover interleaved recovery ordering, attempt monotonicity,
  lifecycle monotonicity, terminal immutability and replay byte determinism.
- Worker/PostgreSQL tests prove atomic retry scheduling and retry claim, lease
  restart/resume, exact dedupe and no broadcast after recorded tx hash.
- Stable transaction-pending, Relay-pending, DA-pending, reverted,
  consensus-miss and proof-invalid cases are covered by recorded fixtures.
- API returns the strict projection for project and share reads; share cannot
  mutate or create a replacement run.
- Browser `1488×1058` and `390×844`: waiting, retryable, stale, offline,
  partial, terminal and consumer-result routing; reload/cursor continuity,
  keyboard/focus/Escape, axe zero serious/critical and clean console/network.
- Contracts/domain stay at 100%; affected backend and Web coverage remain above
  repository gates. PostgreSQL, Solidity, hermetic E2E, build and Sites pass
  before freeze.

## Exclusions

Manual command retry, operator dashboards, cross-project recovery, infrastructure
alerting and provider-specific deployment remain out of scope. The Consumer Lab
report, exact safe artifact and generated-source actions are Slice 019.
