# ADR 0048: Replay command-group identity

Status: Accepted

Date: 2026-08-14

## Context

Production replay consumes a previously verified terminal proof bundle and
persists its lifecycle under a new run. Source `commandId` values cannot become
authority in the target run, but recovery annotations such as
`STAGE_WAITING` and `RUN_RESUMED` are related by that identity. Rekeying every
event independently destroys the relationship and makes an otherwise valid
template fail during persistence.

## Decision

- Replay assigns one deterministic target `commandId` to each distinct source
  command group in first-seen order.
- Every event from the same source command group receives the same target ID,
  including recovery annotations and its eventual lifecycle result.
- Different source command groups receive different target IDs. Raw source IDs
  are never copied into the target journal.
- The rewritten ordered journal must pass the ordinary `appendRunEvents` and
  `projectRun` invariants before it is accepted as a replay outcome.
- Replay remains evidence-only. Relayer mode continues to use the live Coston2
  transaction, receipt, round, proof and consumer pipeline.

## Consequences

Built-in replay templates can honestly reproduce their complete persisted
evidence, including wait/resume history. A malformed source bundle still fails
closed, and a live run cannot be replaced by replay evidence.
