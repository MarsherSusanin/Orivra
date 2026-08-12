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
