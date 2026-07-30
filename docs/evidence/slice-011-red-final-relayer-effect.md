# Slice 011 RED — final relayer effect authorization

## Candidate before RED

- Commit: `d85924f`
- Contract: `docs/slices/011-relayer-effect-boundary.md`
- Decision: `docs/adr/0011-authorize-at-final-relayer-effect.md`

## Frozen test-only contract

`apps/worker/test/slice011-final-relayer-effect.contract.test.ts` invokes the
production `BROADCAST_RELAYER_TRANSACTION` handler with an otherwise
identity-valid persisted relayer row. The row includes the expected run,
idempotency key, chain `114`, `FdcHub` target, calldata, fee, signed transaction
hash, and policy-bound command fingerprint.

For both `wallet` and `replay` manifests the handler must reject with stable
`SUBMISSION_MODE_MISMATCH` and produce no events or child commands before any of
these boundaries are touched:

- `findRelayerTransaction`;
- `deriveTransactionHash`;
- `claimRelayerBroadcastAttempt`;
- `resolveRecordedTransaction`;
- `broadcastRawTransaction`;
- `markRelayerBroadcast`.

The positive `relayer` control freezes the existing safety behavior: the durable
attempt claim precedes RPC broadcast, the accepted hash is marked, receipt
polling is scheduled, and a retry after the durable marker does not claim,
resolve, broadcast, or mark again.

## RED evidence

Command:

```text
npm exec vitest -- run apps/worker/test/slice011-final-relayer-effect.contract.test.ts --reporter=verbose
```

Result: **2 semantic RED, 1 control PASS**.

- Wallet and replay cases resolve successfully instead of rejecting with
  `SUBMISSION_MODE_MISMATCH`.
- Each unauthorized invocation performs relayer lookup, raw transaction hash
  derivation, attempt claim, broadcast, and acceptance marker write.
- Each unauthorized invocation emits `REQUEST_SUBMITTED` and schedules
  `POLL_TRANSACTION_RECEIPT`.
- The relayer control passes, proving the fixture is valid and reaches the real
  attempt-before-I/O/no-rebroadcast path.

## Compile control

```text
npm run typecheck
```

Result: **PASS**.

The production implementation and all previously frozen tests remain unchanged.

## Superseded-fixture reconciliation

The frozen production candidate for reconciliation was:

- Commit: `cd5f20b68cfae78735935396f5ad17651518892b`
- Tree: `bc6c7adebe0ea076b4a014370de36ddf29fe4757`

The candidate satisfies the frozen Slice 011 handler contract. Two older
positive relayer controls still supplied the default wallet manifest and were
therefore stopped by the new authorization boundary before reaching the safety
behavior they were intended to test. The test-only reconciliation changes only
those fixtures:

- the Slice 005 raw-signed-bytes control now loads its existing explicit
  `relayerManifest`, preserving the hash-identity rejection and zero-broadcast
  assertion;
- the Slice 008 durable-attempt control now keeps the loaded manifest and
  `RUN_CREATED` payload on the same explicit relayer manifest, preserving the
  attempt-before-I/O and no-rebroadcast crash recovery assertions.

No production source or frozen Slice 011 expectation changed.

Focused affected controls plus frozen Slice 011:

```text
Test Files  3 passed (3)
Tests       14 passed (14)
```

Full worker suite:

```text
Test Files  19 passed (19)
Tests       116 passed (116)
```

`npm run typecheck` — **PASS**.
