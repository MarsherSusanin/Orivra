# ADR 0043: Exact-digest production promotion and seven-day canary

- Status: Accepted contract; production-author GREEN locally; two independent
  verifiers pending; blocked on 028B staging evidence
- Date: 2026-08-12
- Refines: ADR 0029, ADR 0036, ADR 0037, ADR 0039, ADR 0041, ADR 0042

## Context

028B has published the accepted 029A candidate's five exact Linux/amd64 image
manifests. The canonical mode-0400 `PublicationEvidenceV1` has SHA-256
`1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`.
It binds producer `fc2f6e0677c64dc4f2ee90a85219bcc9f8c9bfbc` /
`f7cebc6ed3842f296b3be1c96645e2dd8cdfe5bd`, frozen manifest
`sha256:68859e50195d9735fd11d4b04d014c074543dc41ba2881ac0522a5b352b29bb8`
and these remote manifest digests, in order:

| ID | Immutable production reference |
|---|---|
| `caddy` | `ghcr.io/marshersusanin/orivra-caddy@sha256:cc394659cd7962ef02cfb2faf341334f4baef1f16f0fd776bbd8354e10270fe1` |
| `web` | `ghcr.io/marshersusanin/orivra-web@sha256:581d85c7ca0e8445843cce0e1d948a09a2a7b8a4b523d694f717ca1769934513` |
| `api` | `ghcr.io/marshersusanin/orivra-api@sha256:c1a4e45a3982c45259ecbec48bf449ccdb5e9817b364bed7e6cf01f41eaddd33` |
| `worker` | `ghcr.io/marshersusanin/orivra-worker@sha256:4a9599fb40a863c3aeb59d35f56b34e4283bdf7745f5b1e2117c8b864f39f396` |
| `postgres-recovery` | `ghcr.io/marshersusanin/orivra-postgres-recovery@sha256:aadd4aba5f0386f1182cffb2301f55d7fbd90121f5e8b929ed1d19977083b962` |

This proves registry publication only. There is no accepted canonical
`StagingDeploymentEvidenceV1`; ADR 0042 therefore blocks production effects.
The VDS inventory in the runbook proves a prepared host and pulled images, not
a running application, production readiness or live Coston2 PASS.

## Decision

### Immutable promotion authority

029B consumes only canonical UTF-8 bytes plus independently supplied SHA-256
values. Before the first DNS, DigitalOcean, SSH, Docker, database or Coston2
effect it must:

1. parse `PublicationEvidenceV1` and require the exact SHA above;
2. parse a real accepted `StagingDeploymentEvidenceV1`, verify its independent
   checksum and cross-bind producer, frozen manifest, publication checksum and
   all five ordered remote references;
3. parse one strict `ProductionTargetV1` whose provider/environment are
   `digitalocean`/`production`, whose origin/project/volume/secrets differ from
   staging, whose only public ingress is Caddy 80/443 and whose SSH endpoint is
   bound to a pinned host-key SHA-256;
4. parse an unexpired `ProductionPromotionAuthorizationV1` bound to the exact
   publication checksum, staging checksum and canonical production-target
   checksum; and
5. privately clone and recursively freeze every accepted value before any
   asynchronous boundary. Caller objects and object-only legacy input are not
   authority.

Absent, noncanonical, substituted, expired or mismatched input returns fixed
`PRODUCTION_PROMOTION_INPUT_INVALID` with zero production effect. The current
absence of staging evidence is an expected blocker, not an unavailable-state
fallback.

### Credentials and pre-effect validation

All secret authority is file-backed. DigitalOcean API, read-only GHCR pull and
restricted SSH credentials are distinct mode-0400 regular non-symlink files
below private mode-0500 roots. The server runtime secret root, replay bundle,
preflight report and backup evidence are independently checked before host
mutation. Direct secret environment values, argv secrets, SSH agent forwarding,
credential helpers, proxy credentials and ambient cloud/registry authority are
rejected and never logged or serialized.

Preflight proves, in order: exact DNS target; pinned SSH key; read-only GHCR
scope; complete Compose secret files; production Spaces endpoint, slot and
separate writer/reader/retention authorities; accepted replay bundle/report;
non-zero canonical safe-consumer address; and the authorized persisted live
Coston2 path. A string, fixture, test heartbeat or untyped success object is not
an observation.

### Exact production composition

The five publication references map exactly to
`PROOFLINE_CADDY_IMAGE`, `PROOFLINE_WEB_IMAGE`, `PROOFLINE_API_IMAGE`,
`PROOFLINE_WORKER_IMAGE` and `PROOFLINE_POSTGRES_IMAGE`. Syntax-only
`repository@sha256` validation is insufficient. Pull uses only the read-only
credential, re-inspects every local digest and never uses a tag, rebuild or
server-side conversion.

Production is isolated from staging by Compose project, origin, networks,
PostgreSQL volume, project token, relayer identity, backup slot/prefix and
secret root. Start order is PostgreSQL, `db-role-bootstrap`, one-shot
checksummed `migrator`, API, real worker, Web and Caddy. PostgreSQL 5432 and API
or worker ports have no host publication; Caddy alone publishes 80/443; no
application service mounts the Docker socket.

`ProductionDeploymentEvidenceV1` may be appended only after exact digest pull,
schema 10 migration/checksum verification, process health, `/readyz`, a
current real-worker heartbeat, production Spaces backup/PITR evidence and a
persisted live Coston2 run all return strict typed PASS observations. It binds
the publication, staging, authorization and frozen-manifest checksums, exact
five images, production target, fresh production volume identity, topology and
checks. It contains no secret value or path.

### Cutover and canary

Production cutover is a separate effect after deployment evidence exists.
`ProductionPromotionEvidenceV1` binds that deployment evidence and records
exact checkpoints `pre-cutover`, `post-cutover-15m`, `post-cutover-1h`,
`post-cutover-24h`, `post-cutover-72h` and `post-cutover-7d`. Terminal PASS
requires exactly 604800 seconds from start through the final checkpoint, with
readiness, current heartbeat, backup/archive freshness, disk pressure, browser
and persisted live evidence remaining accepted at every applicable checkpoint.
No earlier checkpoint is a seven-day PASS.

Deployment and promotion evidence are separate canonical append-only files.
Conditional create is atomic; an existing file/key is never overwritten or
deleted. A failed pre-cutover candidate writes no PASS and cleanup removes only
its run-owned project, networks, volumes, temporary credential/session state.
A post-cutover failure writes no terminal promotion PASS and may not destroy
the previous deployment or perform an automatic rollback without separate
authority. The first causal failure and cleanup failures are preserved in
deterministic order.

### Rollback

Application rollback selects one prior `verified` production deployment whose
immutable deployment evidence binds prior publication evidence, frozen
manifest and exact five remote digests. The current schema version must be
inside the prior manifest's compatibility range. For the current release that
range is exactly 10/10/10. Missing, draft, unpublished, mismatched or
schema-incompatible evidence returns `PRODUCTION_ROLLBACK_FORBIDDEN` before
effect. Publication evidence alone is never rollback authority. Database
rollback remains forward repair or a separately authorized new-volume PITR;
029B does not run down migrations or reuse the old data volume.

### Release cadence

The exact publication checksum above is the current contract checkpoint. A
future production-code change requires focused RED/GREEN, the unified matrix,
two fresh same-tree verifiers, a fresh 028A/029A freeze and publication before
its image can be promoted. Tests and docs cannot turn the current absent
staging artifact into authority.

## Consequences

- Slice 029B is production-author GREEN locally but remains effect-blocked until 028B appends real
  staging evidence and an operator supplies explicit authorization.
- Import-safe fake adapters may prove orchestration without credentials; their
  observations can never be published as hosted or live PASS evidence.
- No DNS, SSH, DigitalOcean, Docker, Spaces, GHCR or Coston2 effect is executed
  by this ADR or its RED wave.
- Redis, Helm, public PostgreSQL/API/worker ports and synthetic readiness remain
  excluded.
