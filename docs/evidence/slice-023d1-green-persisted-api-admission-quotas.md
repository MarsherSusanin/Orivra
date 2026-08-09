# Slice 023D1 GREEN — persisted API admission quotas

Date: 2026-08-09

Role: production GREEN author. This document is module implementation evidence,
not either independent verifier PASS and not a unified 022–029A candidate
freeze.

## Frozen contract lineage

- Initial RED: `c9930c138aa68aec41c69d5cd29815cf8c84a78a`.
- Error-leak assertion correction: `026e509adb3129c8dcfcd0bc13eee3c46f4d9725`.
- Exact migration 008 aggregate inventory correction:
  `f1536776d2ae9a922ccc6980494a398cfff8da30`.
- The production author did not edit the frozen tests. Both corrections were
  separate Contract/Test Designer commits before the corresponding GREEN work
  resumed.

## Delivered implementation

- `parseApiQuotaPolicy` accepts only canonical bounded base-10 values, enforces
  global challenge limit greater than or equal to the address limit and is
  composed before request handling.
- Migration 008 adds constrained, indexed quota windows and least privilege:
  API owns admission and bounded stale cleanup; worker owns neither boundary.
- Wallet challenge admission uses one PostgreSQL clock and one transaction for
  deterministic address/global reservations plus the canonical challenge.
  First-row limits freeze, either rejection rolls back all effects and cleanup
  failure cannot reject an admitted challenge.
- Create-run returns exact idempotent replay before quota, serializes new
  project intent under a transaction-scoped advisory lock, rechecks intent,
  reserves the daily window and enforces the stored active-live policy before
  inserting run, first event and command. Replay consumes daily quota only;
  terminal live runs release an active slot without refunding daily usage.
- API/CORS exposes only bounded integer `Retry-After` for the two normalized
  429 outcomes. Active-live 409 has no timing. Wallet/run clients accept only
  status- and surface-compatible codes, use fixed client-owned copy and discard
  malformed or hostile response evidence.

## Reproducible module gates

- `npm run typecheck`: PASS.
- Focused 023D1 hermetic command: 4 files PASS, 42 active tests PASS; the five
  opt-in cases were intentionally not evidence in this command.
- Nearest unchanged baseline: 7 files PASS, 89 active tests PASS.
- `npm run test:coverage:backend`: 98 files PASS, 875 active tests PASS. Overall
  backend is 91.86% lines / 86.59% branches; API subtotal is 90.71% lines /
  85.15% branches. The command required loopback permission for the existing
  Node bridge tests; the accepted rerun had no test failure.
- `npm run test:coverage:web`: 63 files and 505 tests PASS; 92.14% lines /
  85.77% branches. `run-client.ts` is 95.89% lines / 90.05% branches.
- `npm run build --workspace apps/api`: PASS.
- `npm run build`: PASS; `dist/client/index.html`, `dist/server/index.js` and
  `dist/.openai/hosting.json` were emitted. The existing chunk-size warning is
  non-blocking.
- `PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1`:
  19 files PASS, 138 tests PASS, zero skipped. This real Docker/PostgreSQL gate
  covers empty/upgrade/reapply migration, restart and first-row freezing,
  hostile application-clock skew, concurrent exact winners, project isolation,
  replay-before-quota, terminal slot release, rollback, privilege and cleanup
  preservation.

No external network, credentials, hosted service or live Coston2 environment
was used or claimed. The exact candidate commit/tree is recorded after this
documentation is committed; two different read-only verifiers must inspect that
same tree.
