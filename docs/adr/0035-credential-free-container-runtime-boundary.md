# ADR 0035 — Credential-free container runtime boundary

Status: accepted

## Context

[ADR 0029](0029-digitalocean-vds-deployment.md) selects one DigitalOcean
Droplet/VDS running Web, API, worker and PostgreSQL through Docker Compose
behind Caddy. The repository does not yet contain a Dockerfile, Compose file,
Caddy configuration or Docker-secret adapter. The current API and worker accept
secrets directly from process environment variables; the worker also requires
live Coston2 authority and a migrated database before it can perform honest
production work.

Slice 027A must make the container and routing boundary reviewable without
inventing migration, readiness, worker-heartbeat, backup or hosted evidence.
It therefore separates image and topology truth from the lifecycle work owned
by 027B and the restore work owned by 027C.

## Decision

### Delivery waves

027A is one architecture boundary delivered in three stopped-tree waves:

1. **027A1** freezes the base-image lock, multi-target image contents and the
   secret-file adapter;
2. **027A2** freezes Compose networks, Caddy routing and the dependency-free
   Web static server;
3. **027A3** builds from a controlled local cache, repeats builds with no
   network and runs the bounded local Docker smoke.

No wave may call a local result hosted, deployed, migration-ready or live
Coston2 evidence.

### Immutable base-image lock and application images

`docker/base-images.json` is a strict checked-in lock with the following exact
official identities. The index digest is provenance; every Linux production
`FROM` or Compose `image` selects the Linux/amd64 manifest digest directly and
also declares `--platform=linux/amd64` or `platform: linux/amd64`.

| Image | Tag | Index digest | Linux/amd64 manifest digest |
|---|---|---|---|
| `node` | `22.14.0-bookworm-slim` | `sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b` | `sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de` |
| `caddy` | `2.10.2-alpine` | `sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d` | `sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83` |
| `postgres` | `17.6-alpine` | `sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94` | `sha256:747d5ed1fdeeb124b880fbe3d7c6557d2c4064ae41d6b6297d417882effce4be` |

`docker/Dockerfile` is one multi-target application build with final targets
`web`, `api` and `worker`. It never copies host `dist`, `node_modules`, `.git`,
environment files or the Sites worker. A fresh lockfile install builds:

- Web into a dependency-free Node static runtime containing only the fresh
  `dist/client` plus `docker/web-server.mjs`;
- API into a Node runtime containing the ordinary bundled server, the separate
  build-only 024B importer, migrations 001–009 and the exact three canonical
  Solidity sources needed by runtime verification;
- worker into a Node runtime containing its fresh bundle plus the external
  runtime dependencies `pg` and `solc`.

The importer is never linked into or invoked by ordinary API startup. The Web
image never contains `worker/index.js`, `.openai/hosting.json` or
`dist/server/index.js`. `docker/caddy.Dockerfile` is a separate custom edge
image from the pinned Caddy manifest.

BuildKit prefetches only the checked-in locked official manifests and the
lockfile dependency cache. The first controlled build populates that cache;
the acceptance repeat uses `--network=none` and npm offline mode. Production
Compose accepts application image references only as immutable
`repository@sha256:<64 lowercase hex>` values and uses `pull_policy: never`.
The QA override may use only locally built tags and also uses `pull_policy:
never`. 028A later exports the built images and freezes their distinct image
and archive digests; 027A does not anticipate those output digests.

### Secret-file boundary

Compose supplies secrets only as mounted files. A single API-owned deployment
adapter is reused by API, worker and the separate recording importer through
`resolveDeploymentEnvironment(profile, environment)`, where `profile` is
exactly `api`, `worker` or `recording-importer`.

The strict profile allowlists are:

- API: `DATABASE_URL`, `PROOFLINE_TOKEN_DIGEST_KEY`;
- worker: `DATABASE_URL`, `PROOFLINE_VERIFIER_API_KEY`,
  `PROOFLINE_COSTON2_PRIVATE_KEY`;
- recording importer: `DATABASE_URL`.

Every required name is supplied by exactly one of `NAME` or `NAME_FILE`.
Supplying both or neither fails before Pool construction, listening, verifier
composition, file mutation or network I/O. Unknown `DATABASE_URL_FILE` or
`PROOFLINE_*_FILE` names fail closed. Direct values retain the existing
trim-and-nonempty compatibility boundary. A file path is opened without following
symlinks, then must be a regular file of 1–4096 raw bytes, valid UTF-8 after
bounded reading, contain no NUL and contain a non-empty value after the same
trim normalization as the direct environment form. The returned environment
does not retain `_FILE` entries.

All secret-boundary failures use the fixed code
`DEPLOYMENT_SECRET_CONFIGURATION_INVALID` and fixed message
`Deployment secret configuration is invalid`; neither secret content nor the
source path or filename may appear. PostgreSQL uses its native file-based
password input. Caddy receives no secret in 027A; its public origin and state
volume are configuration, not credentials. Committed dummy credentials and
test-adapter production fallbacks are forbidden. `.env` and `.env.*` are
ignored, except a deliberately secret-free `.env.example` if one is introduced
later.

### Compose topology

The service set is exactly `caddy`, `web`, `api`, `worker`, `postgres`; Redis,
the Docker socket, host networking and privileged containers are absent.
`caddy` and `web` start by default. `api`, `worker` and `postgres` belong to the
explicit `runtime-after-027b` profile. The bounded 027A QA smoke explicitly
targets `caddy`, `web`, `postgres` and `api`; it never starts worker and never
claims application readiness.

Networks have exact membership:

- `public_edge`: Caddy only, for public ingress and later ACME egress;
- internal `web_internal`: Caddy and Web;
- internal `app_internal`: Caddy and API;
- internal `db_internal`: API, worker and PostgreSQL;
- `worker_egress`: worker only, with no published port.

Only Caddy publishes host TCP ports 80 and 443. Web and API listen internally
on 8080, PostgreSQL on 5432 and worker has no listening port. PostgreSQL data
and Caddy state/config use named volumes. Production and staging select
different Compose project names and therefore different networks and volumes.
No application container receives a bind-mounted source tree, Docker socket,
host network or public host port.

App and Web runtimes are non-root, read-only and receive a bounded tmpfs. All
services drop capabilities and set `no-new-privileges`; Caddy alone receives
`NET_BIND_SERVICE`. Writable PostgreSQL and Caddy named volumes are explicit
exceptions. Logging, resource bounds and stop grace periods are finite.

### Routing and bounded QA

Caddy matches exact `/api` and `/api/*` before the Web route, strips `/api`
exactly once, preserves the query string and reverse-proxies API on the private
application network. API failure or absence never falls back to the SPA. Web
serves existing hashed/static files, returns 404 for missing asset-like paths,
and returns the exact client `index.html` only for non-asset application deep
routes.

QA binds a random loopback HTTP port, makes `public_edge` internal so local
Caddy performs no ACME or other egress, creates temporary local secret files
and runs with no external network, registry access, pull or worker. It proves the
root and accepted deep routes, an anonymous DB-free API template response,
query preservation (the strict template endpoint keeps rejecting a query),
strip-once behavior, API/asset fail-closed behavior,
private network membership, named volumes, absence of the Docker socket and
that only Caddy has a host binding. Temporary projects, containers, networks,
volumes and secret files are removed by exact project identity.

The PostgreSQL engine may use `pg_isready` only as an engine-liveness signal.
027A adds no API `/healthz`, `/readyz`, schema probe or worker heartbeat and
does not reinterpret Caddy routing or `pg_isready` as readiness.

## Deferred authority

027B exclusively owns the one-shot exact-API-image migration command, ordered
checksums, advisory lock, login-role/grant bootstrap, exact schema verification,
API `/healthz`, `/readyz`, the persisted deployment worker heartbeat and
retention. It must replace profile blocking with verified startup order before
full runtime acceptance. The existing command-lease heartbeat is not a
deployment heartbeat.

027C exclusively owns WAL archiving, base backup, MinIO and restore into a new
isolated PostgreSQL volume. `pg_dump`, volume copy, same-volume restart,
container/Droplet snapshot or a skipped MinIO test is not PITR evidence.

029A later owns the credential-free full local product journey using recorded
fixtures. It must not make the live worker accept dummy credentials or import a
test adapter into production.

## Consequences

- Container files, deployment scripts and secret loading become release-path
  code and require frozen tests plus two targeted verifiers.
- Local Docker evidence remains credential-free and non-hosted.
- Sites stays an unchanged compatibility package and is not copied into the VDS
  Web image.
- Redis and Helm remain absent; introducing either requires a new decision that
  revisits ADR 0029 and this ADR.
