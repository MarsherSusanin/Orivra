# ADR 0039 — Offline OCI release freeze

## Status

Accepted contract; second corrective RED. Core confirmed the first six fixes
but rejected replacement `1d3324d` / `473c534` because OCI `EEXIST` cleanup
deleted a caller-owned archive. Replacement and both verifiers are pending.

## Context

ADR 0029 requires a credential-free local release composition before any GHCR
or DigitalOcean operation. The repository already builds the runtime images,
but its 027A/027C Docker gates create mutable QA tags, may build twice, and do
not export immutable archives. They are regression evidence, not a frozen
release handoff.

Slice 027D is complete on exact commit
`3d57840f699c6815502a19b13a5f803ef2b95cbc` / tree
`fc7643f3ec5ab57998ba61f0ee55e1805a7e2143`. Core PASS report SHA-256 is
`sha256:16b90f11b3ad91759b18c248f176d756b94491b0eed43c36f84787d26f096ce3`;
Product PASS report SHA-256 is
`sha256:8c15ee12b3937c56984f10aa0c50af6888784774a8d63d9b3560d112e78f5137`.
Both are targeted local module reviews, not release authorization. Scan 8852
remains user-canceled, is not a security PASS, and its deferred 027C
inventory-digest validation risk remains open.

## Decision

### Exact inventory and archive identity

028A produces exactly five Linux/amd64 release images, in this order:

1. `caddy` — repository `proofline/caddy`;
2. `web` — repository `proofline/web`;
3. `api` — repository `proofline/api`;
4. `worker` — repository `proofline/worker`;
5. `postgres-recovery` — repository `proofline/postgres-recovery`.

Node, upstream Caddy/PostgreSQL bases, MinIO and `minio/mc` remain locked
build/QA inputs. They are not release archives. The fifth release image is the
custom PostgreSQL 17 image containing the exact WAL-G runtime used by the
production backup overlay.

Each image is built once from the same private source snapshot. Buildx exports
an OCI Image Layout 1.0.0 directory with exact options equivalent to:

```text
docker buildx build --platform linux/amd64 --pull=false --network=none \
  --provenance=false --sbom=false \
  --output type=oci,dest=<private-layout>,tar=false,oci-mediatypes=true,rewrite-timestamp=true \
  ... <private-source-root>
```

The caller supplies `SOURCE_DATE_EPOCH` derived from the captured commit. The
exporter capability is checked before any build. Missing OCI directory output,
`rewrite-timestamp`, platform or named-context support fails closed; 028A does
not download another buildx or BuildKit.

A deterministic local packer writes one uncompressed POSIX ustar per layout.
It accepts only `oci-layout`, `index.json` and reachable regular
`blobs/sha256/<64-hex>` files; rejects symlinks, traversal, duplicates,
unreferenced blobs, size mismatch and digest mismatch; writes byte-sorted
entries with uid/gid/mtime zero and fixed regular-file mode; and reproduces
identical bytes when packing the same layout twice. Archive filenames are:

- `images/01-caddy.linux-amd64.oci.tar`;
- `images/02-web.linux-amd64.oci.tar`;
- `images/03-api.linux-amd64.oci.tar`;
- `images/04-worker.linux-amd64.oci.tar`;
- `images/05-postgres-recovery.linux-amd64.oci.tar`.

`imageManifestDigest` is the SHA-256 digest of the exact single OCI image
manifest selected by `index.json`. The selected descriptor and image config
must both be Linux/amd64. An index, attestation, wrong-platform or ambiguous
descriptor is rejected. `archiveSha256` is the SHA-256 of the complete ustar
bytes. These values are different namespaces and are never compared.
`reference` is exactly `<repository>@<imageManifestDigest>`.

### Producer and external input authority

The release command accepts only a clean Git candidate. It captures `HEAD`,
derives `<commit>^{tree}`, materializes that commit into a private snapshot,
records a canonical snapshot-inventory SHA-256, and makes directories `0500`
and files `0400`. Every Dockerfile, migration, Action and archive input is read
from this snapshot. A dirty tree has no 028A draft mode.

Immediately before terminal publication the command rechecks exact HEAD,
commit-derived tree and empty porcelain status. Mutation, replacement,
symlink, wrong permission or cleanup failure leaves no frozen output.

WAL-G is not silently fetched or read from a mutable ignored directory. The
caller must provide a private input root containing the binary and canonical
receipt. 028A opens both as bounded regular no-symlink files, verifies the
checked-in `docker/wal-g-release.v1.json`, size, mode and exact hashes at use
time, copies the verified bytes into a separate private named build context,
and removes it before publication. Missing input fails closed. No local image
ID is a frozen authority.

### Frozen manifest and receipt

`FrozenOciReleaseManifestV1` is strict canonical UTF-8 JSON with:

- exact verified producer commit/tree, source snapshot SHA-256 and
  commit-derived `sourceDateEpoch`;
- the exact ordered five-image tuple; each entry contains `id`, `repository`,
  immutable `reference`, `platform`, archive filename/format/size,
  `archiveSha256` and `imageManifestDigest`;
- raw checksum and exact `10/10/10` compatibility values from
  `apps/api/db/migrations/manifest.v1.json`;
- raw checksums for `packages/action/action.yml` and the byte-synchronized
  `packages/action/dist/index.js`;
- WAL-G version, checked-in release-lock checksum, caller receipt checksum and
  verified binary checksum.

The manifest cannot contain its own checksum. After all archive bytes exist,
`FrozenOciReleaseReceiptV1` stores `frozenReleaseManifestSha256`, exact
producer identity, and a sorted inventory of the manifest plus five archives.
Its `artifactInventorySha256` hashes the canonical inventory. The receipt is
excluded from its own inventory. Neither record contains an operator,
credential, remote repository, deployment timestamp or pull authorization.

### Offline execution and lifecycle

028A runs with a fresh no-auth Docker CLI directory and an exact minimal child
environment. It accepts only a validated local Unix Docker socket, strips
ambient registry/cloud/GitHub/proxy/SSH/BuildKit/token/key authority, and never
invokes prefetch, pull, login, push, `imagetools`, registry access or an
external network. All builds use `--pull=false` and `--network=none`. Missing
previously fetched base/npm/WAL-G bytes or missing local buildx capability is a
failure, not permission to fetch.

The caller output path must be absent. Work occurs in a private mode-`0700`
sibling stage with mode-`0600` files. Source/WAL-G snapshots, temporary Docker
configuration and scoped build resources are finalized before publication.
Only after every validation and the final Git recheck does one atomic rename
publish a mode-`0500` directory containing mode-`0400` files. Any failure,
including rename-then-throw, removes both stage and scoped final output. A
successful output is preserved read-only for 028B; cleanup is a separate,
receipt-validated exact-path operation.

### Downstream boundary

029A owns the unified credential-free matrix and its separate authorization
receipt. It references `frozenReleaseManifestSha256`; it never edits the 028A
manifest, receipt or archives. 028B may later verify `archiveSha256` and
perform byte-preserving publication without rebuild, then compare the remote
digest only with `imageManifestDigest`.

## Consequences

028A adds pure release contracts/domain derivation plus local orchestration; it
does not add a migration, service, port, credential, scanner, SBOM, license or
SLSA policy. Existing Docker, PostgreSQL, recovery, Action and Sites gates stay
as nearest controls and retain their original meaning.
