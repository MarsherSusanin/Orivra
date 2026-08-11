# Slice 028B RED — GHCR publication and DigitalOcean staging

Date: 2026-08-12 (Asia/Vladivostok)

Status: Corrective RED closed by a production-author GREEN replacement after
Core rejected `be3270c` / `0c12d82`; two independent verifier reports and all
credentialed effects are pending.

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

The production-author replacement synchronously validates, clones and deeply
freezes private target/run snapshots before the first await. The pending-
provision mutation case and the other 33 GHCR/staging/roadmap cases now PASS.
This is not an independent verifier, hosted, deployed or security PASS.
