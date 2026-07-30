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
