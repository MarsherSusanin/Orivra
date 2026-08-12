# Slice 028B RED — GHCR publication and DigitalOcean staging

Date: 2026-08-12 (Asia/Vladivostok)

Status: Stable-current GHCR upload Location production-author GREEN on
corrective RED base `566e4b8` / `6e63468`; fresh Core/Product verification
pending; zero images, publication evidence or staging effects exist.

## Authorized predecessor

029A is complete on exact commit
`fc2f6e0677c64dc4f2ee90a85219bcc9f8c9bfbc` / tree
`f7cebc6ed3842f296b3be1c96645e2dd8cdfe5bd`. The frozen candidate file SHA-256
is `8991e7e49f4570702436c269c8f6bd0af7b8f186997bff2a52e6da22f7a0cdda`.

- Core PASS report:
  `/private/tmp/proofline-029a-verifiers/fc2f6e0/core-verifier.md`, SHA-256
  `d03dd65f00b120420734cba2d6473ccb8bcb0e9cd8f614174f8939a93533b60b`.
- Product PASS report:
  `/private/tmp/proofline-029a-verifiers/fc2f6e0/product-verifier.md`, SHA-256
  `b396a60978279a48db4220d873ce5188b4848cf769d7715d30f828fb1092bd11`.

Both reports are local credential-free release verification, not security,
registry, hosted or deployment evidence. The 029A frozen output remains
read-only and outside this RED commit.

## Frozen RED

The contracts reject inferred/mutable GHCR mappings, schema extras, secrets,
paths, reordered/missing images, remote `archiveSha256`, mutable tags,
write-capable staging pulls, production targets and missing staging checks.
Pure domain tests bind exact candidate/release/report bytes, derive only five
immutable remote references and reject any byte, producer, report, mapping or
remote-digest substitution.

Credential-free fake adapters freeze the effect boundary:

1. minimal file-only GHCR/DO/SSH inputs strip ambient authority;
2. safe bounded OCI inspection rejects traversal, links, duplicates and
   unreachable/missing blobs;
3. all five archives verify before the first registry effect;
4. remote digest is checked only against `imageManifestDigest`;
5. partial publication writes no PASS and cannot start staging;
6. conditional-create evidence preserves an existing caller record;
7. staging explicitly pulls and rechecks exact digest references, then runs
   migration/readiness/real-heartbeat/browser/PITR/live checks in staging only;
8. cleanup remains scoped/no-follow and retains the first causal failure.

Expected RED reason: `@proofline/contracts/publication`,
`@proofline/domain/publication`, `scripts/ghcr-publication-runtime.mjs` and
`scripts/digitalocean-staging-runtime.mjs` are absent, as are package exports
and root identity. No production implementation, dependency, lock, Docker
configuration or generated artifact is changed in this wave.

## RED classification

- syntax and repository typecheck: PASS;
- focused contracts/domain/purity: 42 PASS and 8 intentional RED;
- focused GHCR/staging runtime plus retained DigitalOcean roadmap: 15 PASS and
  10 intentional RED;
- retained 028A/029A/Action pure controls: 48/48 PASS;
- retained 028A/029A deployment controls: 48/48 PASS;
- serialized deployment static: 194 PASS and the same 10 intentional RED;
- Sites compatibility: 46/46 PASS.

All 18 RED cases are caused by the deliberately absent publication feature,
package exports and credentialed runtime seams named above. No retained control
regressed and no test performed a registry, host, Docker or credential effect.

No registry, Docker, network, credential, SSH, DigitalOcean, Spaces, live
Coston2 or frozen-candidate write is performed. No hosted/deployed/security
PASS or 029B authority is claimed.

## Production-author GREEN continuation

After the frozen RED and the fixture-only digest correction, production adds
the exact publication contract/domain subpaths, bounded OCI ustar inspection,
file-only credential environments, direct GHCR Distribution API adapter,
append-only publication output and isolated staging orchestration. The direct
adapter has a credential-free fake-HTTP digest-preservation check; an actual
frozen Caddy archive passed the same safe ustar/OCI inspector.

Final author gates on the unchanged implementation bytes: typecheck PASS;
focused contracts/domain/purity 56/56 PASS; focused deployment/roadmap 10/10
PASS; contracts/domain 53 files and 617 tests with exact 100% statements,
branches, functions and lines; serialized deployment static 204/204 PASS;
Action artifact sync 1/1 PASS; production build PASS; Sites 46/46 PASS.

This is local production-author evidence only. Two independent verifiers,
actual GHCR publication, hosted DigitalOcean staging checks and immutable live
publication/staging records are still pending. Scan 8852 remains canceled and
is not a security PASS; the deferred 027C integrity observation remains open.

## Fixture digest correction

The initial RED fixture accidentally assigned the fifth `postgres-recovery`
archive and image-manifest the same synthetic SHA-256 digit, contradicting the
frozen distinct-digest invariant before production could be exercised. The two
affected fixtures now use `a` through `e` for archive digests and `1` through
`5` for image-manifest digests. No schema, runtime or effect contract changed;
the stashed production WIP was not applied.

## Core rejection and corrective RED

Independent Core report
`/private/tmp/proofline-028b-verifiers/5322125/core-verifier.md` has SHA-256
`5c0baa5ca9f5f09943f155e65ae630bbf7ba21a2a87ff07c2c2c8ec5a2663661`
and rejects exact commit `5322125c8c17877018b5a16d2f89d3ad184a7e89` /
tree `bad14e5ba344e908c95103321a6c595b08fd308e`.

The causal corrective matrix freezes five unchanged trust requirements:

1. staging consumes canonical publication evidence bytes, an independent
   checksum and the strict transitive candidate/release/target/report handoff;
2. failed, missing or ambiguous remote observations cannot create evidence,
   while accepted bytes parse and canonicalize as exact
   `StagingDeploymentEvidenceV1`;
3. one authenticated endpoint and expected host-key digest establish a pinned
   SSH session used by every command, with mismatch blocking before remote I/O;
4. candidate, manifest, receipt, target and every image archive/manifest field
   remain transitively bound during both creation and verification; and
5. one `O_RDONLY|O_NOFOLLOW` descriptor/immutable capture supplies stat, hash,
   parse and bounded upload ranges, with all leases closed on every outcome.

The same corrective wave freezes Core's adjacent hardening and lifecycle
controls: upload `Location` remains on default-port 443 inside the exact same-
repository upload namespace before bearer/body send; publication cannot chain
staging from a mutable object; successful staging closes local/session
resources but is preserved, while failed run-owned staging alone is torn down.

This wave changes tests and canonical status only. It performs no registry,
Docker, network, SSH, DigitalOcean, credential, live or frozen-output effect.

Corrective classification on the rejected implementation: syntax and
typecheck PASS; focused contracts/domain/purity are 56 PASS plus 5 intentional
RED; focused deployment and retained DigitalOcean roadmap are 23 PASS plus 9
intentional RED; serialized deployment static is 202 PASS plus the same 9
intentional RED; Sites compatibility is 46/46 PASS. The fourteen focused
failures are the exact missing transitive/canonical handoff checks,
schema-valid typed staging evidence, enforced pinned session,
single-descriptor archive capture, strict upload-Location authority, separate
session/teardown lifecycle and removal of mutable raw-object staging authority.

The replacement closes all fourteen causal RED cases. Typecheck, the exact 61
contracts/domain/purity cases, exact 32 GHCR/staging/roadmap cases, serialized
deployment static 211/211, contracts/domain coverage 100% in all metrics and
direct single-descriptor revalidation of all five frozen 029A OCI archives are
GREEN. This is production-author evidence only, not an independent PASS and
not a hosted, deployed or security claim.

## Mutable-authority rejection and corrective RED

Independent Core report
`/private/tmp/proofline-028b-verifiers/7c2ca21/core-verifier.md` has SHA-256
`596e0a558db431601dadcefbd811784d7ad92066cde90f988c42c6a57ee2c5bc`
and rejects exact commit `7c2ca211fac17286947ffe4af6e8f604587292de` /
tree `34a575159f3e3d1363009f71f1a7154ff4363646`.

The strict handoff verifier parsed canonical evidence but returned the same
caller-owned object. A fake provision adapter could mutate its first
repository/reference after verification; later pull commands and otherwise
strict staging evidence accepted the replacement. The new causal RED mutates
only that object during the asynchronous pre-command provision seam. A valid
implementation must use a private schema-parsed, deeply frozen authority
derived exclusively from canonical evidence bytes, so every command and
evidence field remains canonical, or it must abort before pull and PASS.

This tests/docs-only wave preserves all prior fourteen controls and performs
no registry, Docker, network, SSH, DigitalOcean, credential, live or
frozen-output effect.

Corrective classification on `7c2ca21` / `34a5751`: syntax and typecheck PASS;
the exact contracts/domain/purity focus is 61/61 PASS; the exact
GHCR/staging/roadmap focus is 32 PASS plus this one intentional RED; serialized
deployment static is 211 PASS plus the same intentional RED; Sites
compatibility is 46/46 PASS.

The production-author replacement parses a fresh private authority exclusively
from canonical `evidenceBytes`, recursively freezes it, and uses only that value
after asynchronous provisioning. The causal mutation case and the other 32
GHCR/staging/roadmap cases now PASS. This is not an independent verifier,
hosted, deployed or security PASS.

## Target/run async-alias rejection and corrective RED

Independent Core report
`/private/tmp/proofline-028b-verifiers/be3270c/core-verifier.md` has SHA-256
`5940fd08e10ce45dc6801d608e5b8ffdd7e07351db7df644fe6d7f4396e8aee5`
and rejects exact commit `be3270cfe16a6806b481386ad9d6d712f46af3d0` /
tree `0c12d829a6499317399b2901c4588ac5d06926ee`.

That replacement correctly isolates canonical publication evidence, but
retains caller-owned target and run objects after synchronous validation. The
new causal RED holds provisioning pending, changes the caller origin, Compose
project, SSH pin, run ID, operator ID and completion time, then resumes. A
valid implementation passes only private strict, deeply frozen pre-await
snapshots to provisioning/session/commands/evidence, or stops before remote
session/command/PASS effects. The rejected runtime instead exposes the changed
production-like target to provisioning and all fifteen command seams.

This tests/docs-only wave preserves the prior fifteen cases and performs no
registry, Docker, network, SSH, DigitalOcean, credential, live or
frozen-output effect.

Corrective classification on `be3270c` / `0c12d82`: syntax and typecheck PASS;
the exact contracts/domain/purity focus is 61/61 PASS; the exact
GHCR/staging/roadmap focus is 33 PASS plus this one intentional RED; serialized
deployment static is 212 PASS plus the same intentional RED; Sites
compatibility is 46/46 PASS.

The production-author replacement removes every success-path call to generic
cleanup or staging teardown. A successful run closes the pinned session and an
explicit local closer only; failure retains the existing run-owned teardown
and deterministic original-then-cleanup aggregation. The causal case and the
other 33 GHCR/staging/roadmap cases now PASS. This is not an independent
verifier, hosted, deployed or security PASS.

The production-author replacement synchronously validates, clones and deeply
freezes private target/run snapshots before the first await. The pending-
provision mutation case and the other 33 GHCR/staging/roadmap cases now PASS.
This is not an independent verifier, hosted, deployed or security PASS.

## Successful-resource cleanup rejection and corrective RED

Independent Core report
`/private/tmp/proofline-028b-verifiers/9cb839f/core-verifier.md` has SHA-256
`23e2535462d7c604abf3511c40291b47bdccd988d6bcc806ab012c6aa84d68ab`
and rejects exact commit `9cb839fdc628d0ccd8a95bdbd005ed4b73820059` /
tree `fcd0d75481a6d3c9e5e1cce14d68dc2a4c9cfa55`.

Evidence/target/run isolation is closed, but successful owned staging without
an explicit `closeLocalSession` still invokes generic `cleanup` after writing
PASS and can destroy the accepted resource. The corrected happy-path causal
case supplies both dangerous callbacks, writes canonical PASS evidence, closes
the pinned session and requires zero generic cleanup/teardown calls plus an
unchanged live resource. Existing failure-only teardown and deterministic
original-then-cleanup aggregation remain unchanged.

This tests/docs-only wave performs no registry, Docker, network, SSH,
DigitalOcean, credential, live or frozen-output effect.

Corrective classification on `9cb839f` / `fcd0d75`: syntax and typecheck PASS;
the exact contracts/domain/purity focus is 61/61 PASS; the exact
GHCR/staging/roadmap focus is 33 PASS plus this one intentional RED; serialized
deployment static is 212 PASS plus the same intentional RED; Sites
compatibility is 46/46 PASS.

## Final replacement verification and first credentialed attempt

Core and Product independently PASS exact commit
`70f63cb0c4fac0c7661cb734896575be07edfa70` / tree
`88ec38335ab9630e1fd8c4d5247101bd046f06eb`.

- Core report `/private/tmp/proofline-028b-verifiers/70f63cb/core-verifier.md`,
  SHA-256 `8d4175ccad0e19ae5333ad35a4d3edb55204195a6688eee3d13c8d9962f4a38c`.
- Product report
  `/private/tmp/proofline-028b-verifiers/70f63cb/product-verifier.md`, SHA-256
  `f657d9010728ce2e19d8f2cb373daf6e8a4c32dfc26144c786d2c595c4204df6`.

The first real publication attempt revalidated the frozen 029A candidate and
both reports, then failed closed on the first Caddy blob because the supplied
GitHub fine-grained PAT was not valid GHCR package-write authority. The partial
result contained zero published image IDs, no publication evidence was written
and staging was not started. This is not hosted, deployed or security PASS.

## Real GHCR upload-Location compatibility RED

A later authorized diagnostic authenticated successfully and received blob
upload `POST` 202 without publishing a blob. GHCR returned the relative
same-origin path
`/v2/marshersusanin/orivra-caddy/blobs/upload/<opaque-id>` with singular
`upload`; the adapter froze only plural `blobs/uploads` and failed closed.
The redacted result remained `publishedImageIds=[]`, failed on `caddy`, wrote
no publication evidence and did not start staging. No token, query or raw
credential is recorded here.

The credential-free causal test accepts only that exact default-443,
same-repository, non-empty opaque-ID form in addition to the retained plural
Distribution form. Cross-origin/port/repository, empty or nested IDs,
arbitrary same-host paths, userinfo and fragments remain rejected before any
bearer/body PUT. The prior `70f63cb` / `88ec383` verifier PASS reports cover
superseded adapter bytes and cannot authorize another credentialed attempt.

This tests/docs-only wave performs no production, dependency, Docker, network,
credential, registry, publication-evidence or staging mutation.

Compatibility classification on `3a38a8f` / `c368ea2`: syntax and typecheck
PASS; the exact contracts/domain/purity focus is 61/61 PASS; the exact
GHCR/staging/roadmap focus is 34 PASS plus this one intentional RED; serialized
deployment static is 213 PASS plus the same intentional RED; Sites
compatibility is 46/46 PASS.

The production-author correction changes only the upload-Location parser. It
accepts the retained exact plural and the observed exact singular same-origin,
default-443, same-repository prefix with one non-empty non-nested opaque ID.
Every frozen authority/path negative remains fail-closed. Post-correction
typecheck, pure focus 61/61, GHCR/staging/roadmap 35/35, serialized deployment
static 214/214 and Sites 46/46 PASS. Publication remains paused until two fresh
independent verifiers PASS one exact replacement tree.

## Real GHCR chunked-upload compatibility RED

After the singular Location correction, an authorized diagnostic passed GHCR
authentication, token exchange and upload `POST` 202. The monolithic PUT of
the 15,923,972-byte Caddy layer then failed with `UND_ERR_SOCKET` after
15,924,448 bytes were written. The redacted outcome remained
`publishedImageIds=[]`, `failedImageId=caddy`, publication evidence absent and
staging absent. No credential, bearer token or opaque Location query is
recorded here.

The credential-free causal RED replaces monolithic PUT with the bounded OCI
Distribution flow: explicit zero-length POST; fixed ordered 4 MiB PATCH chunks
with exact inclusive Content-Range; validation of every `202` Range and latest
Location; and one empty terminal PUT with the whole digest. It also freezes
zero terminal/manifest/evidence authority for missing, malformed, stale,
cross-authority or cross-repository Location, invalid or oversized advertised
minimum, wrong cursor, `416` and ambiguous mid-chunk failure. No automatic
chunk replay is allowed in this slice.

This tests/docs-only correction performs no production, dependency, Docker,
network, credential, registry, publication-evidence or staging mutation. The
prior verifier PASS reports cover superseded bytes and cannot authorize a
retry; fresh Core and Product PASS on one exact replacement tree are required.

Intentional RED classification on exact base `63000baf` / `3a0994a`: syntax
and typecheck PASS; focused GHCR/staging/roadmap is 34 PASS plus this one causal
RED; serialized deployment static is 213 PASS plus the same RED; Sites is
46/46 PASS. The RED fails at the missing explicit zero-length POST contract in
the unchanged monolithic adapter, before any PATCH or external effect.

The production-author replacement changes only the GHCR registry adapter. It
uses explicit zero-length POST, fixed ordered 4 MiB PATCH chunks, exact
inclusive ranges, strict latest Location/cursor validation and an empty digest
finalizer. It never replays an ambiguous accepted chunk. Post-correction
typecheck, exact pure focus 61/61, GHCR/staging/roadmap 35/35, serialized
deployment static 214/214 and Sites 46/46 PASS. No credential, registry,
publication-evidence or staging effect was used for this local author gate;
fresh same-tree Core and Product verification remains mandatory.

## Stable-current GHCR Location compatibility RED

The real fixed 1 MiB attempt passed auth, token, POST and its first PATCH. GHCR
returned the same current upload Location with the exact advanced Range; the
adapter rejected it at the duplicate-history check before another chunk. The
redacted result remained `publishedImageIds=[]`, publication evidence absent
and staging false. No credential, token or Location query is recorded here.

The causal success variation keeps the current URL unchanged after PATCH 1 and
advances the exact Range. Returning that same current URL is permitted; after a
later response changes the current URL, returning to any earlier seen URL is
still rejected as stale. All fixed 1 MiB, cursor, bodyless finalizer and
no-replay contracts remain unchanged. This tests/docs wave has no production,
credential, network, registry, evidence or staging effect.

Intentional RED classification on exact base `d767fcf` / `ce0bf30`: syntax and
typecheck PASS; focused GHCR/staging/roadmap is 34 PASS plus this one causal
RED at the production duplicate-history check; serialized deployment static is
213 PASS plus the same RED; Sites is 46/46 PASS.

The production-author correction changes only the duplicate-history predicate:
the response may reuse the exact current Location when the exact cumulative
Range advances, but a previously superseded non-current URL remains rejected.
Post-correction typecheck, pure 61/61, focused 35/35, serialized static 214/214
and Sites 46/46 PASS. No credential, registry, evidence or staging effect was
used; fresh same-tree Core and Product verification remains mandatory.

## Real first-PATCH 4 MiB compatibility RED

The authorized chunked attempt revalidated its frozen inputs and passed GHCR
authentication, token exchange and zero-length upload POST. Its first fixed
4 MiB PATCH failed with `UND_ERR_SOCKET` after 4,194,726 bytes written and zero
bytes read. The redacted result remained `publishedImageIds=[]`,
`failedImageId=caddy`, publication evidence absent and staging absent. No
credential, token or Location query is recorded here.

The causal tests/docs correction fixes the safety bound at 1 MiB while keeping
all accepted POST, inclusive range, latest Location, exact cursor, empty digest
finalizer and no-replay rules. The exact 15,923,972-byte Caddy layer must yield
16 PATCHes: 15 full 1,048,576-byte chunks and one 195,332-byte final chunk. An
advertised minimum above 1 MiB still fails before PATCH. This wave has no
production, credential, network, registry, evidence or staging effect.

Intentional RED classification on exact base `9f82c26` / `ac4339f`: syntax and
typecheck PASS; focused GHCR/staging/roadmap is 34 PASS plus this one causal
RED; serialized deployment static is 213 PASS plus the same RED; Sites is
46/46 PASS. The first PATCH exposes the unchanged 4 MiB body (`4194304`) where
the frozen bound requires `1048576`, before finalization or PASS authority.

The production-author replacement changes only the adapter's fixed chunk
constant from 4 MiB to 1 MiB. The causal exact-Caddy case and all prior
authority/cursor/no-replay cases now PASS. Post-correction typecheck, pure
61/61, focused GHCR/staging/roadmap 35/35, serialized static 214/214 and Sites
46/46 PASS. No credential, registry, evidence or staging effect occurred;
fresh same-tree Core and Product verification remains mandatory.
