# Slice 029B RED evidence — production promotion and canary

Date: 2026-08-12

## Baseline and authority

- RED base commit: `e135712073671cb89216bd587969021c282b81c0`
- RED base tree: `67f4a6533f10dcee8d9eeb0e6b998210b9097aa8`
- initial status: clean
- exact publication evidence file: 4285 bytes, mode 0400 at the operator
  checkpoint, SHA-256
  `1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`
- accepted publication adapter: `e2744415508650d14bd974b885842232d756e092` /
  `907fa93f4b604cd8f48d8ee9734a63e0e68d2440`
- accepted publication adapter reports:
  `b22316e932db9248157274bf4a864ee146f181d57a508388f08084ca1ef5fcf7`
  and
  `d52c5fa4154fc2041620626df691a170b778603c869df46cb83af601adcd7bdc`

The publication artifact is real and non-secret. The test fixture preserves
its exact canonical bytes. No accepted staging-deployment evidence artifact
was found. Therefore every 029B runtime case is intentionally RED and all
credentialed production effects remain forbidden.

## Frozen failures

The pure contract feature `@proofline/contracts/production-promotion`, pure
domain feature `@proofline/domain/production-promotion` and import-safe
`scripts/digitalocean-production-promotion-runtime.mjs` do not exist on the
baseline. The new tests require them to provide:

The retained Slice 009 purity inventory previously ended at the publication
feature. It now also freezes the exact `production-promotion` contract/domain
subpaths, root-export identity, cycle freedom, effect-free initialization and
zero worker custody. This is one causal intentional RED until those modules
exist; it does not grant the worker promotion authority.

1. exact canonical publication/staging/target/authorization byte authority;
2. exact five immutable production references and private frozen plans;
3. complete pre-effect DNS/SSH/GHCR/files/Spaces/replay/safe-consumer/live
   validation;
4. database-first start with Caddy-only 80/443 and no public app/database port;
5. typed schema/readiness/real heartbeat/PITR/live evidence;
6. separate atomic deployment and seven-day promotion records;
7. scoped failure cleanup and evidence-compatible application rollback.

Observed first run:

- syntax: PASS;
- `npm run typecheck`: PASS;
- contracts/domain focus: 17 tests, 10 retained controls PASS and 7 intentional
  RED because the two production-promotion feature modules/exports are absent;
- deployment focus: 5 intentional RED because the import-safe production
  runtime and rollback entrypoints are absent;
- retained 028B pure controls: 43 PASS;
- retained 028B staging plus DigitalOcean-roadmap controls: 26 PASS;
- Sites compatibility: 46 PASS.

## Production-author GREEN

The production author added strict cycle-free contract/domain features and the
import-safe injected production runtime. Final local gates PASS: typecheck;
focused purity/contracts/domain 42/42; deployment orchestration 5/5; full
contracts/domain coverage 100% statements, branches, functions and lines; full
serialized deployment static 219/219; Sites 46/46. No credential, DNS, SSH,
Docker, registry, Spaces, Coston2 or production effect ran. Accepted staging
evidence still does not exist, so every real production effect remains blocked
pending two independent same-tree verifier reports and the credentialed staging
artifact.

- full serialized deployment static: 219 tests, 214 retained controls PASS and
  the same 5 intentional runtime RED cases fail on absent entrypoints;

No assertion failed for a fixture or harness reason. The final committed
identity is recorded in the writer handoff.

## Claims deliberately absent

- No `StagingDeploymentEvidenceV1`, production deployment or seven-day canary
  PASS exists.
- No credential, network, Docker, VDS, DNS, SSH, Spaces, registry or live
  Coston2 effect was used by this RED wave.
- The prepared VDS and pulled images are not production readiness evidence.
- Scan 8852 remains user-canceled/not a security PASS and the deferred 027C
  evidence-integrity risk remains open.

## Corrective rollback RED after Core verification

Core rejected exact candidate `c0828d1ce96c54cd093fc65a26026fd8c45374fc` /
tree `8cea88b52daeeb95d7ddbc37393d64b1af260a39`. Durable report
`/private/tmp/proofline-029b-verifiers/c0828d1/core-verifier.md` has SHA-256
`5fc1b4810f047438afbdb61e8a08206fac312ea67ef033dbaa842a1f06bd61d1`.
The reproduced object-only rollback accepted a shaped prior record containing
tagged `:latest` image references and invoked `apply` once without canonical
authorization or current/prior deployment/publication evidence.

The corrective tests freeze five canonical inputs with independent checksums:
one rollback authorization, current/prior production deployment evidence and
current/prior publication evidence. They require exact authorization binding,
the ordered five prior immutable repository/digest/reference tuples, operator,
expiry and schema compatibility before effect. Noncanonical bytes, shaped but
unbound SHA values, tag/object-only input and evidence substitutions must
produce zero effect. No production code, credential, network, Docker, VDS or
live effect is part of this RED correction.

Corrective RED classification: syntax and typecheck PASS; focused
contracts/domain/worker purity has 38 retained controls PASS and 5 intentional
RED; deployment focus has 5 retained controls PASS and 2 intentional rollback
RED; serialized deployment static has 219 retained controls PASS and the same
2 intentional rollback RED; Sites compatibility has 46/46 PASS.

The production author correction derives rollback authority exclusively from
the five canonical byte handoffs and independently supplied checksums, binds
authorization/operator/expiry/schema and the ordered five immutable image
tuples, then passes only the recursively frozen private authority to `apply`.
Final local gates PASS: typecheck; focused purity/contracts/domain 43/43;
deployment 7/7; contracts/domain coverage 100% in all four metrics; serialized
deployment static 221/221; Sites 46/46. No external or production effect ran;
two fresh same-tree verifier reports are required.
