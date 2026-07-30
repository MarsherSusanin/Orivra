# Slice 010 — One submission and complete evidence

## Trigger

Independent verification of commit
`954078c7c89076ad9baec0dc0a637319679ecccb`, tree
`5425558951f08dcbcc6920933fed951564a15b3b`, failed. A persisted wallet manifest
could enqueue both wallet and relayer paths, Consumer Lab understated the
vulnerable consumer's missing checks, and fixed mobile navigation covered required
next-step copy.

## User result

A run has exactly one submission authority chosen by its persisted manifest.
Consumer Lab renders every failed invariant present in diagnostic evidence. At the
mandatory mobile viewport, the full action footer—including explanatory copy—stays
visible above navigation.

## Frozen acceptance contract

- `manifest.submission.mode` is immutable run intent. `wallet` accepts only an
  unsigned wallet transaction and later attachment; `relayer` accepts only the
  authorized relayer command; `replay` accepts neither live submission endpoint.
- A mismatched request returns stable `409 SUBMISSION_MODE_MISMATCH` before any
  command insert, signing, broadcast, quota use, or relayer transaction record.
- Worker handlers independently reject a persisted `SUBMIT_RELAYER` command for a
  non-relayer manifest and `ATTACH_WALLET_TRANSACTION` for a non-wallet manifest.
- PostgreSQL permits at most one non-cancelled submission command per run across
  `SUBMIT_RELAYER` and `ATTACH_WALLET_TRANSACTION`. Migration fails closed if legacy
  data already contains a dual path.
- Exact idempotent retry of the selected path retains existing terminal read-back
  behavior; a different mode, key, transaction, or command intent is a conflict.
- Consumer verification derives failed URL checks from the union of stable
  diagnostic codes and versioned `evidence.missingChecks`. Only the known values
  `scheme`, `host`, `path`, and `query` affect the checklist.
- The canonical vulnerable diagnostic with all four missing checks renders all four
  URL invariants as `Missing`; it never marks any of them `Passed`.
- At 390×844, the bounding box of every action-footer child—including the full
  next-step sentence—ends at least 8 CSS pixels above fixed navigation in initial,
  hydrated retry, and `Bundle verified` states. No text is clipped or covered.

## Cycle

1. Contract & Test Designer freezes API, worker, PostgreSQL, Web mapping, and mobile
   geometry RED contracts.
2. Core Implementer binds API/worker/database submission intent to the manifest.
3. Surface Implementer maps diagnostic evidence and reserves the full mobile footer.
4. Test-only reconciliation updates obsolete dual-path and geometry assumptions.
5. Root reruns the complete release matrix and freezes a new tree for two fresh
   read-only verifiers.
