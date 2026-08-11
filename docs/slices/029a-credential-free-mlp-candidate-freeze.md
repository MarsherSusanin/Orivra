# Slice 029A — Credential-free MLP candidate freeze

Status: Corrective RED after Core rejected exact candidate `78a85e2` /
`20c0f41` for setup failures bypassing scoped cleanup. A replacement unified
run and two independent same-tree verifiers are pending.

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
- canonical checked-in template/replay expectation bytes and exact worker-
  stopped loopback Compose observation, without database import or live claim;
- fresh no-auth child environment with one allowlisted local Compose plugin and
  no user Docker config; no prefetch/pull/login/push/live Coston2;
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

## Executable handoff

`npm run release:candidate -- --output <absent-path-under-mode-0700-parent>
--wal-g-input <absolute-verified-input>` is the only terminal author command.
It runs the frozen gates serially, creates a fresh 028A release under the stage,
proves the worker-stopped product journey, removes its scoped temporary inputs,
rechecks the exact clean Git identity and atomically publishes the read-only
candidate directory. A local GREEN implementation is not a candidate PASS until
this command and both independent verifiers succeed on one committed tree.

## Explicit exclusions

No DNS, SSH, DigitalOcean, GHCR, Spaces, live Coston2, hosted browser, remote
publication or production promotion belongs to 029A. Scan 8852 remains canceled
and its deferred 027C observation remains open.
