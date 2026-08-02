# Slice 018 GREEN evidence — restart-safe recovery

## Frozen RED

- Contract/test commit: `4196426`.
- Five focused files produced 18 expected failures and kept the existing durable
  relayer no-rebroadcast control green.
- Exact failure reasons are recorded in `slice-018-red-recovery.md`.

## GREEN waves

- Core contracts, projection and worker classification: `5b7e108`.
- Legacy worker assertion reconciliation: `6ef9b3c`.
- PostgreSQL journal and Web recovery surface: `89a0b89`.
- Fake-timer harness correction and real restart/reclaim coverage: `624fb70`.

## Focused evidence

- Slice 018 contracts/domain/PostgreSQL/worker: `38/38` PASS.
- Recovery Web hydration and surface: `6/6` PASS.
- Full worker suite after recovery classification: `199/199` PASS.
- Affected contracts/domain/API/worker/Web regression before the final harness
  correction: `1049/1050` PASS; the single failure was the corrected fake-timer
  synchronization defect.
- Typecheck and production build: PASS.
- Docker-backed PostgreSQL command integrity, including repository recreation,
  persisted `STAGE_RETRY_SCHEDULED` and atomic `RUN_RESUMED`: `4/4` PASS.

The complete runbook matrix, candidate commit/tree and two independent verifier
reports are recorded only after the documentation commit is frozen. These
focused results are not either independent PASS.
