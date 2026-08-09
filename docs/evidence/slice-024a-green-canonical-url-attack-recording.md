# Slice 024A GREEN — canonical URL attack recording

Date: 2026-08-09 (Asia/Vladivostok)

Role: Production implementer

RED commit: `71e1c53ab881ec84878518d7ef34c8d04a6688d3`

RED tree: `9d41bbf5687a577ea7c7b98a1f613c2a45878c6b`

Architecture decision: [ADR 0031](../adr/0031-canonical-url-attack-recording.md)

Slice contract: [024A](../slices/024a-canonical-url-attack-recording.md)

## Implementation

`packages/contracts` now owns the strict recording content and envelope types
and the exact 6 MiB UTF-8 limit. `ProofBundleV1` remains unchanged. The pure
domain boundary creates, validates, canonical-serializes and replays the outer
recording while reparsing both embedded bundle strings through the existing
byte-canonical `replayProofBundle` path. It binds every persisted identity,
the different live runs and source hosts, shared request, compiler/runtime
identities and the ordered vulnerable-attack, safe-attack and safe-control
transcript.

The explicit `proofline demo record` command reads only the two requested
persisted bundles, calls the injected deterministic compiler/EVM recorder once,
replays and reserializes its result through the domain boundary, verifies that
the returned release, run IDs and exact bundle bytes match the request, and
then calls the injected atomic-write port. The Node entry point implements the
atomic file port with a same-directory exclusive temporary file, file sync,
rename and error cleanup. There is no default fixture, replay fallback, wallet
or relayer signing path, environment forwarding or network call outside the
persisted API port.

`@proofline/cli` now declares its one-way workspace dependency on
`@proofline/domain`; there is no package cycle and no duplicated integrity
implementation.

## Focused and nearest evidence

```sh
npm run typecheck
npx vitest run \
  packages/contracts/test/slice024a-canonical-url-attack-recording.contract.test.ts \
  packages/domain/test/slice024a-canonical-url-attack-recording.contract.test.ts \
  packages/cli/test/slice024a-demo-record.contract.test.ts
```

Typecheck is PASS. The exact frozen 024A matrix is PASS: 3 files, 41 tests.

The focused matrix plus unchanged public contracts, domain replay/codegen and
CLI help/adapter baselines is PASS: 7 files, 69 tests. All CLI tests are also
PASS: 9 files, 63 tests.

## Coverage, build and safety evidence

```sh
npm run test:core:coverage
npx vitest run packages/cli/test --coverage \
  --coverage.include='packages/cli/src/index.ts' \
  --coverage.thresholds.lines=90 \
  --coverage.thresholds.branches=85
npm --workspace @proofline/cli run build
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js demo record --help
git diff --check
```

Contracts/domain coverage is PASS: 40 files and 449 tests, with 100% statements,
branches, functions and lines. CLI coverage is PASS: 93.93% lines and 94.77%
branches (93.49% statements and 92.85% functions). The CLI build and both help
paths are PASS. A targeted generated/source scan contains none of the frozen
project-token, wallet-secret, relayer-secret or Bearer values.

No checked-in canonical demo is produced by this slice. These credential-free
tests exercise injected ports and are not live compiler/EVM, Coston2, hosted,
PostgreSQL, Web, Sites or Docker evidence. A real recording remains unavailable
until the recorder port is backed by actual deterministic compilation/execution
and two independently persisted live bundles. The unified credential-free
022–029A matrix remains the candidate-freeze gate.
