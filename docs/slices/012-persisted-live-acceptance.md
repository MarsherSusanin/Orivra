# Slice 012 — Persisted live acceptance

## Trigger

Independent core verification of commit
`d1958f9f62b910454c91212ca51279d0675bb49b`, tree
`7c93fb9953c539a673788e8ddce2adf16474a6e5`, found that the documented
standalone live test bypassed the persisted API/worker command graph. It omitted
required relayer policy evidence, broadcast directly, and returned a constant
no-rebroadcast claim.

## Frozen acceptance contract

- `npm run test:live:coston2` exercises the same persisted HTTP client used by
  the production merge-queue GitHub Action: create run, submit relayer command,
  poll the persisted projection, verify the canonical safe consumer, export the
  terminal bundle, and replay it byte-identically.
- The live runner requires `PROOFLINE_API_URL`, `PROOFLINE_PROJECT_TOKEN`,
  `PROOFLINE_LIVE_MANIFEST`, `GITHUB_SHA`, and `PROOFLINE_TREE_HASH`. It never
  accepts, reads, or transports a Coston2 private key or verifier API key; those
  credentials remain inside the deployed worker.
- Published live evidence is derived from the persisted projection, journal, and
  bundle. `broadcastCountAfterRecordedHash` must be exactly zero; it cannot be a
  runner-side constant.
- The obsolete direct live-gate orchestrator and its tests are deleted. No
  documented release path may call `signRelayerTransaction` or
  `broadcastRawTransaction` outside the persisted worker handler.
- Without all runner configuration, the live suite is skipped and reported as an
  external configuration blocker. Hermetic tests never substitute fixtures for
  live evidence.

## Cycle

1. Contract & Test Designer freezes source-graph, custody, and persisted-client
   RED contracts.
2. Surface Implementer rewires the live acceptance test to the Action persisted
   client and removes the obsolete direct orchestrator.
3. Root reruns the full release matrix and freezes a new tree.
4. Two fresh read-only verifiers must sign the same hash.
