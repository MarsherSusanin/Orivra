# ADR 0029 — DigitalOcean VDS deployment boundary

Status: accepted

## Context

Proofline already has a Web build, a PostgreSQL API, a restart-safe worker and
persisted release clients, but it is not currently hosted or provisioned. The
deployment target must keep the API/worker command graph intact, keep database
and relayer surfaces private, and remain fully testable without infrastructure
credentials during product development.

Sites remains a useful compatibility package and routing contract, but it is
not the selected production host. This ADR supersedes only the Sites-hosting
portions of ADR 0001, ADR 0021 and ADR 0024. All other decisions in those ADRs,
including evidence integrity, fragment-only share handoff, exact-origin wallet
authentication and CORS fail-closed behavior, otherwise remain accepted.

## Decision

### Runtime topology

The MLP runs on a single DigitalOcean Droplet/VDS. Docker Compose runs Web,
API, worker and PostgreSQL on the same VDS. Caddy is the only public application
ingress and reverse proxy. It terminates TLS, serves the Web path through the
Web container and routes same-origin `/api/*` requests to the API after removing
the `/api` prefix. `PROOFLINE_WEB_ORIGIN` remains the exact public HTTPS origin.

Only inbound ports 80 and 443 are public. SSH is restricted to an explicit
administrator allowlist or VPN. Never expose host port 5432 for PostgreSQL. API
and worker ports are never public host ports, and no application container may
mount or expose the Docker socket. The DigitalOcean Cloud Firewall and host
firewall repeat this boundary; Docker networks isolate edge, application and
database traffic.

Production and temporary staging use separate Compose projects, networks,
PostgreSQL persistent named volumes, origins and credentials on the same
Droplet. Staging must not share a database, project token, relayer identity or
backup prefix with production. The single-host topology is an explicit MLP
trade-off; host-level failure isolation is deferred.

Sites is retained for compatibility only. Its existing build artifacts and
routing tests remain release inputs until a separate deprecation slice, but the
VDS image consumes only the static Web output and does not run the Sites worker.

### Immutable release and database start order

CI will build the Web, API and worker images once and publish them to GHCR.
Staging and production select immutable image digests (`@sha256`), never a
mutable tag or a server-side rebuild. A release manifest binds commit hash,
tree hash, image digests, expected schema version and Action artifact checksum.

A one-shot migration container uses the exact release API image. It obtains a
PostgreSQL advisory lock, verifies the ordered checksummed migrations already
recorded in the database, applies only the next migrations and verifies the
resulting schema version. Migration runs before the API and worker application
services start. API and worker startup must not apply migrations implicitly;
schema rollback uses a forward repair or a separately verified restore, never
an unreviewed down migration.

`/healthz` reports process liveness without dependency I/O. `/readyz` reports
database reachability, verified schema version and a current worker heartbeat.
The worker persists a heartbeat at a bounded interval; a heartbeat older than
the accepted readiness threshold makes the deployment degraded. Readiness is a
deployment gate and is not inferred only from a running container.

### Recovery

PostgreSQL owns a persistent named volume independent of container lifecycle.
Database recovery uses continuous WAL archiving plus regular base backup for
point-in-time recovery (PITR). Production backup bytes go off-host to a private
S3-compatible DigitalOcean Spaces bucket with a least-privilege credential,
retention policy and encryption. Development proves the same contract without
external credentials by running a MinIO-backed restore drill into a new,
isolated PostgreSQL volume and verifying schema and persisted evidence.

A DigitalOcean Droplet backup or snapshot is secondary host-recovery evidence;
it is not the database backup or PITR plan. DigitalOcean documents Droplet
backups as crash-consistent and notes that attached volumes are not included,
while PostgreSQL requires a base backup and the corresponding WAL sequence for
PITR. See the official
[DigitalOcean backup behavior](https://docs.digitalocean.com/products/backups/details/features/),
[Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/),
[Docker Compose service contract](https://docs.docker.com/reference/compose-file/services/)
and [PostgreSQL PITR documentation](https://www.postgresql.org/docs/current/continuous-archiving.html).

### Credential gate

Slices 022–029A are credential-free. They use focused TDD and targeted module
verification. After every credential-free module is implemented, one unified
local full matrix runs once, followed by two independent PASS reports for the
same tree hash. Only that evidence authorizes 028B.

DNS, restricted SSH, GHCR pull and Spaces credentials, the VDS environment and
live Coston2 secrets are requested or configured only after the unified matrix
and both PASS reports. Hosted staging, promotion and canary evidence therefore
cannot be claimed by this ADR or by the credential-free implementation.

## Consequences

- Docker and routing acceptance become production-hosting gates in addition to
  the existing Sites compatibility gate.
- The same-origin `/api` path removes the production cross-origin topology but
  does not weaken exact-origin wallet authentication or the existing bounded
  CORS implementation used by supported clients and local composition.
- A single VDS is operationally simple but shares host resources and failure
  domain across application services; resource limits, log rotation, backup
  age, disk pressure and worker readiness must be observable before promotion.
- Application rollback selects a prior schema-compatible immutable digest.
  Database repair remains roll-forward or restore-to-new-volume.
- No Droplet, DNS record, firewall, registry credential, Spaces bucket or live
  environment is created by accepting this decision.
