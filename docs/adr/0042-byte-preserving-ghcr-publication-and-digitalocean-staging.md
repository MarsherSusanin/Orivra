# ADR 0042: Byte-preserving GHCR publication and DigitalOcean staging

- Status: Accepted contract; corrective RED after Core rejected `5322125` / `bad14e5`
- Date: 2026-08-12
- Refines: ADR 0029, ADR 0035, ADR 0036, ADR 0037, ADR 0039, ADR 0041

## Context

Slice 029A is complete on exact commit
`fc2f6e0677c64dc4f2ee90a85219bcc9f8c9bfbc` / tree
`f7cebc6ed3842f296b3be1c96645e2dd8cdfe5bd`. Its canonical candidate SHA-256
is `8991e7e49f4570702436c269c8f6bd0af7b8f186997bff2a52e6da22f7a0cdda`.
Core and Product independently PASS that exact tree. This authorizes an
operator to provide narrowly scoped 028B credentials, but does not itself
publish a registry image, provision a VDS or prove hosted staging.

The Git remote is `github.com/MarsherSusanin/Orivra`. Git repository identity
does not select GHCR package names. The five destination repositories must be
an explicit canonical input. Likewise, current Docker/Buildx behavior has not
yet proved a byte-preserving single-manifest push to GHCR, so this ADR freezes
an adapter contract and evidence, not an unverified shell command.

## Decision

### Immutable inputs and authorization

028B consumes, read-only:

1. the exact final 029A candidate directory with its canonical candidate,
   recorded fixture, frozen manifest, receipt and five OCI archives;
2. the exact Core and Product PASS report bytes for the same producer;
3. one canonical `GhcrPublicationTargetsV1` file supplied explicitly by the
   operator; and
4. explicit run/operator metadata plus file-backed credentials.

The target input is strict canonical JSON with version `1`, kind
`ghcr-publication-targets`, registry `ghcr.io` and the exact ordered tuple
`caddy`, `web`, `api`, `worker`, `postgres-recovery`. Each entry binds its
accepted `proofline/*` source repository to one unique lowercase
`ghcr.io/<owner>/<package>` destination without tag or digest. No default,
Git-remote inference or package-name derivation is permitted.

Before any registry or infrastructure effect, the preflight re-parses and
byte-checks the candidate, manifest, receipt, target input and both reports;
checks exact commit/tree and checksums; streams size/SHA/mode validation for all
receipt artifacts; and inspects all five OCI archives. Any mismatch causes
zero registry, SSH or DigitalOcean call.

### OCI and registry boundary

`archiveSha256` authenticates the exact local ustar bytes. It is never compared
with a registry digest. A bounded no-follow archive reader accepts only regular
canonical `oci-layout`, `index.json` and `blobs/sha256/<digest>` entries,
rejects traversal, links, duplicates, extras, missing/reachable mismatches and
oversize input, and proves one Linux/amd64 OCI image manifest plus its exact
config/layer blobs.

The `RegistryPublicationAdapter` copies that verified manifest and reachable
blobs without build, load/rebuild, repack, media-type conversion or index
creation. All five archives are verified before the first registry effect.
After each copy the adapter independently reads the GHCR remote digest; it must
equal only the frozen `imageManifestDigest`. A tag, an index digest,
`archiveSha256`, mismatch or converted manifest fails closed.

An upload `Location` is accepted only on HTTPS default port 443 and within the
exact normalized `/v2/<same-repository>/blobs/uploads/…` namespace. Cross-port,
cross-repository and arbitrary same-host paths are rejected before attaching a
bearer token or request body.

No specific Docker, Buildx, Skopeo or ORAS command is accepted by this ADR.
GREEN must prove that its chosen adapter preserves the single-manifest digest
against GHCR before it may produce evidence.

The local implementation selects the OCI Distribution HTTP API directly. It
uploads only missing reachable blobs, writes the exact frozen OCI manifest by
its digest, and re-reads `Docker-Content-Digest`; it performs no Docker load,
build, repack, tag or index creation. `release:publish` is fixed to the exact
accepted 029A candidate and verifier report checksums. This code boundary is
locally GREEN, but it is not registry evidence until an approved package-write
credential and explicit canonical target map complete a real GHCR run.

### Publication evidence

`PublicationEvidenceV1` is strict canonical JSON, version `1`, kind
`oci-publication-evidence`, status/verification `passed`/`verified` and
`publicationClaim: true`. It contains run ID, redacted operator ID, canonical
UTC completion time, exact producer, candidate/Core/Product report SHA-256,
frozen manifest/receipt/inventory SHA-256, target-input SHA-256 and the exact
ordered five-image tuple. Each image binds source repository, archive
filename/size/SHA, platform, image manifest digest, remote repository,
`remoteDigest` and immutable `remoteReference`; remote digest equals only the
image manifest digest.

The evidence contains no token, secret, credential path, absolute candidate
path or mutable tag. Its checksum is over exact canonical UTF-8 and is not
embedded in itself. `publication-evidence.v1.json` is written only after all
five remote checks pass, through an injected conditional-create append-only
sink. An existing key/file is never overwritten or deleted. The frozen 029A
directory, its release manifest, receipt and OCI archives are never changed.
Publication returns canonical evidence bytes/checksum to its caller and never
invokes staging with a mutable in-memory evidence object; staging is a separate
explicit handoff invocation.

### DigitalOcean staging

Staging consumes exact publication-evidence bytes and checksum. It provisions
or selects only an isolated `staging` target with a pinned SSH host key,
separate Compose project/networks/volumes/origin/secrets and the ADR 0029
80/443-only ingress boundary. Production resources are never an accepted 028B
target.

The VDS pull credential is read-only and limited to the five mapped GHCR
repositories. Because production Compose uses `pull_policy: never`, the 028B
orchestrator explicitly pulls all five `repository@sha256` references, then
rechecks local `RepoDigests` before Compose. Image IDs map exactly to
`PROOFLINE_CADDY_IMAGE`, `PROOFLINE_WEB_IMAGE`, `PROOFLINE_API_IMAGE`,
`PROOFLINE_WORKER_IMAGE`, and—despite its release ID—
`PROOFLINE_POSTGRES_IMAGE` for `postgres-recovery`.

The staging sequence is PostgreSQL, login-role bootstrap, one-shot checksummed
migrator, API, real production worker, Web and Caddy; then health, schema-aware
readiness with a current real-worker heartbeat, hosted browser/API smoke,
Spaces-backed PITR restore evidence and a bounded persisted live Coston2 gate.
No test-only heartbeat, fixture import or synthetic live PASS is allowed.

`StagingDeploymentEvidenceV1` is a separate canonical append-only record. It
binds publication-evidence SHA, frozen-manifest SHA, producer, DigitalOcean
staging target, pinned host key, exact five remote digest references, read-only
pull capability, schema/migration, readiness, browser, restore and live
evidence. It never mutates publication evidence.

The staging adapter accepts only canonical `PublicationEvidenceV1` bytes plus
an independently supplied checksum and the complete candidate/manifest/
receipt/target/report handoff. One strict verifier cross-binds the producer,
all canonical input bytes and checksums, receipt inventory and the complete
ordered image tuple before any DigitalOcean or SSH call. A legacy object,
noncanonical bytes, self-derived checksum or substituted manifest is not pull
authority.

Every remote observation is a strict typed result. A failed, incomplete or
extra-field result blocks before evidence append. Successful orchestration
derives the complete `StagingDeploymentEvidenceV1` from those observations,
schema-parses it and emits only exact canonical UTF-8. The authenticated
DigitalOcean control-plane endpoint and expected SSH host-key digest establish
one pinned session before the first command; the independently observed key
must match, every command uses that session and the evidence records the
observed value.

Successful staging closes only local credential/session resources and leaves
the accepted staging infrastructure running for verification. Failure closes
those local resources and may additionally tear down only the run-owned failed
staging deployment. One generic cleanup callback may not destroy successful
staging while still emitting PASS.

Archive authentication, OCI parsing and registry upload share one
`O_RDONLY|O_NOFOLLOW` file descriptor (or an equivalent immutable private
capture). Metadata, full archive checksum, descriptor ranges and bounded blob
streams remain tied to that identity. Five descriptors may be authenticated
before registry I/O, but layer payloads are never retained across all five in
memory; each lease closes exactly once on success or failure.

### Credentials, diagnostics and failure

All authority is supplied through distinct mode-0400 files below private
mode-0500 roots: package-write GHCR token for the local publisher, package-read
GHCR token for staging, least-scope DigitalOcean API token, restricted staging
SSH key, and the already frozen staging application/worker/PostgreSQL/Spaces
secret set. Direct secret environment values, argv secrets, user Docker config,
credential helpers, agent forwarding and credential-bearing proxy settings are
rejected. Secret contents and paths never enter logs or evidence.

Failure before the first effect leaves no remote or staging mutation. A partial
GHCR publication produces no PASS evidence and never starts staging; its
redacted non-authorizing report lists only completed image IDs and the failed
ID. Cleanup removes only run-owned local auth/config/temp/aliases and never
deletes shared digest content or pre-existing packages/tags. A staging failure
retains truthful publication evidence, writes no staging PASS and removes only
run-owned isolated staging resources. Original and cleanup failures are
reported deterministically in that order.

## Consequences

- RED and unit tests use import-safe fake registry, DigitalOcean and SSH
  adapters, no credentials or network. Credentialed GREEN/execution is later
  and requires explicit operator approval.
- Partial publication may leave harmless untrusted remote blobs; absence of
  canonical publication evidence prevents their use.
- 029B alone owns production promotion and canary. 028B never targets
  production, promotes PostgreSQL or claims a production deployment.
- Scan 8852 remains user-canceled and is not a security PASS; its deferred 027C
  evidence-integrity risk remains open.
