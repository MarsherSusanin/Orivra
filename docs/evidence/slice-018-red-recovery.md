# Slice 018 RED evidence — restart-safe recovery

## Frozen scope

The RED wave adds only public-contract, domain projection, PostgreSQL command
journal, worker classification/no-rebroadcast and Web hydration/surface tests.
No production file was changed.

## Command

```bash
npx vitest run \
  packages/contracts/test/slice018-recovery.contract.test.ts \
  packages/domain/test/slice018-recovery-projection.contract.test.ts \
  apps/api/test/postgres/slice018-recovery-journal.contract.test.ts \
  apps/worker/test/slice018-recovery-classification.contract.test.ts \
  src/slice018-recovery-surface.contract.test.tsx
```

## Expected RED result

- 5 test files failed; 18 tests failed and 2 unchanged safety tests passed.
- `RunRecoveryV1Schema` and the three recovery journal variants are absent.
- The lifecycle projector rejects interleaved recovery events.
- PostgreSQL retry/reclaim transactions append no recovery evidence.
- Worker failures do not yet publish `recoveryState` classification.
- Web hydration discards `projection.recovery`; the cockpit has no persisted
  recovery, offline or partial-sync surface.
- The existing durable relayer-hash test remains green and proves the baseline
  already avoids rebroadcast when the recorded transaction can be resolved.

These are the intended missing behaviors. The frozen tests must not be weakened
to make the implementation green.
