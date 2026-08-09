# Slice 027A — credential-free container runtime

## Outcome

Proofline gains a reviewable Linux/amd64 image and private Docker Compose
boundary for the Web, API, worker and PostgreSQL behind Caddy. The slice proves
fresh image contents and same-origin local routing without registry access,
infrastructure credentials, a live worker, schema readiness or hosted claims.

Architecture authority: [ADR 0035](../adr/0035-credential-free-container-runtime-boundary.md),
refining [ADR 0029](../adr/0029-digitalocean-vds-deployment.md).

Risk: high release-path and secret-handling change; no persistence schema,
credential, provider or live Coston2 effect.

## Delivery split

### 027A1 — image and secret boundary

- strict `docker/base-images.json` records the exact Node 22.14.0, Caddy
  2.10.2 and PostgreSQL 17.6 index plus Linux/amd64 manifest digests frozen in
  ADR 0035;
- one `docker/Dockerfile` has fresh `web`, `api` and `worker` final targets;
  `docker/caddy.Dockerfile` owns the pinned Caddy edge image;
- API includes its ordinary server, build-only runtime-authorizing importer,
  migrations 001–009 and exact canonical Solidity sources; worker retains
  external `pg` and `solc`; Web contains only fresh client output and its
  dependency-free static server;
- API, worker and importer use the single strict profile-based secret-file
  adapter before any Pool, listen, verifier or network composition;
- `.dockerignore` excludes host artifacts and credentials; `.gitignore`
  excludes `.env` and `.env.*` while allowing only an explicit secret-free
  example.

### 027A2 — topology and routing

- `compose.yaml`, `deploy/compose.qa.yaml`, `deploy/caddy/Caddyfile` and the Web
  static server implement the exact five-service/five-network contract from
  ADR 0035;
- Caddy alone publishes 80/443; no API, worker or PostgreSQL host port exists;
- exact `/api` and `/api/*` strip once and never fall back to Web;
- Web returns the SPA shell only for application routes and returns 404 for a
  missing asset-like path;
- API/worker/PostgreSQL remain behind `runtime-after-027b`; QA explicitly
  targets PostgreSQL and API for DB-free routing but never worker.

### 027A3 — real Docker evidence

- a controlled prefetch validates every official locked identity before any
  build;
- fresh application/Caddy targets build for Linux/amd64, then repeat from the
  prepared dependency cache with BuildKit `--network=none` and npm offline;
- production image inputs require immutable digest references with pull never;
  the QA override uses local tags with pull never;
- a unique temporary Compose project runs the bounded loopback smoke, inspects
  ports/networks/mounts/users and removes only its own resources and secret
  files;
- Sites compatibility files remain byte-identical.

## Frozen public contracts

### Image lock

The lock is a strict JSON object with version `1`, platform `linux/amd64` and
exact `node`, `caddy`, `postgres` records. Each record contains repository, tag,
index digest and Linux/amd64 digest. Unknown fields, floating tags, unqualified
digests and mismatched Docker references fail.

### Deployment secret adapter

`resolveDeploymentEnvironment(profile, environment)` is async and supports
only `api`, `worker`, `recording-importer`. The exact allowlists, XOR rule,
file-only 4096-byte bound, UTF-8/NUL/regular/no-symlink checks and fixed
non-leaking error are those in ADR 0035. Direct values retain current
trim/nonempty compatibility and remain supported for existing non-Compose
operators, but production Compose mounts only secret files.

### Compose and Caddy

Service names, profiles, networks and published ports are exact, not examples.
Compose configuration must parse semantically through `docker compose config
--format json`; source regex alone is insufficient. Caddy configuration is
validated by the exact pinned Caddy image before smoke.

`public_edge` is not a general application network. `web_internal`,
`app_internal` and `db_internal` are Docker-internal. `worker_egress` has only
worker and no host binding. No service is privileged or receives host network,
the Docker socket or an unbounded log.

### Web server

The Web server accepts only a validated internal port and a fixed client root.
GET/HEAD existing files preserve bytes; asset-like misses are 404; non-asset
GET/HEAD deep routes return `index.html`; other methods fail without SPA
fallback. It does not proxy `/api`, read credentials, list directories or make
outbound requests.

## Intentional RED

The accepted parent has none of the deployment files, package scripts or
secret adapter. Frozen tests therefore fail only because the following
production surfaces are absent:

- `apps/api/test/slice027a-deployment-secrets.contract.test.ts`;
- `apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts`;
- `tests/deployment/slice027a-image-boundary.contract.test.mjs`;
- `tests/deployment/slice027a-compose-caddy.contract.test.mjs`;
- `tests/deployment/slice027a-docker-gates.contract.test.mjs`.

The tests must not pull or build during RED. 027A3 tests freeze commands and
scripts statically first; their real execution begins only after the GREEN
implementation and controlled prefetch.

## Acceptance

### RED and nearest controls

```bash
npm run typecheck
npx vitest run \
  apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts \
  --reporter=dot
node --test --test-reporter=dot tests/deployment/*.contract.test.mjs
npx vitest run \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/worker/test/bootstrap-coverage.test.ts \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/slice009-production-worker-purity.contract.test.ts \
  --reporter=dot --maxWorkers=1
node --test tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs
npm run build
npm run test:sites
```

RED records exact failures; a Docker build, pull or Compose start is forbidden
in the RED wave.

### GREEN image and Docker gates

```bash
npm run test:docker:static
npm run docker:prefetch
npm run test:docker
```

`docker:prefetch` is separately observable and validates the locked official
manifests. `test:docker` performs the no-network repeat and QA smoke with
`pull_policy: never`. Neither command accepts registry credentials or contacts
an upstream provider. The final handoff also runs affected backend/worker
coverage, root build and Sites compatibility.

## Explicit exclusions

- no migration job, login-role provisioning, `/healthz`, `/readyz`, schema
  readiness, deployment worker heartbeat or retention (027B);
- no WAL/base backup, MinIO, Spaces or restore (027C);
- no OCI archive/release manifest (028A), registry publication (028B), full
  credential-free product journey (029A) or promotion (029B);
- no Redis, Kubernetes, Helm, Docker socket, host network, dummy live secret,
  production test adapter, DNS, SSH, DigitalOcean or hosted evidence.
