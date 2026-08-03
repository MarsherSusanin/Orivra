# Slice 021B GREEN — deterministic local Product QA report

## TDD waves

- Independent RED contract/test commit: `3f1b70c`.
- GREEN contracts/domain commit: `a7ecf1e`.
- The RED wave failed only for the four missing public APIs and kept the 021A
  neighbor suite green. The frozen tests were not weakened for GREEN.

## Delivered result

- `ProductQaReportV1` is strict and aggregate-only at every level. It contains
  no raw events, session identifiers, timestamps, URLs, manifests, tokens or
  transaction evidence.
- Session and repeated-journey counters enforce valid arithmetic and the exact
  ordered nine-step funnel contract.
- Rejected manifest, preflight and replay attempts may be retried; accepted
  progress, duplicates, consumer failure, safe codegen, completion and resume
  evidence remain deterministic.
- Structurally out-of-order or backward-time sessions fail closed and do not
  contribute valid funnel rows.
- The bounded adapter distinguishes `healthy`, lifetime `recovered` and
  `unavailable` queue state, trims oldest evidence above 500 events and exports
  canonical bytes without a network provider.

## Final matrix before candidate freeze

- `npm run typecheck`: PASS.
- `npm test`: 172 files PASS, 4 infrastructure-conditioned files skipped;
  1540 tests PASS, 14 skipped.
- `npm run test:core:coverage`: 34 files and 404 tests PASS; statements,
  branches, functions and lines are all 100%.
- `npm run test:coverage:backend`: 770 PASS, 14 skipped; 92.08% statements,
  87.76% branches and 92.99% lines.
- `npm run test:coverage:web`: 313 PASS; 89.11% statements, 84.65% branches and
  91.14% lines.
- `npm run test:solidity`: 17 files and 244 tests PASS.
- `npm run test:e2e`: 7 PASS.
- `npm run build`: PASS and all required Sites artifacts emitted. The existing
  Vite warning for a JavaScript chunk above 500 kB remains non-blocking.
- `npm run test:sites`: 7 PASS.
- Standalone checked-in GitHub Action clean-build byte identity: PASS.
- Real Testcontainers PostgreSQL: 16 files and 114 tests PASS, zero skipped.

## Freeze rule and scope

Candidate commit and tree are recorded after this document is committed. Two
different independent verifiers must inspect that exact clean tree. Any later
production change invalidates both decisions.

Slice 021B adds no persistence migration, external analytics provider, user
analytics dashboard or infrastructure deployment. Live Coston2 and deployed
infrastructure acceptance remain separate release gates and are not claimed by
this evidence.
