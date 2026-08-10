# ADR 0035 — Credential-free container runtime boundary

Status: accepted

## Context

[ADR 0029](0029-digitalocean-vds-deployment.md) selects one DigitalOcean
Droplet/VDS running Web, API, worker and PostgreSQL through Docker Compose
behind Caddy. Before 027A the repository had no Dockerfile, Compose file, Caddy
configuration or Docker-secret adapter, and API/worker accepted secrets only
directly from process environment variables. The first implementation now
exists but is rejected pending the corrective boundary below. The worker still
requires live Coston2 authority and a migrated database before it can perform
honest production work.

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
lockfile dependency cache. Its import-pure orchestration creates a fresh
mode-0700 Docker CLI directory containing exact `config.json` bytes
`{"auths":{}}`, removes ambient `DOCKER_CONFIG`, `DOCKER_AUTH_CONFIG`,
`REGISTRY_AUTH_FILE`, home-directory auth paths and token/key variables from
every registry-capable child, supplies explicit daemon selection when needed,
and removes the temporary configuration on success or failure. This proves
CLI-side credential isolation only; it does not claim visibility into or
absence of daemon-global credentials.

The first controlled build populates the dependency cache; the acceptance
repeat uses `--network=none` and npm offline mode. The sole authorized
production Compose entry is `npm run compose:production -- ...`. Its executable
validator accepts only a lowercase repository path followed by
`@sha256:<64 lowercase hex>` and rejects a tag, uppercase, short, suffixed or
otherwise arbitrary reference before any Docker effect. It validates Caddy and
Web for the base, plus API and worker when the runtime overlay is selected.
Direct `docker compose` is an implementation detail, not a production operator
entry. QA local tags exist only inside the exact smoke runner and also use
`pull_policy: never`. 028A later exports the built images and freezes their
distinct image and archive digests; 027A does not anticipate those output
digests.

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
trim-and-nonempty compatibility boundary. A file path is opened with
`O_RDONLY | O_NOFOLLOW | O_NONBLOCK` before `fstat`, then must be a regular file
of 1–4096 raw bytes, valid UTF-8 after bounded reading, contain no NUL and
contain a non-empty value after the same trim normalization as the direct
environment form. A FIFO therefore receives the same bounded fixed failure
instead of blocking startup. The returned environment does not retain `_FILE`
entries.

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

The combined service set is exactly `caddy`, `web`, `api`, `worker`,
`postgres`; Redis, the Docker socket, host networking and privileged containers
are absent. Base `compose.yaml` contains only Caddy, Web, `public_edge`,
`web_internal` and the Caddy volumes. It renders independently with only the
Caddy/Web immutable images and one `PROOFLINE_PUBLIC_ORIGIN`.
`deploy/compose.runtime.yaml` adds API, worker, PostgreSQL, the remaining
networks/secrets/PostgreSQL volume and Caddy's application-network membership.
Those three services belong to the explicit `runtime-after-027b` profile. The
bounded QA smoke combines base, runtime and QA files and explicitly targets
Caddy, Web, PostgreSQL and API; it never starts worker and never claims
application readiness. Inactive runtime configuration is never required to
render the default base.

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

App, Web and Caddy runtimes are non-root, read-only and receive a bounded
`/tmp` tmpfs. All services drop capabilities and set `no-new-privileges`;
Caddy alone receives `NET_BIND_SERVICE`. Writable PostgreSQL storage and exact
Caddy `/data` and `/config` named volumes are explicit exceptions. Logging,
resource bounds and stop grace periods are finite.

### Routing and bounded QA

Caddy matches exact `/api` and `/api/*` before the Web route, strips `/api`
exactly once, preserves the query string and reverse-proxies API on the private
application network. API failure or absence never falls back to the SPA. Web
serves existing hashed/static files, returns 404 for missing asset-like paths,
and returns the exact client `index.html` only for non-asset application deep
routes.

QA uses the exact single authority `PROOFLINE_PUBLIC_ORIGIN=https://127.0.0.1`.
Both Caddy's internal-TLS site and API's `PROOFLINE_WEB_ORIGIN` derive from that
same variable. Before Compose starts, the runner attempts an exact bounded bind
of `127.0.0.1:443`; unavailable or unauthorized port 443 fails the gate and is
never skipped or replaced by a different origin. `public_edge` remains
non-internal because Docker Desktop cannot publish that loopback port from an
internal network; Caddy is its sole member and sole published service. Caddy
has only private Web and API upstreams. `web_internal`, `app_internal` and
`db_internal` remain internal; `worker_egress` is unused because QA never
starts worker.

The non-internal edge is not evidence that DNS or provider access is impossible.
The bounded no-external-effects claim instead requires Caddy internal TLS, the
exact internal upstream set, no live worker/provider credentials, and an HTTPS
runner request ledger that permits only `https://127.0.0.1` on default port 443
and explicitly rejects the Coinbase, Open-Meteo, Coston2 RPC and verifier
hosts. Exact allowed-origin `OPTIONS /api/v1/auth/wallet/challenges` returns
204 with matching ACAO and `Vary: Origin`; a hostile Origin is denied without
ACAO. This check creates no challenge, signature, wallet or live effect. QA runs
with no registry access or pull. It proves the root
and accepted deep routes, an anonymous DB-free API template response, query
preservation (the strict template endpoint keeps rejecting a query), strip-once
and API/asset fail-closed behavior, private-network membership, named volumes,
absence of the Docker socket and the live inspected loopback Caddy binding.
Topology alone makes no DNS/provider-denial claim. Temporary projects,
containers, networks, volumes and secret files are removed by exact project
identity.

### Rejected first production-author candidate

Commit `20e8d998318168b2aaf9622b9fce453ff6d9fe42`, tree
`9b2d7a5e10225a5e22297e2832f0a143b1016eeb`, is rejected. Independent Core
and Product verification found ambient Docker CLI credential inheritance, a
different QA/API origin, inactive-profile interpolation, unenforced immutable
image inputs, blocking FIFO open and a writable Caddy root filesystem. Its
historical local Docker run is not acceptance evidence for this amended ADR.

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
