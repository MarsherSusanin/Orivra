# ADR 0045: Phase-ordered direct-production bootstrap

- Status: Accepted boundary; intentional RED
- Date: 2026-08-13
- Refines: ADR 0044
- Slice: [029D](../slices/029d-phase-ordered-direct-production-bootstrap.md)

## Context

The accepted 029C direct pilot has an unsatisfiable first-start cycle. Static
preflight requires backup evidence, replay bundle/report and hosted browser
acceptance before the private database/API, first Timeweb backup, persisted
Coston2 bootstrap or public Caddy activation can produce them. The production
Compose wrapper likewise requires replay and backup files before any runtime
`up`, while the ordinary worker correctly refuses to start without them.

Exact clean `361bac3091144fd507dc2e2e04acff91d969b385` / tree
`fe8e7717d0d22af394fc753373402ee41d33d5a2` is therefore publisher-ready only
for obsolete undeployable images. It must not be published or described as a
hosted/deployed production candidate.

## Decision

### Static authority and intended outputs

Static typed preflight is limited to DNS, SSH host pin, exact read-only GHCR
five-image authority, secret-file metadata without values, exact Timeweb
authority/capabilities, the two accepted manifests and live chain-114 relayer
configuration. It requires these fixed final paths to be absent, regular
parent directories private, and reserved for no-replace publication:

- `/opt/orivra/evidence/recovery/backup-evidence.v1.json`;
- `/opt/orivra/evidence/replay/proof-bundle.json`;
- `/opt/orivra/evidence/replay/preflight-report.json`;
- `/opt/orivra/evidence/browser/hosted-browser-acceptance.v1.json`.

Static preflight never opens those nonexistent files and contains no replay,
backup or browser PASS. Their later canonical checksums are deployment
observations, not input authorization.

### Exact phase order

One pinned-session lifecycle executes:

1. static typed preflight;
2. private PostgreSQL, role bootstrap, migrator and API;
3. deterministic two-consumer deployment and root seal;
4. real encrypted Timeweb full backup, canonical backup evidence, post-backup
   WAL switch/archive freshness (`archivePendingAgeSeconds <= 60`), fresh-volume
   PITR and only then evidence-authorized `FULL 8` retention;
5. one bounded production replay bootstrap from an actual terminal persisted
   Coston2 run on chain 114 and an exact accepted manifest;
6. atomic canonical replay bundle/report seal and independent ordinary-worker
   deep validation;
7. ordinary worker start and exactly two terminal persisted Coston2 runs;
8. private Web and candidate Caddy;
9. explicit Caddy activation, real external desktop/mobile/keyboard/axe/
   console/network/reload acceptance, atomic browser evidence seal;
10. cutover checkpoint and deployment evidence.

Any failure after activation rolls Caddy back through the still-open pinned
session before its exact-once close. No deployment PASS is written first.

### One-shot replay bootstrap

Production Compose has nine service definitions: the retained eight plus one
`replay-bootstrap` one-shot using the exact worker image. It is not a ninth
long-lived process. It runs as UID/GID 1000, read-only root filesystem,
capabilities dropped, no public port or Docker socket, bounded tmpfs and one
fresh run-owned staging directory. It starts only after healthy API and the
safe-consumer deployer, receives worker-owned relayer/verifier authority only
through fixed mode-0400 files, and is fixed to chain 114 plus the accepted
manifest tuple. It cannot import a test adapter, accept a generic command, or
start the ordinary worker. The ordinary worker depends on successful replay
bootstrap and the root seal/deep-validation boundary.

### Phase-aware input validation and sealing

Compose input validation is phase-aware. Late outputs may be absent only in
the exact allowlisted producer phases; every consumer phase requires its
specific canonical regular non-symlink mode-0400 input before any Compose or
PITR/canary effect. A generic `up`, `start`, `restart`, service-name alias or
environment toggle cannot bypass the grammar.

Backup, replay and browser writers use private run-scoped staging, bounded
`O_NOFOLLOW` reads, strict canonical parse, cross-binding and same-filesystem
no-replace rename. Parent/final directories are root-private. A failed parser,
symlink, wrong mode/owner, checksum mismatch, duplicate output, partial write,
timeout or cleanup failure leaves zero final artifact and never exposes secret
bytes or paths in argv, evidence or logs.

## Consequences

- ADR 0044 schemas and rollback authority remain compatible; only the active
  first-start lifecycle is refined.
- 029D must produce new images, repeat the credential-free freeze and obtain
  two stopped-tree PASS reports before any fresh GHCR publication.
- Existing 029C publication readiness is explicitly revoked; no provider,
  registry, VDS, Timeweb or live effect is authorized by this RED.
