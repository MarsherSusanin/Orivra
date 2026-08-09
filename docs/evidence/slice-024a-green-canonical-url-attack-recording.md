# Slice 024A rejected GREEN — canonical URL attack recording

Status: Rejected by independent Core and Product verification on
`bdaf75ce7d6c0eb59ab5262984c8467e9f17167a` /
`4cbe765b057112727f6fd60356061460d92fd991`.

This file is historical production-author evidence, not an independent PASS.
Its 76-test PASS did not exercise an official-ABI near-maximum recording. The
representation duplicated two proof responses into three raw calldata values
and accepted results: a 1,048,000-byte transformed payload requires at least
10,491,362 hex characters before compiler and JSON overhead, so the claimed
6 MiB maximum-bound support was false. Source-read errors also exposed absolute
repository paths and Solidity filenames through the packaged CLI. Corrective
acceptance is defined by ADR 0031 and the later RED evidence; none of the PASS
claims below approve the rejected tree.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Production implementer

Corrected RED commit: `546d2f1141d4fc6b813892ab29093dce7a3d9fc2`

Corrected RED tree: `fc5bc70b620f08db27e8dfe3f10edb8581916dae`

Architecture decision: [ADR 0031](../adr/0031-canonical-url-attack-recording.md)

Slice contract: [024A](../slices/024a-canonical-url-attack-recording.md)

## Implementation

`packages/contracts` now owns the strict recording content and envelope types,
the exact 6 MiB UTF-8 limit and bounded raw reproduction material: canonical
compiler input/output, six exact sources, raw bytecodes, canonical response
shape and the ordered calldata/return/revert tuple. `ProofBundleV1` remains
unchanged. The pure domain boundary creates, validates, canonical-serializes
and replays the outer recording while reparsing both embedded bundle strings
through the existing byte-canonical `replayProofBundle` path. It derives every
source, bytecode, shape, calldata and result hash from raw bytes. This pure
boundary explicitly establishes byte integrity only and is not runtime
authority.

`packages/fdc-coston2` now provides the concrete trusted recorder and verifier.
It decodes both persisted proof responses with the official verification ABI,
rereads the three exact checked-in consumer/invariant sources, generates an
exact-proof-hash verifier shim, compiles canonical pinned `solc` standard JSON,
and executes vulnerable/attack, safe/attack and safe/control in a fresh Cancun
`@ethereumjs/vm`. Verification independently rebuilds and byte-compares the
entire recording before returning a checksum-bound `runtime-verified` result.
The adapter has no network or signing behavior.

The explicit `proofline demo record` command reads only the two requested
persisted bundles after strict grammar validation, calls the deterministic
compiler/EVM recorder once, requires a separate runtime verification before
pure replay, verifies the checksum, release, run IDs and exact bundle bytes,
and then calls the injected atomic-write port. The packaged Node entry point
always wires the concrete runtime and implements the atomic file port with a
same-directory exclusive temporary file, file sync, rename and error cleanup.
Missing API configuration returns bounded exit `2` without a stack or absolute
path. There is no default fixture, replay fallback, wallet or relayer signing
path, environment forwarding to the recorder or network call outside the
persisted API port.

The ADR-authorized dependencies are explicit: the FDC package owns official
artifacts, pinned compiler/EVM and ABI tooling, while CLI has a one-way
workspace dependency on FDC. There is no package cycle or duplicated runtime
integrity implementation.

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

Typecheck is PASS. The exact corrected frozen 024A matrix is PASS: 5 files, 76
tests. Contracts/domain are 36/36, the concrete runtime is 6/6, strict CLI is
32/32 and packaged composition is 2/2.

The unchanged public contracts, domain replay/codegen and CLI help baselines
are PASS: 5 files, 74 tests. All FDC and CLI tests are PASS together: 24 files,
285 tests (FDC 199; CLI 86).

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

Contracts/domain coverage is PASS: 40 files and 455 tests, with 100% statements,
branches, functions and lines. CLI affected coverage is PASS: 93.10% lines and
93.92% branches. The new FDC runtime is PASS at 100% lines and 91.30% branches.
The FDC consumer worker build, CLI build, both help paths and missing-config
black-box exit `2` are PASS. A targeted generated/source scan contains none of
the frozen project-token, wallet-secret, relayer-secret or Bearer values.

No checked-in canonical demo is produced by this slice. These credential-free
tests execute the real local compiler/EVM runtime over test-only ABI-valid
bundles, but are not live Coston2, hosted, PostgreSQL, Web, Sites or Docker
evidence. A real recording remains unavailable until two independently
persisted live bundles are supplied through the scoped API path. The unified
credential-free 022–029A matrix remains the candidate-freeze gate, and this
production author is not either independent verifier.
