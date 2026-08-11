# Slice 028A — Offline OCI release freeze

Status: Corrective production-author GREEN locally after Core rejected exact
candidate `5613640` / `6b1d3a0`; final freeze and both independent verifiers
are pending on one replacement tree.

Architecture authority: [ADR 0039](../adr/0039-offline-oci-release-freeze.md).

## Outcome

One credential-free local command builds the exact Caddy, Web, API, worker and
PostgreSQL-recovery Linux/amd64 images once, exports deterministic OCI
image-layout archives, verifies their independent archive/image identities and
atomically publishes a canonical frozen manifest plus checksum receipt.

Accepted prerequisite: Slice 027D Core and Product independently PASS exact
commit `3d57840f699c6815502a19b13a5f803ef2b95cbc` / tree
`fc7643f3ec5ab57998ba61f0ee55e1805a7e2143`. Their report SHA-256 values are
recorded in ADR 0039. Scan 8852 remains canceled/not a security PASS and its
deferred 027C risk remains open.

## Delivery split

### 028A1 — pure identity contracts

- add strict `FrozenOciReleaseManifestV1` and
  `FrozenOciReleaseReceiptV1` feature contracts;
- derive the fixed five-image tuple, canonical JSON/checksums, OCI manifest
  identity and artifact inventory without I/O;
- keep feature modules cycle-free, side-effect-free and absent from the worker
  bundle unless actually imported.

### 028A2 — private build and archive boundary

- capture one clean immutable commit snapshot and exact commit-derived tree;
- accept one caller-owned use-time verified WAL-G binary/receipt input;
- build each release image exactly once with local buildx, Linux/amd64,
  `pull=false`, `network=none`, no attestations and OCI directory output;
- normalize each accepted OCI layout into deterministic uncompressed ustar;
- prove the API image binds migration manifest 10/10/10 and the source binds
  the byte-synchronized Action metadata/artifact.

### 028A3 — terminal freeze and handoff

- recompute every archive and image-manifest digest;
- stage strict canonical manifest/receipt privately;
- finalize all scoped resources and recheck exact clean Git identity;
- atomically publish only the exact seven-file output (five archives, manifest,
  receipt) read-only; remove every scoped artifact on any failure;
- hand immutable bytes to 028B without registry, credentials or rebuild.

## Production-author result

The frozen contracts are implemented without changing their public boundary.
Typecheck, focused contracts, package purity, serialized Docker static, exact
contracts/domain coverage and the real offline five-image freeze pass. The
author run used a clean private commit snapshot, a caller-owned verified WAL-G
input, no pull, no build network, no registry and no credentials. It published
exactly five deterministic OCI archives plus canonical manifest and receipt,
then independently rechecked their hashes, modes and bounded tar inventories.

The author result is not either independent verifier PASS, a unified 029A
matrix, registry publication, hosted deployment or security evidence. A final
freeze from the documented committed tree is the immutable input to the two
028A verifiers.

## Exclusions

No SBOM/scanner/license/SLSA scope, dependency or lock change, Compose/service/
port/migration change, network/prefetch, registry/GHCR push,
DigitalOcean/SSH/DNS/Spaces/live-Coston2 effect, hosted claim or unified 029A
matrix belongs to this slice.

## Acceptance

- strict contract/domain coverage is 100% statements and branches;
- typecheck, focused 028A tests, retained package purity, migration-manifest,
  Action artifact, Docker static and Sites compatibility pass;
- the GREEN Docker gate uses the exact five builds once, no pull/network,
  validates and re-packs all five OCI layouts, and cleans its unique resources;
- Core and Product verifiers inspect one stopped implementation tree;
- 029A later runs the unified matrix and creates a separate authorization
  receipt bound to `frozenReleaseManifestSha256`.
