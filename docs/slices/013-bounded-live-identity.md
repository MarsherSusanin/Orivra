# Slice 013 — Bounded live gate and candidate identity

## Trigger

Independent core and product verification of commit
`3769d231df6cb745b2afc27287aa7b55ab04ee54`, tree
`41aa6440dc297b92380ea5e2d28bde1e43fd6cac`, found that the persisted live
client reset its timeout for each lifecycle phase and issued HTTP requests with
no abort deadline. The Action also accepted arbitrary truthy commit/tree labels.

## Frozen acceptance contract

- `runLive` validates a positive timeout no greater than 600,000 ms and computes
  one absolute deadline at entry. Readiness, proof polling, consumer verification,
  terminal polling, bundle export, and replay all consume that same budget.
- Every live HTTP request is bounded by the remaining deadline and aborts a hung
  fetch. Timers and abort listeners are cleaned up on success and failure.
- Expiry produces one stable, non-retryable release-gate timeout and no later
  request, sleep, consumer command, bundle read, replay, or artifact upload.
- `GITHUB_SHA` and `PROOFLINE_TREE_HASH` are each exactly 40 hexadecimal
  characters. Invalid identity is rejected before the first API request.
- Published evidence must contain the exact commit and tree supplied to the
  current Action environment. Malformed or mismatched evidence is rejected
  before summary success or artifact upload.
- PR replay behavior and the worker-owned relayer path are unchanged.

## Cycle

1. Contract & Test Designer freezes hung-fetch, cumulative-budget, invalid-hash,
   mismatch, and positive identity controls as RED.
2. Surface Implementer adds one shared deadline and strict identity binding.
3. Root reruns the full release matrix and freezes a new tree.
4. Two fresh read-only verifiers must sign the same hash.
