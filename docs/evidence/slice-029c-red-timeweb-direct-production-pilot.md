# Slice 029C RED evidence — Timeweb direct-production pilot

Date: 2026-08-12

## Exact baseline

- commit `99918ab43c2186286f8fd0f116dcff6e13f7aba6`;
- tree `a24d08a47fb30a30edc1eeb3c5511c55e00fde8b`;
- initial status clean;
- Product FAIL report SHA-256
  `2186ed3400ac917409f26c2fde6653d9a70dd8b6dd015233970ba32e0811ead9`.

Product verification proved two P1 failures: generic `{status:"passed"}`
preflights reached provisioning, and all synthetic seven-day checkpoints plus
terminal evidence completed in milliseconds. It also found no explicit
cutover effect. The corrected rollback V1 byte/checksum binding is retained as
a GREEN compatibility control.

## Frozen intentional failures

The tests require absent V2 contracts and runtime seams for exact Timeweb
shared-pilot authority, direct production without staging, typed preflights,
the ordered Open-Meteo/ETH safe-consumer registry, explicit Caddy cutover and a
trusted-clock resumable 24-hour acceptance chain. Generic preflight objects,
partial consumer deployment, early/fabricated checkpoints, V1-only effect
authority or noncanonical inputs must cause zero PASS/effect.

No credential value or rotation deadline is recorded. Shared-pilot authority
is not described as least privilege. MinIO remains QA-only; Swift is outside
the runtime. No network, Docker, production or hosted effect runs in RED.

## Gate chronology

- syntax and typecheck: PASS;
- focused V2 plus retained 029B/Slice009 purity: 43 retained controls PASS and
  10 intentional RED from absent V2 exports/domain seams;
- focused deployment: 7 retained 029B controls PASS and 3 intentional RED from
  absent direct-pilot/resume runtime entrypoints;
- serialized deployment static: 221 retained controls PASS and the same 3
  intentional RED;
- Sites compatibility: 46/46 PASS after retaining the historical 029B
  credentialed promotion/canary statement.

Only tests and canonical documentation belong to this commit.

## Retained 027B compatibility correction

The first GREEN implementation pause exposed stale retained 027B assertions:
they still authorized one global `PROOFLINE_SAFE_CONSUMER_ADDRESS` and exactly
two worker bind mounts. The corrected contract requires the host
`PROOFLINE_SAFE_CONSUMER_REGISTRY_FILE`, mounted read-only at
`/run/proofline/evidence/safe-consumer-registry.v1.json`, as the third evidence
input. A missing registry file must fail in the production wrapper before its
Docker adapter is invoked. The old address is absent from the rendered worker
environment. The paused production stash was inspected read-only and was
neither applied nor modified.

The corrected retained 027B file classifies 10 controls PASS and three causal
RED cases. The combined focused deployment set classifies 17 controls PASS and
six intentional RED cases; the 029C pure/purity set remains 19 PASS and ten
intentional RED. Serialized static exposed only those intentional failures plus
the retained TERM-reap timing control under load; its isolated 12/12 rerun PASS.
Sites remains 46/46 PASS.

## Production-effect seam correction

The next implementation pause showed that the orchestration-level injected
`safe-consumer-deployer` and canary resume function did not freeze two actual
production entrypoints. Corrective RED now requires a pinned-solc, official
Coston2 import, mode-0400 relayer-file deployer with exact chain/balance/two
receipt/two runtime-code evidence and atomic canonical registry/deployment
publication. A second boundary requires absolute file-only direct-pilot CLI
authority plus a root-owned systemd oneshot/timer that resumes from the real
host clock, appends only one due checkpoint and cannot terminal-pass before 24
hours. All failures use injected adapters or local temporary files; no network,
credential, Docker, systemd installation or production effect is performed.

Classification after this correction: syntax/typecheck PASS; the 029C
pure/purity focus has 19 retained PASS and 11 intentional RED; the combined
027B/029B/029C deployment focus has 17 retained PASS and 11 intentional RED;
nearest compiler/Solidity controls are 4/4 PASS; serialized deployment static
is 218 PASS plus the same 11 intentional RED; Sites is 46/46 PASS.

## Worker registry fixture compatibility

A later GREEN pause exposed two retained worker suites whose success fixtures
still constructed `PROOFLINE_SAFE_CONSUMER_ADDRESS`. They now share one
canonical exact two-entry registry fixture written mode 0400 and provide only
`PROOFLINE_SAFE_CONSUMER_REGISTRY_FILE`. Success expectations carry the parsed
registry authority, never the legacy address or host path. Missing, relative,
symlinked, wrong-mode and malformed registry files fail before Pool, schema,
heartbeat, claim or network effects. The production source and built worker
remain forbidden from using the legacy variable or a NODE_ENV test bridge. The
paused GREEN stash was not inspected, applied, modified or dropped.

On exact compatibility base `460d9c697fc50e87449d12720a4643f690183b97`
the two retained worker files classify as 31 controls plus 22 intentional RED:
the accepted registry-file boundary is absent from the stopped production
source, so rejection happens before Pool or network authority. The 029C/purity
focus remains 18 controls plus 12 intentional RED, serialized deployment
static is 217 controls plus the same 12 intentional RED, and Sites remains
46/46 PASS. Typecheck and diff-check PASS. These are RED evidence, not a
production, hosted or live-Coston2 claim.

## Direct-pilot input/output compatibility

A later implementation pause exposed two frozen authority errors. The direct
pilot uses an existing VDS through pinned SSH and therefore accepts no
DigitalOcean API token. Its required input inventory still contains the
read-only GHCR token, SSH key, Timeweb access/secret files, backup encryption
key and replay/backup evidence. The canonical safe-consumer registry is a
deployer output, not an input: its exact fixed path is proven absent before the
first deployment effect, then the two-consumer deployer publishes it mode 0400
with atomic no-replace semantics. A pre-existing output fails closed; no
caller-authored registry can satisfy preflight. Production WIP and all stashes
were left untouched.

Compatibility classification on exact base `c8533f1811e7797925cfb9aede060109c68d9ca0`:
syntax and typecheck PASS; the two exact deployment files are eight intentional
RED; serialized deployment static is 218 controls plus 11 intentional RED
(the same eight 029C seams and three retained 027B registry seams); Sites is
46/46 PASS. No credential, provider, host or registry effect was attempted.

## Cutover and terminal evidence

Corrective RED requires Caddy cutover plus strict external HTTPS observation
before checkpoint and canonical V2 deployment-evidence publication. Any
post-cutover observation/checkpoint/evidence failure rolls Caddy back exactly
once and leaves zero deployment PASS. The systemd 24-hour path consumes real
canonical `ProductionDeploymentEvidenceV2` bytes/checksum and emits canonical
`ProductionPromotionEvidenceV2` with `status:passed`, `promotionClaim:true` and
the same deployment digest; a non-PASS test receipt fails closed. The saved
GREEN stash was not inspected, applied, modified or dropped.

Classification on exact base `24257ca24732f9c17f4e2e2c8b90fa6093362295`:
syntax/typecheck PASS; the two focused deployment files are nine intentional
RED; serialized static is 218 controls plus 12 intentional RED (nine 029C and
three retained 027B); Sites is 46/46 PASS. No production or host effect ran.

The first terminal-systemd RED fixture was structurally stale against the
already frozen `ProductionDeploymentEvidenceV2`. It now carries the required
preflight evidence digest, exact Timeweb authority, exact database keys,
`timewebPitr`, no legacy volume identity or `healthz`, and the passed cutover.
This is a fixture-only compatibility correction; the preserved production
stash was not inspected, applied, modified or dropped.
The sibling direct-pilot canary test now uses the same fully canonical V2
handoff shape and independently computed checksum; its former
`test-bound-deployment` fallback is an explicit zero-promotion rejection.
Both canary stores now retain full canonical `ProductionCanaryCheckpointV2`
records with exact typed checks; no lossy ID/time/SHA projection or generic
observation can satisfy resume. The valid append fakes return exact passed
checksum receipts, while the deliberate non-PASS receipt remains causal RED.
Classification on exact base `f32c57da5e413903439195407dda2b4514d969a8`:
syntax/typecheck PASS; the exact two deployment files remain nine intentional
RED; serialized deployment static remains 218 controls plus 12 intentional RED
(nine 029C and three retained 027B); Sites is 46/46 PASS. The saved GREEN stash
was not inspected, applied, modified or dropped.

## Preflight and clock completeness correction

The stopped implementation pause exposed underspecified typed observations.
Corrective RED now requires the ordered five exact GHCR digest references, the
exact Timeweb endpoint/region/bucket/path-style authority with passed
PUT/HEAD/LIST/GET/DELETE capabilities, and Coston2 chain 114 with canonical
RPC/DA endpoints, public relayer address, decimal balance and configured
authorization. Missing, extra and mismatched records are causal no-provision
cases. Every full `ProductionCanaryCheckpointV2` now carries an exact
production-host synchronization observation with maximum skew five seconds;
skew above the bound fails before checkpoint append. The saved GREEN stash was
not inspected, applied, modified or dropped.

Classification on exact base `7ce011501cdb0a5d9226543d17849293836ce84c`:
syntax/typecheck PASS; contracts/domain are one retained control plus ten
intentional RED; the exact two deployment files remain nine intentional RED;
serialized deployment static remains 218 controls plus 12 intentional RED
(nine 029C and three retained 027B); Sites is 46/46 PASS. No credential,
provider, host, registry or live effect ran.

## Compose lifecycle and publication rebinding correction

Read-only audit on exact clean base
`d0b076abc66e6e9c7e7609d7ce991a4cf277e02e` / tree
`1c2599053197f060be5cf9c3c2d7ed596ce17200` found two retained gaps. The
027A/027B suites capped runtime Compose at seven services and modeled the
generated registry as an independent host input. Corrective RED requires the
eighth hardened one-shot `safe-consumer-deployer`, one canonical evidence root,
both final files absent before deployer execution and the exact regular
mode-0400 pair before worker startup. The worker bind derives from that root
and remains read-only.

The old 028B publication SHA
`1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`
is retained only as a compatibility fixture. Corrective pure and deployment
tests synthesize a second canonical five-image publication, bind a fresh V2
authorization to its independently computed checksum, require the plan to use
only its ordered digest references, and reject the old otherwise-valid GHCR
observation before provisioning. IDs/order/repositories remain fixed; digests
are not hard-coded into the V2 schema. This tests/docs-only wave performs no
Docker, registry, credential, host or Coston2 effect, and the saved production
stash is not inspected, applied, modified or dropped.

Classification for this correction: syntax and typecheck PASS; the exact
contracts/domain focus is one retained control plus 12 intentional RED; the
029C deployment file is five intentional RED; retained 027A/027B focus is 24
controls plus eight intentional RED. Serialized deployment static is 215
controls plus the same 18 intentional RED (eight Compose/lifecycle and ten
existing/new 029C effect seams). Sites remains 46/46 PASS. Failures are the
missing production contracts/services/helpers only; no fixture, syntax or
unexpected control failure remains.

## Production host command corrective RED

On exact clean base `896fac921ea58b00be85286adce9906a77e3cb7d` /
tree `bf84d20dc3a60e4116e73519d455426ea6173feb`, the local production adapter
boundary still lacked a production-used, bounded VDS command entrypoint.
Eleven causal credential-free cases now freeze strict canonical base64url
decoding, the exact ID allowlist, SSH-derived UFW policy, read-only exact-digest
GHCR pull/inspection, fixed Compose phases, safe-consumer evidence lifecycle,
typed readiness/live/PITR, explicit Caddy activation, no-replace append, typed
canary observation and bounded redaction. Arbitrary shell/eval/exec authority,
caller-selected paths/services, mutable tags, public 5432/8080, reused restore
volumes and premature cutover are forbidden.

This is intentional RED because
`scripts/timeweb-production-host-command.mjs` is absent on the stopped tree.
No production, Docker, firewall, registry, Timeweb, Coston2, SSH or credential
effect ran. The production stash was not inspected, applied, modified or
dropped.

Gate classification: syntax and typecheck PASS; the exact host-command file is
11 intentional RED with no harness exception; serialized deployment static is
215 retained PASS plus 29 intentional RED (the prior 18 and these 11); Sites is
46/46 PASS. One first serialized static attempt also hit the retained 027C
TERM-reap timing control under load; its isolated file passed 26/26 and the
unchanged full serialized rerun produced the exact 215/29 classification.

Compatibility correction on exact clean `59fdf50270642a21e2813ac265c6e9ac5f85e97e`
adds the already-required orchestration command `rollback-caddy` immediately
after activation in the host allowlist. One additional causal RED requires the
exact staged-candidate/active-origin state, one fixed rollback adapter call and
no payload or caller-selected arguments. The production stash remains
uninspected and untouched.
Syntax/typecheck PASS; host-command focus is now exactly 12 intentional RED;
serialized static rerun is 215 retained PASS plus 30 intentional RED; Sites is
46/46 PASS. The first static attempt again hit the unchanged retained 027C
TERM-reap timing control under load; its isolated 26/26 PASS and clean rerun
classify it as infrastructure timing, not a new contract failure.

## Host envelope and concrete observation corrective RED

Read-only audit of the stopped production WIP after exact clean base
`c7d10266703e3d87d9f5f7ef04adf01cbd9bdb02` / tree
`c1465337fc47c4ce588153b1398445e125446186` found four integration gaps. The
host safe-consumer commands returned path-only records while the direct runtime
requires the canonical registry/deployment authority and exact registry
checksum marker; migrator returned generic PASS without manifest/schema
identity. The local SSH adapter used an unversioned `--request` envelope and
did not map internal IDs/payloads to the frozen host grammar. Finally its
default PITR, live-run and canary adapters referenced three scripts which were
not checked in, while retained RED exercised only injected fakes.

Corrective RED now requires bounded no-follow canonical reads and exact
cross-binding for the safe-consumer pair, detailed migrator output, one
canonical `--command` mapping over the current verified five images/run ID, and
an effect-free local credential-install marker. Three concrete import-safe
entrypoints freeze fresh-volume Timeweb PITR, exact two persisted live runs and
typed trusted-clock canary observation with no secret output. This wave changes
tests/docs only; the production stash remains untouched and no credential,
Docker, SSH, provider, registry or Coston2 effect is performed.

Classification on the clean RED base: syntax and typecheck PASS; the four 029C
deployment files contain exactly 28 intentional RED and no retained control;
the contracts/domain/Slice009 focus contains 18 retained PASS plus 14 existing
intentional RED. Serialized deployment static emits 215 named retained PASS and
36 named intentional RED (eight retained Compose/lifecycle cases and 28 029C
cases). Sites remains 46/46 PASS. All new failures are caused by the absent
production adapter/host/effect entrypoints or their frozen result fields; there
is no fixture, syntax or unexpected assertion failure.

## Real production default-effect corrective RED

Read-only inspection of the saved production candidate after exact clean base
`acd72de47875d589e5807e605596b3e331a7aeb8` / tree
`f36a96375415fc370d9ee3fb57e70f4db95c6843` found four final false-acceptance
gaps before any credential or host effect. Direct code built cutover PASS checks
locally instead of consuming the real pinned-host checkpoint. The live-run and
canary defaults threw, and PITR stopped before restore. The service-owned
safe-consumer output also could not simultaneously be canonical `root:root`
mode 0400 and directly readable by the UID-1000 worker.

This tests/docs-only correction freezes a real host `canary-observe` result
before deployment publication; a worker-container entrypoint that performs
SIWE and API-owned idempotent persisted-run flow for the exact two manifests;
an encrypted Timeweb base backup plus selected fresh-volume restore,
verification and cleanup; and real due host-clock canary observations. The
canonical pair is root-only, while one SHA-identical run-scoped UID-1000
mode-0400 handoff is the worker's read-only runtime input and never evidence
authority. No ninth long-lived service, token/key/signature output, Docker,
network, credential or production effect is permitted. The production stash
remains read-only and unapplied.

Classification: syntax, typecheck and diff-check PASS. The new default-effect
file is exactly three intentional RED cases; the direct-pilot file remains five
intentional RED and the host-command file remains 13 intentional RED. Retained
027A/027B focus remains 24 PASS plus eight intentional RED. Serialized
deployment static is 215 PASS plus 39 intentional RED, exactly the prior 36
plus these three new production defaults. Sites remains 46/46 PASS. No harness,
fixture or unexpected retained-control failure remains.

## Worker handoff compatibility correction

The first root-seal RED still retained one obsolete worker-mount source string:
`${PROOFLINE_SAFE_CONSUMER_EVIDENCE_ROOT}/safe-consumer-registry.v1.json`.
That contradicted the same frozen boundary because a UID-1000 worker cannot
read the canonical `root:root` mode-0400 file. The retained 027A/027B contracts
now require only `PROOFLINE_SAFE_CONSUMER_WORKER_HANDOFF_FILE` as the host bind
source, keep the canonical evidence root separately required for deployer/seal
lifecycle, and forbid the legacy address, caller registry-file interpolation
and direct root-to-worker mount. Deprecated variables are absent from the
production input inventory; the container-internal
`PROOFLINE_SAFE_CONSUMER_REGISTRY_FILE=/run/proofline/evidence/...` remains the
fixed parser path, not host authority. The GREEN stash remains read-only and
unapplied.

Classification on exact base `4d9970880406b2fbd27e0b8fb0e2453f38ebfefd`
/ tree `3cb5b565e018cf206c864cb7495a08f02207e15b`: syntax and typecheck PASS.
The retained 027A/027B focus is 12 PASS plus 20 intentional RED because the
clean production surface still requires the removed legacy input and lacks
the sealed handoff lifecycle. Serialized deployment static rerun is 203 PASS
plus 51 intentional RED, exactly the prior 215/39 classification with those
12 retained compatibility controls moved to causal RED; an initial run had one
unchanged 027C TERM-reap timing flake and the exact rerun classified it cleanly.
Sites remains 46/46 PASS. No production, dependency, Docker, network or
credential effect was performed.

## Pre-deployer handoff absence correction

The handoff path is required configuration but is not a generic runtime input
file. The retained lifecycle fixture no longer materializes it with secrets and
replay inputs: it supplies one absolute intended path and proves that target is
absent before the deployer. Only the host seal phase may create the exact
mode-0400 handoff before the explicit worker phase. This preserves both the
mandatory path contract and the no-preexisting/no-replace lifecycle without a
fixture-created false authority. The PITR adapter contract is unchanged; its
default run identity may remain closed over by the production adapter.

Classification on exact base `c81c456dc1bc44cfa33cc86c396fc920ee9e66e7`
/ tree `45d084bbd42edb71b1bd19389d10377e95641419`: syntax and typecheck PASS;
the retained 027A/027B focus is 13 PASS plus 19 intentional RED; serialized
deployment static is 204 PASS plus 50 intentional RED; Sites is 46/46 PASS.
The one corrected generic runtime lifecycle control moved from fixture-caused
RED to PASS while the absent production deployer/seal boundaries remain RED.

## Historical Spaces parser compatibility correction

The retained 027C deployment test no longer sends the historical DigitalOcean
Spaces configuration through the active production parser selected by 029C.
It preserves the exact ADR0037 Spaces record and `BackupEvidenceV1` history as
data, keeps the strict restore-plan parser executable, and separately proves
ADR0044 selects exact Timeweb shared-pilot authority. Historical evidence stays
readable without restoring obsolete Spaces deployment authority.

Classification on exact base `d9fb6091c6c5ac5d3c989a867f7a800a6671222a`
/ tree `e1fe37c73bb9888e2c1a285ce4ef95c96c564887`: syntax and typecheck PASS;
isolated retained 027C is 15/15 PASS; exact serialized static rerun is 204 PASS
plus 50 intentional 029C/compatibility RED; Sites is 46/46 PASS. The first
static run had two unchanged timing-sensitive retained failures under load;
the unchanged rerun and isolated affected suite classify the correction.

## V2 export and registry-selected worker fixture correction

The retained 029B feature inventory now freezes the exact combined V1/V2
production-promotion exports, root identity and effect-free feature wrapper
instead of treating the original fifteen V1 names as permanently exhaustive.
The worker port success fixture now uses the canonical built-in ETH/USD
manifest, its exact registry manifest SHA and selected consumer address. Wrong
URL and canonical-vulnerable negatives remain unchanged in authority and the
safe read must target the registry-selected address; the legacy arbitrary
`validManifest` plus `"safe"` success shortcut is no longer accepted.

Classification on exact base `a5d945cd6563d11e814061c31f6e2f4100123f3b`
/ tree `9cc9770e6c26caa70bc22eea9132080f79c68ae0`: typecheck PASS; the exact
two-file focus is 26 PASS plus two causal intentional RED. Retained
contracts/domain coverage, excluding the fourteen already frozen 029C/export
RED cases, remains exactly 100% statements, branches, functions and lines
(`1623/1623`, `777/777`, `366/366`, `1469/1469`). The authoritative worker
coverage command is intentionally non-green on this pre-GREEN tree because 24
frozen registry/V2 tests are the coverage-bearing paths; a filtered 241-PASS
control run cannot meet the release threshold while those paths are skipped
(77.64% lines / 74.01% branches). Worker coverage must be rerun unfiltered
after the production stash satisfies the frozen authority; this RED commit
does not claim the threshold.

Serialized deployment static remains 204 PASS plus 50 intentional RED and
Sites remains 46/46 PASS. Syntax/diff checks are clean; no production,
dependency, Docker, network, credential or generated-output change is part of
this correction.

## Daily backup and real archive-freshness corrective RED

The production boundary now freezes a separate root-owned 02:00 UTC Timeweb
full-backup oneshot/timer. Retention follows only exact post-backup WAL
switch/archive observation and current canonical backup evidence, using fixed
`wal-g delete retain FULL 8 --confirm`. Direct PITR and canary reject missing,
synthetic or stale archive observations; `archivePendingAgeSeconds` must be at
most 60. RED performs no systemd, PostgreSQL, Timeweb, Docker, network,
credential or retention effect; MinIO remains QA-only.

Classification on exact base `7b4d15a7dd705ecee2dc6f25d0e4475c8c0ad04a`
/ tree `7222201fdd382a9d085ced3403c08b733864614d`: typecheck PASS; the exact
affected focus is nine causal intentional RED and no harness failure; serialized
deployment static is 203 retained controls PASS plus 52 intentional RED,
including the new daily-backup boundary; Sites is 46/46 PASS. No production,
dependency, Docker, network, credential, systemd, backup, retention or generated
output effect was run.

## Production-author GREEN closure

The final implementation closes the frozen RED seams without restoring
staging authority or weakening V1 compatibility. It adds exact Timeweb
shared-pilot backup/PITR, a deterministic two-consumer deployment and
worker-registry handoff, typed preflights, explicit Caddy cutover, one canonical
append-only canary state root, a real host-clock 24-hour terminal boundary and
the root-owned 02:00 UTC backup timer. The canary cutover and timer now share
`/var/lib/orivra/production-canary/checkpoints`; writes use hard-link
no-replace publication and bounded `O_NOFOLLOW` mode-0400 reads.

Final local production-author evidence before commit: typecheck PASS; focused
029C deployment 33/33; serialized deployment static 256/256; core 57 files/661
tests and 100% statements/branches/functions/lines; full Vitest 264 files/2558
tests with only five files/43 configured skips; backend 92.03% lines/87.08%
branches; worker 91.39%/86.22%; Web 92.57%/85.91%; Testcontainers PostgreSQL
22 files/163 tests with zero skips; build, Sites 46/46 and Action byte-sync
PASS. The local matrix used no Timeweb, Swift, GHCR, SSH, DNS, VDS or live
Coston2 credentials/effects. It is not a hosted/deployed/security PASS; scan
8852 remains user-canceled and the accepted deferred 027C integrity risk stays
open. Exact-tree Core and Product verification rejected the candidate below.

## Independent verifier FAIL and corrective RED

Both independent verifiers rejected exact clean candidate
`97aae69bdbc4bc2944204f8d071ac953ac155cd8` / tree
`5d8965eed3149853a17959829422f0bac9f0a5e6`. Core report
`/private/tmp/proofline-029c-verifiers/97aae69/core-verifier.md` has SHA-256
`19bbdf15c7101c2e82977f0c1f0a8d1b01ef7404d17f4625d28aba78b446f367`;
Product report `/private/tmp/proofline-029c-verifiers/97aae69/product-verifier.md`
has SHA-256
`70a6475d77ad27a2a8b736deb8e6ea9fc26eebae28310610b58f646d3213981a`.

Corrective RED rejects the real nested activation-envelope mismatch and keeps
rollback authority from the moment Caddy is activated; removes the cutover
checkpoint's circular deployment-evidence read by supplying the exact two live
run IDs/manifests; separates UID-1000 run staging from root-private canonical
evidence; resumes an absent terminal promotion after four committed
checkpoints; forbids HTTP-only fabrication of browser PASS; and binds active
production backup evidence to exact Timeweb bucket `orivra-backet` while a
separate parser preserves historical Spaces bytes. No production, provider,
chain, browser, backup, Docker, credential or network effect is part of this
tests/docs-only wave.

Classification on exact rejected base
`97aae69bdbc4bc2944204f8d071ac953ac155cd8` / tree
`5d8965eed3149853a17959829422f0bac9f0a5e6`: syntax and typecheck PASS;
the five deployment focus files are 30 retained controls PASS plus seven
causal intentional RED; contracts/worker recovery compatibility is 25 PASS
plus three causal intentional RED; serialized deployment static is 253 PASS
plus the same seven deployment RED; the unchanged TERM-resistant process-group
control passes 12/12 in isolation; Sites is 46/46 PASS. Diff-check is clean.
## Retained Compose compatibility correction

The corrective RED exposed one retained 027A/027B contradiction: the old
Compose contract still required the UID-1000 deployer to mount the canonical
root-private evidence directory directly, while the frozen 029C boundary
requires a run-scoped staging mount that root seals into the canonical pair.
The retained contract now requires the staging mount and keeps the worker's
mode-0400 handoff mount. The canonical evidence root remains a host-lifecycle
authority and is no longer treated as a Compose interpolation prerequisite.

## Corrective production-author GREEN closure

The implementation closes all seven verifier/corrective RED cases: real nested
Caddy activation is normalized with post-effect rollback authority; cutover
uses the already persisted exact two Coston2 runs and a canonical browser
acceptance checksum; UID 1000 writes only a run-scoped staging pair which root
cross-binds and seals; four checkpoints retry an absent terminal promotion;
active Timeweb backup evidence requires literal `orivra-backet`; and the
historical Spaces parser remains separate.

Final pre-commit local gates on unchanged production bytes: typecheck PASS;
serialized deployment static 260/260; full Vitest 264 files/2559 tests plus
only five files/43 configured skips; contracts/domain 57 files/662 tests at
100% statements/branches/functions/lines; backend 92.03% lines/87.08%
branches; worker 91.39%/86.22%; Web 92.57%/85.91%; Testcontainers PostgreSQL
22 files/163 tests with zero skips; build, Sites 46/46 and Action byte-sync
PASS. Two offline no-pull/network-none builds and Docker 027A/027B/027C PASS;
the recovery gate restored a fresh volume and passed all eight exact negatives
with scoped resource cleanup. No provider, registry, SSH, DNS, VDS, Timeweb or
live Coston2 credential/effect was used. Exact-tree independent verification
is pending, and this is not a hosted/deployed/security PASS.

## Concrete pinned-session lifecycle corrective RED

Both independent verifiers rejected exact clean candidate
`4c828eac838d4dd0c977c39587dfb23431ff01b2` / tree
`8f2e0865fea465d43f2ed208b80729033a7f7d19`. Product report
`/private/tmp/proofline-029c-verifiers/4c828ea/product-verifier.md` has SHA-256
`efdcca3e7a76dedc1463a7a7f625e4a8ede0b5aaa9b29e63a4bf4cc1a131f832`;
Core report `/private/tmp/proofline-029c-verifiers/4c828ea/core-verifier.md`
has SHA-256
`008e5c5edf4d05922dfaa9d14eeb73bd8f287fcb2ffad9f5df26d8270ac6be0a`.

The real adapter cleared its only `activeSession` before the orchestrator called
its session-bound `rollbackCaddy`, so a post-cutover failure could leave the
public effect active. The new credential-free integration RED composes the
actual adapter factory and orchestrator with local fake SSH transport. It
requires success to close exactly once; rollback or owned-resource teardown to
run while the pinned session is alive and before that close; and aggregate
errors to retain causal, rollback/teardown and close order. An independent
rollback stub cannot satisfy it. No SSH, DNS, provider, chain, credential,
Docker, hosted or production effect is part of this tests/docs-only wave.

Classification on exact rejected base
`4c828eac838d4dd0c977c39587dfb23431ff01b2` / tree
`8f2e0865fea465d43f2ed208b80729033a7f7d19`: syntax and typecheck PASS; the
five-file deployment focus is 37 retained controls PASS plus one causal
intentional RED; serialized deployment static is 260 PASS plus the same one
RED; Sites is 46/46 PASS. Diff-check is clean.

## Official-verifier Open-Meteo JQ compatibility RED

A bounded real verifier probe returned HTTP 200 `INVALID: INVALID JQ FILTER`
for the frozen Open-Meteo JQ expression containing `| round`. Removing only
that unsupported builtin returned HTTP 200 `VALID`; the unchanged Coinbase
manifest also returned `VALID`. No secret, token, request authorization or raw
response payload is recorded here.

The corrected canonical Open-Meteo manifest SHA-256 is
`sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898`.
Tests now freeze those exact canonical bytes and propagate their identity
through catalog/provenance, the two-consumer registry, deployment evidence,
worker selection and both live-run gates. Production retains the former SHA and
filter on this intentional-RED base, so no fixture substitution can create a
false GREEN. This tests/docs-only wave performs no server, verifier, network,
credential, Docker, consumer-deployment or live-chain effect.

## Pinned-session lifecycle GREEN closure

The production orchestrator now preserves the pinned session until rollback or
owned-resource teardown completes, closes it exactly once afterward, and
retains deterministic aggregate order `[original, rollback-or-teardown,
close]`. The real adapter-factory integration case is GREEN together with all
five direct-pilot cases. After the one-file production change, typecheck,
serialized deployment static 261/261, contracts/domain coverage 57 files/662
tests at 100%, the full Vitest inventory 264 files/2559 tests plus only the
configured skips, and Sites 46/46 PASS. Exact-tree verification is pending; no
credential, network, host, registry, chain, Timeweb or production effect was
run and no hosted/deployed/security PASS is claimed.

## Current Open-Meteo verifier-compatibility RED classification

This later correction supersedes the prior local-GREEN status without changing
its historical evidence. On exact clean base
`0c8bc13311097468a5506f8b6249466dbe1c52dd` / tree
`01d84973650983318ff26ec47cf38b750d6eff9b`, syntax and typecheck PASS. The
catalog/029C pure focus is 49 retained controls PASS plus eight causal RED; the
worker focus is 72 retained controls PASS plus two causal RED; the deployment
029C focus is 22 retained controls PASS plus 16 causal RED; and the affected
API/Web public-template surface is 66 retained controls PASS plus 31 causal
RED. These overlapping failures all expose production's former manifest bytes
or SHA rather than substituting a corrected fixture at an authority boundary.

Serialized deployment static is 247 PASS plus the same 16 deployment RED. One
unchanged process-group control was blocked by sandbox `kill EPERM` in that
run and passed 1/1 when rerun alone with host process permissions. Sites is
46/46 PASS and diff-check is clean. No production file, generated artifact,
dependency, lock, server, credential, Docker resource or external effect was
changed or used by this RED wave.
