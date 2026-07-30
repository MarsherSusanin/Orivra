# Slice 001 GREEN evidence — contracts and pure domain

Recorded against RED parent `7b98210` on 2026-07-30.

## Implemented boundary

- Strict versioned Zod schemas and inferred types for manifests, events, projections,
  diagnostics, normalized errors, and proof bundles.
- Deterministic safe-GET URL canonicalization and evidence-backed consumer invariant
  diagnostics.
- Append-only, strictly sequenced, idempotent run journals and monotonic six-stage
  projections with terminal-state enforcement.
- Portable canonical JSON and SHA-256 proof-bundle checksums with mutation-safe replay.
- Byte-identical safe Solidity consumer generation using the registry-resolved
  `FdcVerification` contract.

The frozen tests, fixtures, and Solidity golden file were not edited.

## GREEN commands

```text
$ npm run test:contracts
Test Files  1 passed (1)
Tests       18 passed (18)

$ npm run test:core
Test Files  4 passed (4)
Tests       25 passed (25)

$ npm test
Test Files  6 passed (6)
Tests       46 passed (46)

$ npm run typecheck
exit 0
```

The portable SHA-256 implementation was also compared with Node `crypto` for the
empty string, `abc`, and a non-ASCII `Proofline ✓` vector; all digests matched.

## Coverage observation

`npm run test:coverage` is green and reports 96.55% statements / 100% branches for
`packages/contracts/src`, and 93.29% statements / 81.70% branches for
`packages/domain/src`. The frozen RED suite does not yet exercise malformed JSON,
invalid-URL, non-finite canonical JSON, and several defensive journal branches. No
coverage suppression was added; closing the plan's 100% pure-core gate requires a
new Contract/Test Designer RED wave rather than editing frozen tests in this GREEN
wave.
