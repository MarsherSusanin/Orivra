# Slice 003 — Persisted production command pipeline

## Trigger

Slice 002 made the packages executable and added a concrete Coston2 adapter, but a
production run created through the API still cannot advance: the API enqueues
`RUN_PREFLIGHT`, submission, attachment, and verification commands while the
worker composition registers only the isolated merge-gate command.

## User result

One persisted run created through the production API advances through the same
append-only journal used by the cockpit. Wallet preparation is returned to the
client without exposing a private key; relayer signing is persisted before the
first broadcast; receipt, Relay, DA, proof, consumer diagnostics, safe codegen,
and bundle assembly resume after worker restarts.

## Boundary

This slice changes the production service, PostgreSQL repositories, worker
handlers/composition, and command/evidence contracts. Network behavior is tested
through fixture ports; live Coston2 remains a separate merge gate. Web layout,
public manifest/event schemas, and the accepted cockpit are frozen.

## Command graph

```text
RUN_PREFLIGHT
  ├─ wallet preparation → ATTACH_WALLET_TRANSACTION
  └─ SUBMIT_RELAYER → BROADCAST_RELAYER_TRANSACTION

ATTACH/BROADCAST
  → POLL_TRANSACTION_RECEIPT
  → POLL_RELAY_FINALIZATION
  → FETCH_DA_PROOF
  → VERIFY_PROOF
  → VERIFY_CONSUMER
  → BUILD_PROOF_BUNDLE
```

Wallet transaction preparation is a synchronous read of persisted preflight
evidence. It is not an asynchronous command because the browser and CLI need the
unsigned transaction in the submission response.

## Acceptance contracts

- Production worker registers every command that the API or another handler can
  enqueue. Unknown commands fail closed and no configured command is orphaned.
- A handler receives the manifest, ordered journal, projection, and typed evidence
  loaded from PostgreSQL. It may return events, immutable artifacts, and
  deduplicated child commands.
- Command completion atomically appends events, persists artifacts, schedules
  children, and completes the lease. Any failure rolls the whole transaction back.
- Long-running commands renew their lease. Expired/stale owners cannot append,
  retry, complete, or schedule children.
- Wallet submission returns chain `0x72`, registry-resolved `FdcHub`, exact saved
  request calldata, and the exact quoted fee. Transaction attachment validates the
  observed transaction before advancing.
- Relayer nonce, signed raw transaction, derived hash, command fingerprint, value,
  target, and calldata identity commit before the first broadcast. Recovery never
  signs a replacement and never broadcasts after `broadcast_at` is recorded.
- Run ownership is checked before submissions, transaction attachment, consumer
  verification, codegen, bundle reads, and share creation. Reusing an idempotency
  key with different command intent returns a conflict.
- Consumer invariant failure is a terminal product result expressed as
  `CONSUMER_VERIFIED { passed: false, diagnostics }`, not a transport retry.
- Bundle bytes are assembled from the persisted journal/evidence, stored once,
  exported byte-for-byte, and replay byte-identically. Tokens, private keys, raw
  signed transactions, and authorization material are excluded.

## TDD gates

1. Contract/Test Designer freezes production service, command composition,
   atomic outcome, relayer recovery, and bundle-evidence RED tests.
2. Core/worker writer implements the minimal fixture-driven command engine.
3. Persistence writer connects PostgreSQL atomics and production composition.
4. Existing hermetic, API, worker, CLI, Action, Sites, Web, coverage, and browser
   gates remain green.
5. Candidate tree is frozen only after two fresh independent verifiers PASS the
   same tree hash.

Testcontainers and live Coston2 execution are reported separately when their
external runtime or credentials are unavailable; neither may be replaced by an
in-memory success stub.
