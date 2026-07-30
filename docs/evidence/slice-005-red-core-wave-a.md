# Slice 005 RED evidence — final core remediation wave A

## Baseline

- Parent commit: `e93f190c4d69b8d70ec67a43f434db7dc1a9a377`
- Scope: hermetic contract tests and RED evidence only; production source and
  configuration are frozen.
- External dependencies: none for this first commit. No public network, Docker,
  Testcontainers, Coston2, or real clock is used.

## Frozen contracts

- The SSRF boundary rejects the special-use IPv6 prefixes `2001:2::/48`,
  `3fff::/20`, and `2001:20::/28` in addition to the previously covered
  documentation, ORCHID, discard, translation, 6to4, unique-local, link-local,
  and multicast representatives.
- Replay accepts only canonical input bytes. A valid outer checksum cannot hide
  pretty/noncanonical bytes, a mismatched `PROOF_AVAILABLE.proofHash`, or a
  missing/mismatched deterministic safe-consumer artifact.
- Production replay computes `byteIdentical` from canonical serialization; a
  literal `true` is forbidden.
- Generated query invariants use the same percent-encoded values as
  `URLSearchParams`, including space, plus, and ampersand cases.
- Concurrent identical `createRun` calls resolve to one persisted run. A
  concurrent idempotency-key collision with different intent is a stable 409,
  never a leaked PostgreSQL `23505`.
- Receipt persistence does not emit `ROUND_FINALIZED`. That lifecycle event is
  appended only after Relay confirms finalization.
- Retry exhaustion emits stable terminal evidence, and an active long-running
  command renews its lease repeatedly.
- Relayer signing consumes persisted project/global caps, quota, and balance
  floor. Persisted fingerprints and raw-transaction hashes are verified before
  broadcast.
- The worker may update only the relayer transaction's broadcast marker, not
  arbitrary immutable transaction identity columns.

## Focused RED command

```text
npx vitest run \
  packages/domain/test/final-security-replay-codegen.contract.test.ts \
  apps/api/test/concurrent-create-run.contract.test.ts \
  apps/worker/test/final-lifecycle-relayer.contract.test.ts
```

Observed result: **3 files failed, 18 tests failed, 10 tests passed**.

The ten controls demonstrate that the suites collect, known special-use ranges
remain denied, public IPv6 remains eligible, and a canonical evidence-complete
bundle still replays. The eighteen semantic RED failures expose:

1. three uncovered special-use IPv6 ranges;
2. acceptance of noncanonical bundle bytes, proof-hash drift, and generated
   artifact drift;
3. hardcoded replay `byteIdentical`;
4. raw rather than URL-canonical query values in codegen;
5. leaked concurrent unique violations for both identical and conflicting run
   intent;
6. premature round finalization and a Relay poll coupled to that premature
   event;
7. unbounded retry behavior and a one-shot lease renewal;
8. absent persisted relayer policy, fingerprint verification, and
   raw-transaction hash verification;
9. blanket worker update permission on relayer transactions.

These are expected behavior failures. There are no unresolved imports, fixture
construction failures, real-time waits, or accidental external requests.

## Compile gate

```text
npm run typecheck
```

Observed result: **PASS**.

The separate behavioral Solidity/EVM contract and its exact test dependencies
are intentionally ordered after this compact RED commit.
