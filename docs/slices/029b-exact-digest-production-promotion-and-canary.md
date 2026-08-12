# Slice 029B — Exact-digest production promotion and seven-day canary

Status: Historical V1 compatibility; active effect path superseded by
[ADR 0044](../adr/0044-timeweb-direct-production-pilot.md)

Decision: [ADR 0043](../adr/0043-exact-digest-production-promotion-and-canary.md)

## Outcome

Promote one already published and staged Orivra candidate to an isolated
DigitalOcean production Compose project by its exact five GHCR manifest
digests, then produce terminal evidence only after a seven-day canary.

Current registry checkpoint is exact canonical publication evidence SHA-256
`1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`.
No accepted `StagingDeploymentEvidenceV1` exists, so the production command is
deliberately unavailable and no hosted/readiness/live claim is made.

## Vertical waves

### 029B1 — Pure authority and planning

- add strict cycle-free schemas for production target, promotion
  authorization, deployment evidence, terminal promotion evidence and rollback
  authorization under `@proofline/contracts/production-promotion`;
- add a pure domain verifier that accepts canonical publication/staging/
  target/authorization bytes, independent checksums and time, then returns a
  new recursively frozen authority;
- cross-bind the exact ordered Caddy/Web/API/worker/PostgreSQL-recovery remote
  references and map them to the five fixed Compose image variables;
- reject absent staging, mutable/tagged images, staging/production overlap,
  expired authorization and schema-incompatible rollback before I/O.

### 029B2 — Credential and production composition adapter

- accept only mode-0400 regular non-symlink credential files under private
  roots; strip ambient registry/cloud/SSH/proxy authority;
- validate DNS, SSH pin, read-only GHCR, all runtime/Spaces files, replay
  evidence, safe consumer and live Coston2 configuration before provisioning;
- pull and re-inspect exact digests, then start PostgreSQL → role bootstrap →
  migrator → API → real worker → Web → Caddy;
- preserve only Caddy 80/443 public ingress, private PostgreSQL/API/worker and
  no Docker socket;
- append canonical production deployment evidence only after schema 10,
  readiness, real heartbeat, PITR and persisted live observations agree.

### 029B3 — Cutover, canary and rollback

- cut over only from an accepted production deployment artifact;
- record `pre-cutover`, 15m, 1h, 24h, 72h and exact 7d checkpoints; no partial
  checkpoint is terminal PASS;
- atomically append separate terminal promotion evidence after 604800 seconds;
- clean only run-owned failed candidate resources before cutover; after
  cutover retain evidence/previous deployment and require explicit rollback
  authorization;
- rollback only from canonical authorization, current/prior deployment and
  current/prior publication bytes plus independent checksums; cross-bind the
  exact ordered five prior immutable digest references and require the
  authorization's operator, expiry and schema range to accept current schema
  10 before effect. Object-only or tagged input is forbidden. Database repair
  is forward or new-volume PITR, never a down migration.

## Frozen RED

1. `packages/contracts/test/slice029b-production-promotion.contract.test.ts`
   freezes strict canonical schemas, exact digest inventory, topology,
   seven-day checkpoints and rollback compatibility.
2. `packages/domain/test/slice029b-production-promotion.contract.test.ts`
   freezes canonical byte/checksum handoff, private immutability, exact image
   plan, database-first order and rollback selection.
3. `tests/deployment/slice029b-production-promotion.contract.test.mjs`
   freezes pre-effect denial, typed runtime sequencing, atomic evidence,
   bounded failure cleanup and no-effect rollback rejection through injected
   adapters.

The exact real publication record is retained as a non-secret test checkpoint
at `tests/fixtures/slice029b-publication-evidence.v1.json`; tests canonicalize
that JSON and require the real byte checksum before using it. The schema-valid
staging values inside tests are inert contract inputs and are never accepted or
described as actual DigitalOcean staging evidence.

## Gates

RED author gate:

```bash
npm run typecheck
npx vitest run \
  packages/contracts/test/slice029b-production-promotion.contract.test.ts \
  packages/domain/test/slice029b-production-promotion.contract.test.ts
node --test tests/deployment/slice029b-production-promotion.contract.test.mjs
npm run test:docker:static
npm run test:sites
```

GREEN later requires focused package coverage, real credentialed staging
evidence, preflight denial cases, production black-box routing/readiness/live
checks, evidence reparse/checksums, scoped cleanup and two independent
verifiers on one stopped tree. It may not substitute fixtures, local Docker or
a running container for hosted production evidence.

## Exclusions

- no credentials, DNS/firewall/SSH/DO/GHCR/Spaces/Coston2 effect in RED;
- no production runtime, dependency, lock, Compose, Docker or generated Sites
  edit in this wave;
- no Redis, Helm, synthetic heartbeat, test adapter import or automatic valid
  rollback;
- no production PASS before terminal seven-day evidence.
