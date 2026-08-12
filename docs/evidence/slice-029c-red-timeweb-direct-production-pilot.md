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
