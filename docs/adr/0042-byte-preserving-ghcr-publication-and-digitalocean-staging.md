# ADR 0042: Byte-preserving GHCR publication and DigitalOcean staging

- Status: Accepted contract; historical GHCR publication complete; refreshed
  Timeweb direct-pilot publication pending
- Date: 2026-08-12
- Refines: ADR 0029, ADR 0035, ADR 0036, ADR 0037, ADR 0039, ADR 0041

## Context

The current release candidate is complete on exact commit
`a5e80026f23d38e40b9c354ec6488daffad87ba4` / tree
`fae0294cc980d69e2c82a2a1cb9ea02705c95655`. Its canonical candidate SHA-256
is `c371e812cbd07f36955efef624e7ec6de082d2fc3a323f0fbcfb835d45b266ac`.
Core and Product independently PASS that exact tree with report SHA-256 values
`8413f9a2839d5c232e9b3026bf65f505a0cc60545c7eeeb35ccf72529ed59280`
and `0c65ac7e693fe3707d7f2f781bddebd34b37f182564a1b48192834b421b425bc`.
This authorizes an
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

An upload `Location` is accepted only on HTTPS default port 443 and within an
exact normalized same-repository upload namespace. In addition to the retained
Distribution form `/v2/<same-repository>/blobs/uploads/<opaque-id>`, real GHCR
returns `/v2/<same-repository>/blobs/upload/<opaque-id>` with singular
`upload`; that exact non-empty opaque-ID form is accepted. Cross-origin,
cross-port, cross-repository, empty/nested/arbitrary paths, userinfo and
fragments are rejected before attaching a bearer token or request body.

Missing blobs use a bounded OCI Distribution upload session, never one
monolithic layer PUT: `POST` carries an explicit zero content length; ordered
`PATCH` requests carry at most 256 KiB with exact inclusive `Content-Range`,
content length, octet-stream type and exact `Connection: close`; the zero-body
POST and empty final PUT also carry exact `Connection: close`. Every `202` must return the exact
cumulative `Range` and a newly validated same-authority/repository `Location`.
That returned Location may equal the current request URL when the exact Range
advances, but may never revert to an older URL after the current Location
changes. One empty terminal `PUT` to the latest Location carries only the
whole-blob digest query and must return `201`. An advertised `OCI-Chunk-Min-Length`
greater than the 262,144-byte safety bound, a missing or malformed cursor/Location,
an earlier superseded Location, `416`, mid-chunk transport ambiguity or any
non-accepted status fails closed. The client does not automatically replay a
chunk or finalize a partially observed upload.

No specific Docker, Buildx, Skopeo or ORAS command is accepted by this ADR.
GREEN must prove that its chosen adapter preserves the single-manifest digest
against GHCR before it may produce evidence.

The local implementation selects the OCI Distribution HTTP API directly. It
must upload only missing reachable blobs through the bounded session above,
write the exact frozen OCI manifest by its digest, and re-read
`Docker-Content-Digest`; it performs no Docker load, build, repack, tag or
index creation. `release:publish` is fixed to the exact accepted 029A candidate
and verifier report checksums. A real authorized attempt proved authentication,
upload `POST` and the singular Location correction, then its monolithic PUT of
the 15,923,972-byte Caddy layer failed with `UND_ERR_SOCKET`. It published zero
images and no evidence/staging. Its fixed 4 MiB replacement then passed auth,
token and POST, but the first PATCH failed with `UND_ERR_SOCKET` after 4,194,726
bytes written and zero bytes read. The production-author replacement therefore
fixes the bound at 1 MiB on RED base `a34b424` / `bdc1d48`. A real run then
passed auth, POST and its first PATCH, but GHCR returned the same current upload
Location; the adapter classified that valid stable Location as stale and
failed. The production-author correction accepts only the unchanged current
URL with its exact advanced Range. A real stable-current 1 MiB run then failed
inside the PATCH transport with `UND_ERR_SOCKET` after 1,049,677 bytes written
and 865 bytes read. The production-author replacement fixes the bound at 256
KiB on RED base `a47e646` / `7bac35d`. All attempts remain non-authorizing;
fresh two-verifier acceptance is mandatory before another credentialed attempt.
The real 256 KiB run still failed inside PATCH transport after 525,812 bytes
written and 1,346 read, approximately two chunks plus framing. Credential-free
probing confirms GHCR honors `Connection: close`; the production-author
replacement on RED base `696f317` / `33edbe3` therefore requires a fresh
transport for POST, every PATCH and the final PUT. Fresh two-verifier acceptance
is mandatory before another credentialed attempt. Core and Product independently
PASS the accepted replacement at commit
`e2744415508650d14bd974b885842232d756e092` / tree
`907fa93f4b604cd8f48d8ee9734a63e0e68d2440`; report SHA-256 values are
`b22316e932db9248157274bf4a864ee146f181d57a508388f08084ca1ef5fcf7` and
`d52c5fa4154fc2041620626df691a170b778603c869df46cb83af601adcd7bdc`.
The subsequently authorized run published all five frozen image manifests to
their explicit `ghcr.io/marshersusanin/orivra-*` repositories without rebuild.
Independent remote HEAD checks returned each exact frozen manifest digest.
Canonical publication evidence is a mode-0400 regular file with SHA-256
`1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`.
This is GHCR publication evidence only: isolated staging and 029B production
promotion remain separate and incomplete.

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

That verifier returns a new private schema-parsed and recursively immutable
authority derived exclusively from the canonical evidence bytes. No caller
object or nested reference survives verification. Every pull command,
observation comparison and staging-evidence field uses that private value
after every asynchronous provision/firewall/session boundary. Mutation of a
caller-owned object after verification either has no effect or aborts before
the first pull and before PASS evidence.

Before the first asynchronous effect, staging likewise strict-validates,
privately clones and recursively freezes the complete target and run records.
Only those private values reach provisioning, firewall, pinned-session,
command construction and evidence. Later caller mutation of origin, Compose
project, SSH pin, run ID, operator ID or completion time cannot reach any
adapter or PASS field; otherwise the run stops before session/command effects.

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
