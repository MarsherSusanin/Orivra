# Slice 024A second corrective GREEN — canonical URL attack recording

Status: Production-author candidate; independent Core and Product verification
pending.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Production implementer

Corrective RED commit: `552e057d3909309a2c9420d5d5b85d850fa71c77`

Corrective RED tree: `97e540a9b28aae4a472a49ee847cbd2757af0ebe`

Architecture decision: [ADR 0031](../adr/0031-canonical-url-attack-recording.md)

Slice contract: [024A](../slices/024a-canonical-url-attack-recording.md)

The preceding GREEN candidate `bdaf75ce7d6c0eb59ab5262984c8467e9f17167a`
(`4cbe765b057112727f6fd60356061460d92fd991`) remains rejected. Its small
fixture did not reveal that duplicating three raw calldata values made the
documented 6 MiB representation impossible near the existing 1 MiB response
boundary, and its filesystem error surfaced a repository path and Solidity
filename.

## Implementation

The public recording preserves the exact 6 MiB preparse boundary and unchanged
`ProofBundleV1`. Each embedded canonical bundle is now bounded independently at
2,200,000 UTF-8 bytes and 64 Bytes32 Merkle nodes. The raw `reproduction`
section keeps canonical compiler input/output, six exact source values,
creation/runtime bytecodes and canonical response-shape bytes, but no longer
duplicates consumer calldata or EVM return/revert values.

The pure domain boundary checks the per-bundle byte and Merkle limits before
acceptance, reparses both canonical bundles, and continues to bind all
compiler/source/bytecode/shape material that is derivable from persisted raw
bytes. Transcript calldata and result hashes deliberately remain
non-authorizing claims in pure replay.

The trusted FDC runtime still derives calldata from the official proof ABI,
compiles the exact sources and executes vulnerable/attack, safe/attack and
safe/control in a fresh Cancun `@ethereumjs/vm`. Recording writes only the
derived hashes to the transcript. Verification independently rebuilds and
reexecutes the complete recording, so any transcript-hash mutation fails the
runtime byte comparison before a `runtime-verified` result.

All failures from the injected checked-in-source reader are converted to code
`CANONICAL_SOURCE_READ_FAILED` and exact message
`Canonical URL attack source read failed`, without retaining the raw error as a
public cause. CLI normalization recognizes that code before generic message
handling. The injected CLI and packaged copied-bin cases therefore return exit
`2` with no OS code, absolute path, Solidity filename, stack, output artifact or
unexpected network request.

## Focused and nearest evidence

```sh
npm run typecheck
npx vitest run \
  packages/contracts/test/slice024a-canonical-url-attack-recording.contract.test.ts \
  packages/domain/test/slice024a-canonical-url-attack-recording.contract.test.ts \
  packages/fdc-coston2/test/slice024a-runtime-recording-authority.corrective.contract.test.ts \
  packages/cli/test/slice024a-demo-record.contract.test.ts \
  packages/cli/test/slice024a-bin-runtime-composition.corrective.contract.test.ts
```

Typecheck is PASS. The exact frozen corrective matrix is PASS: 5 files and 85
tests. Its 1,048,000-byte transformed official-ABI case confirms the exact
1,049,056-byte response and 1,049,188-byte calldata measurements, then records,
runtime-verifies and canonical-replays the two bundles inside 6 MiB. Exact
outer-boundary plus one, per-bundle-boundary plus one and Merkle-boundary plus
one reject.

The unchanged public-contract, domain replay/codegen and CLI help baseline is
PASS: 5 files and 74 tests. All FDC and CLI tests are PASS together: 24 files
and 291 tests (FDC 202; CLI 89).

## Coverage, build and safety evidence

```sh
npm run test:core:coverage
npx vitest run packages/cli/test --coverage \
  --coverage.include='packages/cli/src/index.ts' \
  --coverage.thresholds.lines=90 \
  --coverage.thresholds.branches=85
npx vitest run packages/fdc-coston2/test --coverage \
  --coverage.include='packages/fdc-coston2/src/canonical-url-attack-runtime.ts' \
  --coverage.thresholds.lines=90 \
  --coverage.thresholds.branches=85
npm --workspace @proofline/worker run build
npm --workspace @proofline/cli run build
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js demo record --help
git diff --check
```

Contracts/domain coverage is PASS: 40 files and 458 tests with 100% statements,
branches, functions and lines. CLI affected coverage is PASS at 93.17% lines
and 94.65% branches. The corrected FDC runtime is PASS at 100% lines and 95.65%
branches. Worker and CLI builds, root/demo help, missing-config black-box and
copied-bin missing-source black-box are PASS. Targeted source/bundle scans find
no fixture import or frozen token/private-key value in production output.

No checked-in canonical demo is produced. The near-boundary case uses test-only
ABI-valid bundles and proves local representation plus compiler/EVM behavior;
it is not live Coston2, PostgreSQL, Web, Sites, Docker, hosted or deployed
evidence. A real recording remains unavailable until two independently
persisted live bundles are supplied through the scoped API. This production
author cannot serve as either independent verifier.
