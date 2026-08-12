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
