# Slice 029A — Credential-free MLP candidate freeze

Status: Intentional RED. Contracts and lifecycle are frozen before production
implementation.

Architecture authority: [ADR 0041](../adr/0041-credential-free-mlp-candidate-freeze.md).

## Outcome

One clean committed tree passes the complete local matrix, recorded-fixture
production Compose journey and a fresh offline five-image OCI freeze. A strict
canonical receipt binds all three without credentials, external network,
registry access or deployment claims.

## Frozen boundary

- exact producer commit/tree across candidate, OCI manifest and OCI receipt;
- exact ordered 17-gate PASS tuple;
- fresh frozen-release manifest/receipt/inventory checksums;
- canonical recorded fixture bytes and exact worker-stopped loopback Compose
  observation;
- fresh no-auth child environment; no prefetch/pull/login/push/live Coston2;
- caller-owned 0700 parent, private staging, 0400 files, 0500 final directories,
  atomic publication and scoped no-follow cleanup;
- final Git identity recheck immediately before publication;
- two independent release-verifier PASS reports on the same final tree before
  credentials may authorize 028B.

## RED files

- `packages/contracts/test/slice029a-credential-free-candidate.contract.test.ts`
- `packages/domain/test/slice029a-candidate-evidence.contract.test.ts`
- `tests/deployment/slice029a-unified-candidate.contract.test.mjs`
- `tests/deployment/slice029a-recorded-product-compose.contract.test.mjs`

## Explicit exclusions

No DNS, SSH, DigitalOcean, GHCR, Spaces, live Coston2, hosted browser, remote
publication or production promotion belongs to 029A. Scan 8852 remains canceled
and its deferred 027C observation remains open.
