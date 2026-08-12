# Slice 029A RED — credential-free MLP candidate freeze

## 2026-08-13 recorded-product terminal-cleanup corrective RED

Fresh release candidate `7e6806ae937dff1048f83f32425f05b980c05998` /
tree `04740ed5f3a97fc50b069977d3131f6fe68bb0b2` completed the unified matrix,
PITR, five-image OCI freeze and recorded product success path. Independent
Product report `/private/tmp/orivra-release-b77c/verifiers/7e6806a/product-verifier.md`
with SHA-256 `66c12ce2233fe03ea0297d7df6308fff63fc627b7d76f79c524d30ebd146855a`
and Core report `/private/tmp/orivra-release-b77c/verifiers/7e6806a/core-verifier.md`
with SHA-256 `e584afa8b8f63e96b5eeb396bce19f126b1f7e5e888ef8739c2fea354fb11675`
reject it as publication authority. If scoped `docker compose down` throws,
the existing `finally` exits before residue inspection, recursive removal of
the private generated database/token/handoff inputs and removal of a non-PASS
fixture.

The corrective contract requires one production-used terminal lifecycle that
attempts Compose cleanup, scoped residue inspection, private-temporary removal
and failed-fixture removal in fixed order even when an earlier cleanup phase
fails. The current implementation is intentionally RED because that lifecycle
entrypoint is absent. Candidate and OCI bytes remain unchanged but cannot be
published; no credential, registry, host or production effect is authorized.

The GREEN correction exports that lifecycle from the pure recorded-product
runtime and makes the executable gate delegate all four terminal phases to it.
It continues after each cleanup failure, removes a non-PASS fixture whenever
any phase fails, and returns the sole causal error or an ordered
`AggregateError`. Typecheck, the focused recorded-product/unified inventory
24/24, real product Compose gate and serialized deployment static 263/263 are
PASS after the correction; a fresh full candidate and two new same-tree
verifier PASS reports remain mandatory because the rejected candidate cannot
be reused.

## 2026-08-13 current-tree release compatibility correction

The first authorized freeze of `b77c9a5` passed the full matrix, recovery and
five-image OCI export, then failed closed before candidate publication because
the worker-stopped product gate did not provide the newly mandatory
`PROOFLINE_SAFE_CONSUMER_WORKER_HANDOFF_FILE` while Compose interpolated the
full runtime model. A causal contract now requires a canonical two-entry
regular mode-0400 handoff inside the gate's private temporary root, the exact
absolute path, no `PROOFLINE_SAFE_CONSUMER_ADDRESS`, and scoped removal. The
pre-fix focused result was 7 retained PASS plus 1 intentional RED; the narrow
correction made the file 8/8 PASS and typecheck PASS. The failed freeze is not a
candidate PASS and authorizes no registry or host effect.

Date: 2026-08-12

ADR 0041 freezes the final local release boundary after 027E received two
independent PASS reports on exact commit
`e42da1ffa689ceb4b3bd43e78f46bd6a3e98eed7` / tree
`18116a629c770f7ea6b4cdfc8e7dd2b814915e2f`.

The RED contracts require a canonical same-tree candidate receipt, the exact
ordered unified matrix, a fresh offline OCI freeze and a canonical checked-in
template/replay expectation verified through local production Compose while
worker remains stopped. The fixture is never imported or described as live
Coston2 evidence. The contracts also freeze minimal no-auth environment, fail-fast execution,
atomic read-only publication and no-follow scoped cleanup.
The retained deployment role-bootstrap may still receive its unused least-
privilege importer database secret; the gate forbids invoking the importer,
supplying `--recording` or issuing direct SQL, rather than hiding required
Compose configuration.

Expected RED reason: the candidate schema/domain verifier, 029A orchestration,
recorded-product Compose gate and `release:candidate` command do not exist.

Frozen classification:

- `npm run typecheck`: PASS;
- candidate contracts/domain: 17 causal intentional RED;
- candidate lifecycle/product Compose: 16 causal intentional RED;
- nearest 027E/028A Vitest controls: 35/35 PASS;
- nearest 027E/028A Node controls: 36/36 PASS;
- Sites compatibility: 46/46 PASS.

This wave changes tests and documentation only. It does not run Docker, build,
coverage, PostgreSQL, network or credentials and does not claim 029A PASS.

## Unified-run correction

The first clean-tree unified run on `f2676d0` passed full unit, all three
coverage gates, real PostgreSQL, Solidity, E2E, build, Sites and Action sync,
then failed closed at Docker static. Its fresh no-auth `DOCKER_CONFIG` also hid
the host's local Compose plugin, so Docker parsed Compose `-f`/`--file` as
top-level flags and exactly twenty retained 027A/027B render controls failed.
No candidate, release or product artifact was published. The corrective
contract freezes one executable plugin from an exact local system-path
allowlist inside the private Docker config while continuing to exclude the
user config and all registry credentials.

## Production GREEN checkpoint

The follow-up production wave implements the candidate contracts/domain
binding, strict serial orchestration, worker-stopped production Compose journey
and atomic terminal runner. Before candidate freeze: typecheck PASS; focused
candidate contracts/domain 18/18 PASS; focused lifecycle/product 16/16 PASS;
serialized deployment static 188/188 PASS; contracts/domain coverage 50 files,
579 tests and exact 100% statements/branches/functions/lines. No credential,
registry, external-network or hosted claim is made. The one-shot unified run and
two independent verifier reports remain pending on the final committed tree.

The first terminal attempt on `331cce9` stopped at the full-unit gate before
Docker or candidate publication because the production landing placeholder
still contained the forbidden historical `api.example.com` demo marker. The
candidate lifecycle removed its scoped prefetch/stage and published no PASS.
The corrective tree replaces only that visible placeholder with a neutral
reserved example endpoint and must repeat the unified matrix from the start.
The same failed run also exposed that the owned-tree helper used `fs.rm`
without recursion for an already emptied directory, leaving private stage/temp
directories behind. The correction uses `rmdir` only after the no-follow walk
and strengthens the fixture to prove owned removal plus external symlink-target
byte/mode preservation. The exact failed-run residues are removed separately;
no caller-owned path is broadened into cleanup authority.

The next clean-tree unified attempt passed unit, coverage, real PostgreSQL,
Solidity, E2E, build, Sites, Action sync and all 189 static deployment cases,
then failed closed before the first Docker build. Candidate materialization had
placed the verified WAL-G binary and receipt directly under
`docker/.prefetch`, while the retained offline build boundary accepts only the
exact `docker/.prefetch/wal_g_release/{wal-g,receipt.v1.json}` context. No
candidate, release or product artifact was published and scoped cleanup removed
the temporary prefetch tree. The corrective RED contract freezes that retained
nested context and exact 0555/0444 file modes before the production correction.
The narrow GREEN helper now materializes only that nested context, preserves
the accepted 028A private capture authority (0500 directory/0400 binary),
promotes only the copied build-context binary to 0555, and remains covered by the candidate's no-follow scoped
cleanup. Typecheck, the exact 11-case candidate deployment contract and the
serialized 190-case deployment static inventory pass before the next mandatory
from-scratch unified run.

That next attempt reached the first real offline Docker build, then failed
closed because the same fresh no-auth `DOCKER_CONFIG` exposed Compose but not
the host's verified local Buildx plugin. Docker therefore selected the legacy
builder, which cannot execute the accepted `RUN --mount` Dockerfile. The next
corrective RED contract freezes one executable `docker-buildx` from an exact
system-path allowlist beside `docker-compose`; it still forbids reading the
user Docker config, credential helpers or registry authority.

The production correction now materializes that Buildx plugin through the same
verified local-plugin boundary. Typecheck, the exact 12-case 029A contract and
the serialized 191-case deployment inventory pass. A private no-auth config
smoke resolves Docker Desktop Buildx `v0.25.0-desktop.1` without daemon,
registry or credential access; the next evidence step is the complete unified
candidate run from a clean commit.

The clean candidate run then passed Docker A and Docker B but stopped before
creating the recovery project: the retained 027C gate correctly rejected a
missing caller-owned evidence root. The next corrective RED contract assigns
one private mode-0700 directory under the candidate's owned temporary root only
to `docker-recovery`; all other child environments remain unchanged, and the
directory is removed by the existing exact-scoped finalizer before publication.

The orchestration correction now creates that directory inside its private
candidate temp root and assigns the path only to the retained recovery command.
Typecheck, the exact 13-case candidate contract and the serialized 192-case
deployment inventory pass; the failed attempt left no candidate or scoped
Docker resources, so the next step is one clean from-scratch unified rerun.

That clean rerun passed the full unit/coverage/PostgreSQL/build/static matrix,
Docker A and B, the exact 027C recovery drill with all eight real negatives,
and the fresh five-image OCI freeze on producer `2929510` / `a8514f1`. It then
failed closed before the recorded-product Compose gate and before candidate
publication with `Invalid array length`. The candidate wrapper re-opened every
large OCI archive with `readFile` and passed its hundreds of megabytes through
the pure in-memory SHA-256 helper, even though the frozen receipt already
provides exact sizes and digests. Cleanup removed the owned stage, temporary
WAL-G context and ignored prefetch tree; the caller output remained absent.

The next corrective RED freezes bounded filesystem revalidation instead:
`lstat` must prove every exact receipt artifact is a regular non-symlink mode-
0400 file with the recorded size, and a streaming checksum must match the
receipt digest. The terminal wrapper must never materialize whole OCI archives
as JavaScript arrays or buffers merely to validate the 028A handoff. This is a
local evidence scalability defect, not a credential, hosted, security-scan or
production-deployment claim.

The narrow production correction replaces whole-archive `readFile` validation
with an exact six-artifact filesystem boundary and a no-follow streaming SHA-
256 implementation. The focused 14-case 029A contract, typecheck and a real
six-file streaming smoke pass; the next evidence step remains a complete clean-
tree unified rerun because the prior terminal command did not publish a
candidate.

## Pre-lifecycle setup cleanup corrective RED

Independent Core report
`/private/tmp/proofline-029a-verifiers/78a85e2/core-verifier.md` has SHA-256
`d10b645b181076f3ca8cfdfe1f1a5bcda345e1f5d7848e3d82a8f24efb03c989` and
rejects exact candidate `78a85e21f0f73d4d7f7a58747464a2f272c07633` /
`20c0f415303fe2db7cedd186dadac17e496c7184`. The terminal created owned
stage/temp/config and Compose-plugin paths before entering the only lifecycle
catch that calls `discard`; exact Compose-present/Buildx-unavailable setup
therefore left those paths behind.

The corrective contract registers one production-used outer terminal boundary
before the first owned setup action. One causal filesystem matrix fails after
each setup seam from temporary-root creation through the exact unavailable
Buildx lookup. Every case requires zero owned `.candidate-stage.*` and
`.candidate-temp.*` paths, no config or plugin symlink, no candidate PASS, and
byte/mode-identical caller paths and plugin targets. Cleanup remains scoped and
no-follow. If cleanup also fails, a deterministic `AggregateError` retains the
original setup failure first and cleanup failure second instead of masking
either. Existing 029A receipt, matrix, product, authority and publication
contracts are unchanged; no Docker, network or credential action is evidence
for this RED wave.

Corrective RED classification on the rejected exact base: syntax and typecheck
PASS; candidate contracts/domain controls are 18/18 PASS; focused unified-
candidate plus product controls are 21 PASS and the one new intentional RED;
serialized deployment static is 193 PASS plus that same single RED; Sites
compatibility is 46/46 PASS. The RED reason is the absent production-used outer
terminal cleanup seam, not a changed receipt, product or deployment assertion.

The production correction exports that terminal seam, registers `discard`
before the first owned setup action and runs the unchanged lifecycle only after
setup completes. The exact 11-phase filesystem matrix is GREEN, including the
Compose-present/Buildx-unavailable case and deterministic setup-cleanup
`AggregateError`; typecheck, the 40-case focused 029A inventory and serialized
194-case deployment static suite pass. A replacement full terminal run and two
independent same-tree verifier reports are still required.

## Final candidate verification

The replacement credential-free candidate is complete on exact commit
`fc2f6e0677c64dc4f2ee90a85219bcc9f8c9bfbc` / tree
`f7cebc6ed3842f296b3be1c96645e2dd8cdfe5bd`. Its canonical candidate SHA-256 is
`8991e7e49f4570702436c269c8f6bd0af7b8f186997bff2a52e6da22f7a0cdda`.
Independent Core PASS report
`/private/tmp/proofline-029a-verifiers/fc2f6e0/core-verifier.md` has SHA-256
`d03dd65f00b120420734cba2d6473ccb8bcb0e9cd8f614174f8939a93533b60b`;
independent Product PASS report
`/private/tmp/proofline-029a-verifiers/fc2f6e0/product-verifier.md` has SHA-256
`b396a60978279a48db4220d873ce5188b4848cf769d7715d30f828fb1092bd11`.
These reports authorize the separate 028B credential gate; they are not hosted,
deployment or security-scan evidence. Scan 8852 remains user-canceled and is
not a security PASS; the documented deferred evidence-integrity risk remains
open.

## Terminal static-gate serialization correction

The exact `e007995` candidate freeze twice completed its unit, coverage and
real PostgreSQL gates, then exposed one retained 027C process-group reaping
timeout while deployment contract files were still competing in parallel.
The identical complete deployment inventory immediately passed 263/263 when
run alone. The terminal `test:docker:static` command now fixes Node test-file
concurrency to one. This preserves every assertion and timeout while making the
documented serialized gate literal and reproducible after the heavy matrix.
