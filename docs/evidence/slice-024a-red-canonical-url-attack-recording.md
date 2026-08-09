# Slice 024A RED evidence — canonical URL attack recording

Date: 2026-08-09 (Asia/Vladivostok)

Role: Contract & Test Designer

Starting commit: `3b5f16ec4ffee7239564191b040aa69125937e6f`

Starting tree: `331e42d2e6ce756a0a3f614aad4911d165f34c8a`

Architecture decision: [ADR 0031](../adr/0031-canonical-url-attack-recording.md)

Slice contract: [024A](../slices/024a-canonical-url-attack-recording.md)

## Scope assertion

This wave adds tests, test fixtures and documentation only. It does not add or
change public schema implementation, domain implementation, CLI production
code, dependencies, generated distribution, contracts, API, PostgreSQL,
worker, Action, Web, Sites, Docker or credentials. `ProofBundleV1` remains
unchanged.

The test fixture constructs two different existing `ProofBundleV1` values and
reparses both through current `replayProofBundle` before reaching the missing
024A schema assertion. They are test inputs only and are explicitly invalid as
shippable live recording provenance.

## Clean starting baseline

Before the RED files were added:

```text
npm run typecheck
PASS

npm run test:contracts
PASS — 17 files, 246 tests

npm run test:core
PASS — 21 files, 173 tests

npm test -- --run \
  packages/cli/test/cli-contract.test.ts \
  packages/cli/test/slice008-offline-help.contract.test.ts
PASS — 2 files, 19 tests
```

After the RED files and docs were present, the nearest unchanged baseline was
repeated:

```text
npm run typecheck
PASS

npx vitest run \
  packages/contracts/test/public-contracts.test.ts \
  packages/domain/test/bundle-replay.test.ts \
  packages/domain/test/codegen.test.ts \
  packages/cli/test/cli-contract.test.ts \
  packages/cli/test/slice008-offline-help.contract.test.ts
PASS — 5 files, 74 tests
```

This is a local baseline, not hosted CI, merge-queue, Docker, deployed or live
Coston2 evidence.

## Intentional RED command

```text
npx vitest run \
  packages/contracts/test/slice024a-canonical-url-attack-recording.contract.test.ts \
  packages/domain/test/slice024a-canonical-url-attack-recording.contract.test.ts \
  packages/cli/test/slice024a-demo-record.contract.test.ts
```

Result: expected failure — 3 files failed, all 41 tests failed.

Exact missing behavior:

- contracts: `CanonicalUrlAttackRecordingContentV1Schema`,
  `CanonicalUrlAttackRecordingV1Schema` and
  `CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES` are undefined;
- domain: create, validate, canonical-serialize and replay recording exports are
  undefined;
- CLI: help has no `demo record` contract and execution returns only
  `Unsupported Proofline command`, so exact option, port, failure and atomic
  output assertions fail.

Every table-driven negative case first requires its missing 024A boundary or an
exact 024A CLI error. No new test passes merely because an undefined function
throws or because the generic unsupported-command path returns exit code 2.

## Frozen acceptance matrix

The 41 RED cases freeze:

- strict schema/content/checksum/6 MiB boundaries and unknown-key rejection;
- unchanged, byte-canonical embedded `ProofBundleV1` values;
- two different persisted-live-only wallet/relayer runs with exact checksum,
  canonical byte SHA/size, last sequence, transaction, round, proof and URL;
- same GET query/JQ/ABI/transformed shape and different attack/control hosts;
- release, compiler, source, creation/runtime bytecode, proof and calldata
  identities;
- exact vulnerable-accepts-attack, safe-rejects-attack-with-`HostMismatch()`,
  safe-accepts-control transcript;
- outer checksum, noncanonical/truncated/oversized input and redaction mutation
  detection;
- explicit two-run CLI recorder, required release/output options, one recorder
  call, atomic-only output, failure preservation, zero test network, no signing
  or secret forwarding, and no replay/synthetic/test/default fallback.

The production implementer must make these tests GREEN without weakening their
public contracts. Runtime GREEN must execute the compiler/EVM path; returning
the fixture's expected transcript object is not acceptance evidence.

