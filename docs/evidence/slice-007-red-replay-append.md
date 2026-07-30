# Slice 007 RED — replay event-batch persistence

## Provenance

- Frozen base commit: `9ba9b13d8bb7cfb6945e1af4aea7e9a1d99a2ba7`.
- Role: Contract & Test Designer; not a production implementer or verifier.
- Scope: one new PostgreSQL contract and this evidence note. Production,
  configuration, thresholds, migrations, and prior tests remain unchanged.

## Contract

The real `APPLY_REPLAY_EVIDENCE` handler outcome is completed through the real
PostgreSQL command repository. Its five ordered lifecycle events and four
immutable artifacts must commit atomically, rebuild a terminal projection, and
survive a fresh repository instance. A later replay-apply retry must produce no
duplicate events or artifacts and must complete without an idempotency conflict.

The setup also proves the control path: `RUN_PREFLIGHT` is completed through the
same production repository and durably stores its one event plus replay source
and preflight evidence.

## Expected RED

Command:

```text
PROOFLINE_TESTCONTAINERS=1 npx vitest run apps/api/test/postgres/slice007-replay-append.contract.test.ts --reporter=verbose
```

Current semantic failure:

```text
Idempotency command conflict for <APPLY_REPLAY_EVIDENCE command id>
```

The handler currently gives all five distinct events the same `commandId`.
`completeCommand` appends the first event, then the journal rejects the second
different command effect. PostgreSQL rolls the entire transaction back: only
`RUN_CREATED` and `PREFLIGHT_ACCEPTED` remain and none of the replay-apply
artifacts leak. The rollback control passes; the required successful atomic
completion remains RED.
