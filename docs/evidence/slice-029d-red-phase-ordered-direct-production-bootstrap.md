# Slice 029D RED evidence — phase-ordered direct-production bootstrap

Exact clean base: `361bac3091144fd507dc2e2e04acff91d969b385` / tree
`fe8e7717d0d22af394fc753373402ee41d33d5a2`.

The audit found one first-start authority cycle: static preflight and the
generic production Compose wrapper require backup, replay and hosted-browser
bytes before the private services and public cutover that must create them.
The ordinary worker's refusal to start without canonical replay bytes is a
retained security control, not the defect.

ADR 0045 and the frozen tests separate absent intended outputs from static
authority, add the bounded replay-bootstrap producer, require backup/WAL/PITR
before replay, and defer browser evidence until real public activation. The
same pinned session retains rollback authority until final evidence succeeds.

This wave changes tests/docs only. Current images remain undeployable under the
new contract and must not be published. No production, dependency, lock,
generated artifact, Docker, network, credential, provider or chain effect is
included. Final RED/control counts are appended after focused classification.

## Classification

Syntax and `npm run typecheck` PASS. The new bootstrap suite plus retained
027A/027B Compose lifecycle is 29 controls PASS plus 16 causal intentional RED:
four exact nine-service/dependency failures and twelve missing production-used
phase-runtime, live replay export, browser adapter, phase-aware Compose,
artifact and rollback seams. Serialized deployment static is 261 controls PASS
plus the same 16 RED. Sites is 46/46 PASS. Diff-check is
clean. These failures are the frozen production gap; there is no harness,
fixture, Docker or external-effect failure.

The follow-up causal inventory additionally freezes the live worker+API
Open-Meteo run-to-bundle/report export, immutable selected backup versus
append-only daily backup IDs, the production-used post-activation browser
adapter, early Compose service aliases versus consuming/generic-up denial, and
zero deployment evidence across every producer/seal/validation failure.

## Submission-mode identity corrective RED

The active public Open-Meteo and ETH manifests are both canonical replay-mode
bytes. API/worker relayer effects require a persisted relayer-mode manifest, so
using those replay SHAs for the 029D live gates is impossible. The correction
preserves public replay compatibility and freezes separate submission-only
relayer identities: Open-Meteo
`sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6`
(927 bytes) and ETH/USD
`sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f`
(629 bytes).

Safe-consumer registry remains replay-keyed. A strict pure alias proves the
live relayer/replay manifests differ only at submission mode and produce the
same consumer bytes before any RPC. Replay bootstrap records relayer source and
replay target identities after terminal proof/consumer validation. Raw or
cross-source aliasing is intentional RED and cannot be hidden by mocks.

This correction was frozen from exact clean base
`504f9edc994eb982ce3678de346b686d762c6541` / tree
`1ac4f19cabe4ba422dbf5cd70e6b9d625d04e30f`. Typecheck and all 46 Sites
controls pass. Focused domain classification is 5 controls PASS / 3 intentional
RED; exact 029D deployment classification is 1 control PASS / 14 intentional
RED; the retained 029C+029D integration set is 27 PASS / 26 intentional RED.
Serialized deployment static is 249 PASS / 30 intentional RED, all at the
already frozen missing phase-order or new relayer/alias/schema production
boundaries. No Docker, network, credential, server, build or production effect
was run.

## Hosted browser VDS handoff corrective RED

The production-used operator browser adapter now has one bounded handoff:
after Caddy activation it sends canonical acceptance bytes and their digest to
the exact allowlisted `append-browser-acceptance` host command. The host alone
strict-parses and no-replace publishes the mode-0400 JSON/checksum pair under
`/opt/orivra/evidence/browser/`. Caller paths, noncanonical bytes, wrong origin
or checksum, generic file writers and the obsolete root-level browser paths are
rejected. The returned digest—not an in-memory observation—is frozen as canary
and deployment authority. Any append or subsequent failure rolls Caddy back
before pinned-session close and produces zero deployment PASS.

On exact clean base `3f1f66924827e4b6df4f04cdebc8ced463a6d0bc` /
`d19d0f013c363c7357c8803fdabe13e05fc4e5fe`, typecheck and 46 Sites
controls pass. The browser/host focus is 12 PASS / 18 intentional RED;
serialized deployment static is 248 PASS / 34 intentional RED. New failures
are confined to the missing exact host allowlist/append, returned-digest
authority and canonical browser-directory production surfaces.

The follow-up V2 correction makes `cutover.browserAcceptanceSha256` mandatory
in `ProductionDeploymentEvidenceV2` canonical bytes/checksum and cross-binds it
to the exact host append receipt. Missing, malformed or receipt-mismatched SHA
fails before deployment evidence append. Historical V1 schemas and bytes are
unchanged. Typecheck and syntax pass; the pure focus is 13 control PASS / 2
intentional RED, the four deployment files are 20 control PASS / 24
intentional RED, serialized deployment static remains 248 control PASS / 34
intentional RED, and Sites remains 46 PASS. The two new pure failures are the
absent V2 schema field and its consequent fail-closed rollback parse; the
deployment failures remain confined to the already frozen production seams.

The retained-fixture compatibility follow-up makes generic lifecycle controls
return the exact browser host append receipt before they can reach deployment
append, and extends the retained host-command inventory with the already
frozen backup, WAL-freshness, PITR, retention and replay-bootstrap commands in
production phase order. It changes no runtime authority or historical V1 data.

The final fixture-only follow-up also returns that exact receipt from the
primary backup/replay lifecycle happy path and keeps the retained 029C
`start-web` / `start-caddy-candidate` / `readyz-real-heartbeat` /
`timeweb-pitr-production` relative order while inserting the 029D commands.

The post-effect activation correction freezes `activate-caddy` errors carrying
`cutoverApplied: true` as rollback-bound even when the phase call rejects
before returning an observation. Rollback precedes pinned-session close; the
original activation failure remains first in deterministic cleanup aggregation,
and deployment evidence is never appended. On the active production WIP,
typecheck and syntax pass; the 029D file is 15 control PASS / 1 causal RED,
serialized deployment static is 281 control PASS / 2 intentional RED (this
case plus the already frozen host-command expansion), and Sites is 46 PASS.

The retained 027A dependency guard now keeps all four protected Sites files at
their prior exact hashes while allowing only the production browser adapter's
root `playwright-core` declaration (`^1.62.1`), exact resolved 1.62.1 package
node and exact lock SHA-256 `2d45697a041b8bbc4c91b76c645cf5749a0f8e9293741c9a980ece95dc204896`.
Any extra Playwright package or lock drift remains a failure. The isolated
guard, typecheck, serialized deployment static (283/283) and Sites (46/46) all
pass on the active production WIP.

## Replay authority, staging and image corrective RED

On exact tests/docs base `3a41251a3620ad9ed97770af8f03074f76ab4e43` /
tree `23bb339ea4eec26116423e35da423fcb91484c75`, five causal contracts reject the
active production WIP without modifying it. The live entry currently references
the alias verifier without calling it; replay bootstrap substitutes invented
run/SHA projections for the actual bundle manifest and preflight run/URL; its
worker repository claims globally; the host never creates or owns the fixed
replay stage; and the final worker image omits the entry Compose commands.

The exact three-file focus is 33 retained controls PASS / 5 intentional RED.
The correction requires alias resolution before effects, actual exported-byte
cross-binding before staging, exact-run PostgreSQL claim authority, no-follow
UID/GID-1000 owned stage lifecycle, and a fresh build-stage copy into the final
worker image. No credential, Docker, network, server, build or production
effect is part of this evidence.

The GREEN implementation closes all five causal boundaries. The exact
three-file focus is now 38/38 PASS, the affected PostgreSQL repository focus is
28/28 PASS, typecheck is PASS, and serialized deployment static is 288/288
PASS after an unchanged retained 027C timing control passed both isolated and
immediate no-edit serialized reruns. Retained V2 fixtures were mechanically
updated to the already frozen live-relayer evidence and mandatory browser
digest; no production contract was weakened.

## Author GREEN matrix

The final author candidate separates the replay-bootstrap worker factory and
entry graph from the ordinary long-lived worker, preserving the retained
worker purity and environment-authority boundary while building and copying a
distinct immutable entry. The pure relayer-to-replay alias is browser-safe and
derives both live identities from canonical replay-equivalent manifests.

Final pre-freeze gates on the same production bytes are PASS: typecheck;
contracts/domain 59 files and 667 tests at 100% statements, branches,
functions and lines; backend 123 files / 1,232 tests at 91.90% lines and
86.94% branches; worker 26 files / 265 tests at 91.18% lines and 86.11%
branches; real Testcontainers PostgreSQL 22 files / 163 tests with zero skips;
Web 71 files / 601 tests at 92.57% lines and 85.91% branches; Solidity 30
files / 395 tests; E2E 3 files / 7 tests; build and protected Sites 46/46;
Action artifact sync 1/1; full root matrix 266 files / 2,564 tests with only
the 43 configured environment-gated skips. The serialized deployment static
inventory is 288/288 PASS. The earlier sandbox-only `listen EPERM` and one
unchanged retained timing failure were excluded only after the exact no-edit
outside-sandbox/serialized reruns passed.

This is author-local GREEN, not either independent verifier report, not a
fresh frozen release, and not publication, hosted, deployed, live Coston2,
Timeweb backup/PITR or security PASS. Scan 8852 remains user-canceled and the
accepted deferred 027C evidence-integrity risk remains open.

## Core fe18 corrective RED

Independent Core verification rejected exact clean candidate
`fe18f10efb22d09347041594d27fec6e4fa6f224` / tree
`5925c48cc8b69170ec921fa29953e70b71073ec3`. Report
`/private/tmp/orivra-release-fe18/verifiers/fe18f10/core-verifier.md` has
SHA-256 `f87c8756624e0bf0db6d1b8890e2668b2e5ff2c22eca63d9b5d1c831645d4ec6`.

Two release blockers are intentional RED. The authoritative phase-ordered
pilot must insert `observe-cutover-checkpoint` then
`append-cutover-checkpoint` after browser seal and before deployment evidence;
the canonical `cutover` entry is the initial state consumed by canary resume.
Either failure rolls Caddy back before session close and leaves zero deployment
PASS. Separately, the fixed host-owned
`/opt/orivra/replay-bootstrap-stage` must be the exact environment bind seen by
Compose. Ambient, default or caller-supplied roots fail before Docker; the
operator cannot discard or override the owned host authority.

This is tests/docs-only evidence. It makes no hosted, deployment, Timeweb,
Coston2, registry, Docker or security PASS claim.

Syntax and typecheck pass. The exact two-file focus is 34 retained controls
PASS / 3 intentional RED: phase grammar and canonical checkpoint handoff for
the P0, plus the real Compose environment bind for the P1. Serialized
deployment static is 287 PASS / the same 3 RED. Sites remains 46/46 PASS.

## Core fe18 corrective Author GREEN

The production correction closes the two frozen failures without changing
public evidence schemas. The phase grammar now observes and appends a strict
canonical `cutover` checkpoint after browser seal and before deployment
evidence. It binds activation time, browser receipt and the exact two persisted
Coston2 run IDs; observe or append failure rolls Caddy back before the pinned
session closes and writes zero deployment PASS.

The host Compose adapter now rejects ambient/caller replay-stage variables and
injects exactly `/opt/orivra/replay-bootstrap-stage`, while the Compose mount
has no fallback and keeps `create_host_path: false`.

Typecheck passes; the affected three-file deployment focus is 43/43 PASS and
the serialized deployment static inventory is 290/290 PASS. This remains
Author GREEN pending two independent reports on the final clean tree. It is
not publication, hosted, deployed, Timeweb, Coston2 or security PASS.

The first independent Product reverification of `c737113` stopped on two stale
tests that still required the superseded RED document status. Its mode-0400
FAIL report is `/private/tmp/orivra-release-c737/verifiers/c737113/product-verifier.md`,
SHA-256 `92067e8dfb0d779cedb211079f8c4bb5a26d6d7295bffa4c9dac4ffa16122e28`.
This compatibility correction changes only those status assertions and this
chronology; it does not alter production bytes.

## Core c737 canary-epoch corrective RED

Independent Core verification rejected exact candidate
`c7371130d9ed22cbf4a4dce00de708c1945666ca` / tree
`5ae1a114726b590f9e84cf8853bbf15399542c44`. The formal report is
`/private/tmp/orivra-release-c737/verifiers/c737113/core-verifier.md`, SHA-256
`686d9530fea4a0c0632600c1f93e3b70f35cb0867b4a70b9a3df7ceb9ae723d2`.

The accepted first `cutover` checkpoint can be observed after its due time.
Resume must nevertheless derive the 15-minute, 1-hour and 24-hour due times
from `cutover.dueAt == deployment.cutover.activatedAt`, not from
`cutover.observedAt`. The corrective test carries a real one-second observation
delay through all four append-only checkpoints and requires a canonical
terminal `ProductionPromotionEvidenceV2`. A separate causal case rejects a
first checkpoint whose due time differs from activation before observation,
append or promotion. This tests/docs-only RED makes no hosted, deployed,
Timeweb, Coston2, registry or security PASS claim.

Syntax and typecheck pass. The exact affected two-file focus is 25 retained
controls PASS / 2 intentional RED, and serialized deployment static is 289
PASS / the same 2 RED. Sites remains 46/46 PASS.

## Core c737 canary-epoch corrective Author GREEN

The production resume path now treats the deployment activation time and the
canonical first checkpoint `dueAt` as the single canary epoch. A delayed real
observation no longer shifts the 15-minute, 1-hour or 24-hour boundaries, and
the complete stored prefix is schema-checked against the fixed schedule before
any new observation or append. A mismatched first due time therefore fails
before effects. The correction remains Author GREEN pending two fresh
independent reports on one exact clean tree; it is not a hosted, deployed or
security PASS.

## Final candidate Docker build correction

The first credential-free freeze of `bf143b9` passed the complete test,
coverage, PostgreSQL, Solidity, E2E, build, Sites and static inventories, then
failed closed before candidate publication when the worker-image build could
not resolve the production relayer-manifest authority imported by the new live
gate. The Docker build stage now copies that exact checked-in production module
before compiling the worker entrypoint. No image, registry or server effect was
accepted from the failed attempt.

The next exact candidate attempt passed the unified test, coverage and real
PostgreSQL inventories and both offline build passes, then failed closed before
the QA Compose journey because the smoke runner did not materialize and bind
the now-mandatory replay-bootstrap stage root. The QA runner now owns that path
inside its already private run-scoped directory and supplies it only as the
required Compose interpolation input; worker remains absent from the QA
service inventory. The same outer lifecycle removes the stage with every other
temporary input. No candidate, registry or server effect was accepted from the
failed attempt.

The following candidate attempt proved that the same mandatory Compose input
also belongs to the separate runtime and recovery runners. Both now create the
same run-owned private stage beneath their existing temporary roots and bind it
without a fallback. Narrow tests freeze all three runner seams. No registry or
server effect was accepted from that pre-runtime failure.

Independent Core verification then found that the recovery runner supplied the
new stage but its exact credential-free environment allowlist still rejected
the name before Compose. The correction adds only that run-owned path to the
frozen allowlist. The recorded-product Compose gate now also creates the same
private input so interpolation cannot depend on ambient state. The interrupted
candidate produced no registry or server effect.

The exact rejected identity was `c7f16b75ac8e9dc73d976f615fe39ace08bda542`
/ tree `31338245c4fc21a2716a926a2f89c915b5f9e341`. Its mode-0400 Core
report is `/private/tmp/orivra-release-c7f/verifiers/c7f16b7/core-verifier.md`,
SHA-256 `4381cdfd1f3d985d9f74790357c9528b36812a261a8d7063bda0421ef37cc3f3`.

## Real VDS pre-effect host-runner and firewall correction

A bounded production-host probe made no deployment acceptance claim and found
two deterministic pre-effect failures. Invoking
`/opt/orivra/current/scripts/timeweb-production-host-command.mjs` through the
release symlink allowed Node to realpath the main module, so the exact file-URL
main guard returned exit 0 with empty stdout. Separately, Ubuntu rejected the
split UFW arguments `allow 80 tcp` and `allow 443 tcp`; because setup begins
with reset, the failed sequence left UFW inactive.

The correction gives every production host invocation the exact Node
`--preserve-symlinks-main` argument and freezes a real symlink-process test
whose unsupported command must execute and fail with the bounded JSON error.
The firewall adapter now emits exact source-IP SSH, default-deny incoming,
`allow 80/tcp`, `allow 443/tcp`, then enable, returning the unchanged bounded
PASS envelope only after the sequence succeeds. The exact two-file focus is
25/25 PASS; typecheck passes, serialized deployment static is 293/293 PASS and
Sites is 46/46 PASS. No credential, network, VDS, Docker, registry or
deployment effect was performed by this local correction; fresh independent
verification remains required.

## Core df8 nested symlink-main corrective GREEN

Independent Core verification rejected exact `df8f3b7e0e72a23e7ee5cd361269d211d67c02c6`
/ tree `7aabccd3db0d47d66cc11b59c0c1cbd10b518e4a`. Its mode-0400
report is `/private/tmp/orivra-release-df8/verifiers/df8f3b7/core-verifier.md`,
SHA-256 `4efce6f6d96aac44a34e736d0737b0da7535395bf13cf8b30afeaf4f398ad5f5`.
The outer host CLI and UFW sequence passed, but three nested CLIs under the same
`current` symlink—persisted live runs, Timeweb PITR and canary observation—still
used raw Node argv and silently exited before their file-URL main guards.

One bounded production helper now admits only fixed
`/opt/orivra/current/scripts/*.mjs` entries and constructs the exact
`--preserve-symlinks-main` argv. All three nested production spawns use it.
Real private symlink subprocess fixtures prove each main guard executes and
rejects invalid arguments instead of returning exit 0 with empty output. The
exact two-file focus is 26/26 PASS; typecheck passes, serialized deployment
static is 294/294 PASS and Sites is 46/46 PASS. No credential, network, host,
UFW, Docker, registry or deployment effect was used by this local correction;
fresh independent verification remains required.
