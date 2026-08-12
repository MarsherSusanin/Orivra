# Slice 028B — Byte-preserving GHCR publication and DigitalOcean staging

Status: Fixed 256 KiB GHCR transport production-author GREEN on corrective RED
base `a47e646` / `7bac35d`; fresh Core/Product verification pending; zero
images, publication evidence or staging effects exist. Prior Core/Product PASS
`70f63cb` / `88ec383` covers superseded adapter bytes and cannot authorize publication.

Architecture authority: [ADR 0042](../adr/0042-byte-preserving-ghcr-publication-and-digitalocean-staging.md).

## Outcome

An explicitly authorized operator publishes the exact frozen 029A OCI image
manifests/blobs to explicit GHCR repositories without rebuild or conversion,
records immutable publication evidence, and deploys only an isolated
DigitalOcean staging environment from those exact remote digests.

## Frozen vertical split

### 028B1 — Publication contracts and pure verification

- strict `GhcrPublicationTargetsV1`, `PublicationEvidenceV1` and
  `StagingDeploymentEvidenceV1` canonical contracts;
- exact 029A candidate/manifest/receipt/two-verifier binding;
- exact ordered five-image mapping and remote digest equality to
  `imageManifestDigest`, never `archiveSha256`;
- separate checksums for target, publication and staging records.

### 028B2 — GHCR adapter and append-only publication

- all archives stream-verified before registry I/O;
- bounded safe OCI entry/descriptor/blob inspection;
- explicit manifest+blob copy adapter, no rebuild/repack/index conversion;
- remote digest verification and conditional-create publication evidence;
- redacted partial report plus exact-scoped cleanup on failure.

### 028B3 — DigitalOcean staging

- file-only least-authority credentials and pinned SSH host key;
- explicit read-only pull of five publication-authorized digest references;
- isolated staging project/volumes/secrets/origin and fixed start order;
- migration/readiness/real heartbeat/browser/PITR/live staging checks;
- separate append-only staging evidence and no production/canary authority.

## RED files

- `packages/contracts/test/slice028b-publication.contract.test.ts`
- `packages/domain/test/slice028b-publication-evidence.contract.test.ts`
- `tests/deployment/slice028b-ghcr-publication.contract.test.mjs`
- `tests/deployment/slice028b-digitalocean-staging.contract.test.mjs`
- retained `apps/worker/test/slice009-production-worker-purity.contract.test.ts`

## Explicit exclusions

The selected GHCR mapping is recorded in the runbook. One credentialed registry
attempt reached the first Caddy blob and failed closed because GitHub Container
Registry does not accept a fine-grained PAT as package-write authority. It
published zero accepted image IDs, wrote no publication evidence and never
started staging. This slice does not claim hosted staging, authorize production
promotion, or run a canary. 029B owns production promotion/canary after accepted
028B hosted evidence.

## Local GREEN evidence

- strict publication/staging contracts and pure handoff derivation are GREEN;
- the GHCR runtime verifies all five canonical OCI archives before registry
  I/O and the direct Distribution API adapter preserves manifest bytes/digest;
- credential environments retain only explicit file-backed least authority;
- staging orchestration fixes exact digest pulls, service/check order,
  append-only evidence and scoped cleanup through injected operator adapters;
- typecheck, focused 028B tests, contracts/domain 100% coverage, serialized
  deployment static and Sites pass;
- the five frozen 029A OCI archives pass the single-descriptor parser and exact
  manifest-digest revalidation without registry or external network access.

Core report `/private/tmp/proofline-028b-verifiers/70f63cb/core-verifier.md` has
SHA-256 `8d4175ccad0e19ae5333ad35a4d3edb55204195a6688eee3d13c8d9962f4a38c`.
Product report `/private/tmp/proofline-028b-verifiers/70f63cb/product-verifier.md`
has SHA-256
`f657d9010728ce2e19d8f2cb373daf6e8a4c32dfc26144c786d2c595c4204df6`.
Both cover the same exact implementation tree. A real hosted 028B PASS still
requires the approved package-write/package-read credentials and resulting
immutable publication/staging evidence.

## Corrective verifier boundary

Core rejected the first implementation because a shallow publication object
could authorize staging and false observations could yield schema-invalid PASS
bytes; the publication verifier also accepted canonical manifest substitution,
the SSH pin was unused, and archive bytes were reopened and retained outside
their authenticated identity. Corrective RED now requires canonical handoff
bytes/checksum and transitive binding, exact typed observations and strict
staging evidence, one enforced pinned SSH session, and a bounded single-
descriptor archive lease. No credentialed execution is allowed before the
replacement receives both independent PASS reports.

The replacement also rejects registry upload redirects outside default-port
443 and the exact same-repository upload namespace before bearer/body send,
removes raw-object publication-to-staging chaining, and separates always-run
local/session cleanup from failure-only staging teardown.

Core then rejected exact `7c2ca21` / `34a5751`: the strict handoff verifier
returned the caller-owned mutable evidence object, so an async provision seam
could replace a repository/reference before pull and PASS. Corrective RED now
requires one private schema-parsed, deeply immutable authority derived only
from canonical evidence bytes; post-verification caller mutation cannot reach
commands or evidence and otherwise fails before pull/PASS.

The next replacement closed that evidence alias but Core rejected exact
`be3270c` / `0c12d82`: caller-owned target/run objects remained mutable across
provisioning, allowing a production-like Compose project and new SSH pin to
reach all command seams. The production-author replacement creates private
strict snapshots of both target and run before the first await and uses them
exclusively for every adapter, command and evidence field.

Core then rejected exact `9cb839f` / `fcd0d75`: after canonical PASS evidence
and pinned-session close, an omitted explicit local closer let legacy generic
`cleanup` destroy the successful owned staging resource while returning PASS.
Corrective RED requires zero generic cleanup/teardown calls on success;
failure-only teardown remains run-owned and preserves deterministic
original-then-cleanup error ordering.

The production-author replacement removes the success-path generic finalizer.
Successful staging closes only its pinned session and an explicit local closer;
failure-only run-owned teardown and deterministic error aggregation are
unchanged.

A later credentialed diagnostic authenticated and received GHCR `POST` 202,
but real GHCR returned the relative same-repository singular path
`/v2/marshersusanin/orivra-caddy/blobs/upload/<opaque-id>`. The verified adapter
accepted only the assumed plural `blobs/uploads` form and failed closed on
Caddy. Compatibility RED adds only that exact singular default-443 same-repo
form and preserves every redirect/authority rejection. Published image IDs,
publication evidence and staging remain empty.

The production-author correction accepts only the exact retained plural and
observed singular same-origin/default-443/same-repository forms with one
non-empty non-nested opaque ID. Typecheck, pure 61/61, focused 35/35,
deployment static 214/214 and Sites 46/46 PASS. Fresh Core/Product verification
was required before another credentialed attempt.

That authorized attempt proved auth, `POST` 202 and the singular Location, then
the monolithic PUT of the 15,923,972-byte Caddy layer failed with
`UND_ERR_SOCKET` after 15,924,448 bytes were written. No image ID, publication
evidence or staging effect exists. The production-author replacement provides
explicit zero-length `POST`, fixed ordered 256 KiB `PATCH` chunks with inclusive ranges,
validation and exclusive use of every latest returned Location, and an empty
terminal `PUT` carrying the whole digest. Missing/bad/stale/cross-authority or
cross-repository Location, invalid cursor, a minimum above 262,144 bytes, `416` or
ambiguous mid-chunk failure stops without replay, manifest PUT, PASS evidence
or staging. Typecheck, pure 61/61, focused 35/35, deployment static 214/214 and
Sites 46/46 PASS. Fresh same-tree Core and Product verification is required
before credential use resumes.

The authorized 4 MiB chunk attempt passed auth, token and POST, then its first
PATCH failed with `UND_ERR_SOCKET` after 4,194,726 bytes written and zero bytes
read. The result remained `publishedImageIds=[]`, failed on `caddy`, wrote no
publication evidence and never started staging. The production-author
replacement fixes the bound at 1 MiB: the exact 15,923,972-byte Caddy layer is
16 ordered PATCHes (15 full 1,048,576-byte chunks plus 195,332 bytes). All
existing Location/cursor, bodyless-finalizer and no-replay contracts remain
unchanged; author gates are typecheck, pure 61/61, focused 35/35, static
214/214 and Sites 46/46 PASS.

The real 1 MiB attempt passed auth, POST and its first PATCH, then GHCR returned
the same current upload Location with an advanced Range. The adapter rejected
that stable current URL at its duplicate-history check. The production-author
correction allows same-current plus the exact advancing cursor, while a return
to any older URL after the current Location changes remains stale and
fail-closed. Author gates are typecheck, pure 61/61, focused 35/35, static
214/214 and Sites 46/46 PASS. The outcome still has `publishedImageIds=[]`, no
evidence and no staging.

The real stable-current 1 MiB run passed auth, POST and Location validation but
failed inside its PATCH with `UND_ERR_SOCKET` after 1,049,677 bytes written and
865 bytes read. The outcome again has zero published image IDs, evidence or
staging. The production-author replacement fixes the bound at 262,144 bytes:
the exact Caddy layer is 61 ordered PATCHes (60 full chunks plus the same
195,332-byte remainder). Stable-current, stale-history, cursor, finalizer and
no-replay rules are unchanged. Author gates are typecheck, pure 61/61, focused
35/35, static 214/214 and Sites 46/46 PASS.
