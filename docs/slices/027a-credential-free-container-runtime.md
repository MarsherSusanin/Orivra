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
  adapter before any Pool, listen, verifier or network composition; secret
  files use nonblocking/no-follow open before `fstat`, so a FIFO cannot hang
  startup;
- `.dockerignore` excludes host artifacts and credentials; `.gitignore`
  excludes `.env` and `.env.*` while allowing only an explicit secret-free
  example.

### 027A2 — topology and routing

- base `compose.yaml` contains only independently renderable Caddy/Web
  authority; `deploy/compose.runtime.yaml` adds the gated API/worker/PostgreSQL
  services, networks, secrets and PostgreSQL volume; production
  `deploy/caddy/Caddyfile` retains automatic public HTTPS/ACME, while exact
  `deploy/caddy/Caddyfile.qa` owns loopback internal TLS and is selected only by
  the read-only QA override; the Web static server completes the exact
  five-service/five-network contract from ADR 0035;
- Caddy alone publishes 80/443; no API, worker or PostgreSQL host port exists;
- exact `/api` and `/api/*` strip once and never fall back to Web;
- Web returns the SPA shell only for application routes and returns 404 for a
  missing asset-like path;
- API/worker/PostgreSQL remain behind `runtime-after-027b`; QA explicitly
  targets PostgreSQL and API for DB-free routing but never worker.

### 027A3 — real Docker evidence

- a controlled prefetch validates every official locked identity before any
  build while every registry-capable Docker child receives a fresh empty
  mode-0700 CLI configuration and no ambient auth/token/key authority;
- fresh application/Caddy targets build for Linux/amd64, then repeat from the
  prepared dependency cache with BuildKit `--network=none` and npm offline;
- the sole production Compose wrapper rejects non-immutable image references
  before Docker; QA local tags remain exact runner-owned constants with pull
  never;
- a unique temporary Compose project runs the exact
  `https://127.0.0.1:443` same-origin smoke, inspects
  live ports/networks/mounts/users, records every runner HTTP request and
  removes only its own resources and secret files. Temporary-directory cleanup
  starts immediately after creation, before secret writes or Compose setup;
  exact port-probe removal is attempted after both successful and ambiguous
  Docker reservation outcomes;
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
non-leaking error are those in ADR 0035. File open is also nonblocking, and the
bounded FIFO regression must complete 30 times. Direct values retain current
trim/nonempty compatibility and remain supported for existing non-Compose
operators, but production Compose mounts only secret files.

### Compose and Caddy

Service names, profiles, networks and published ports are exact, not examples.
Base and runtime-overlay Compose configuration must parse semantically through
`docker compose config --format json`; source regex alone is insufficient.
Production operators use only `npm run compose:production -- ...`, whose pure
validator enforces lowercase immutable image digests before Docker. Direct
Compose invocation is an implementation detail. Caddy configuration is
validated by the exact pinned Caddy image before smoke.

Production Caddy routing contains neither `tls internal` nor loopback
`default_sni`; Caddy automatic HTTPS/ACME remains authoritative for the VDS.
The exact QA-only `deploy/caddy/Caddyfile.qa` contains both directives and the
same private Web/API routing contract. Only `deploy/compose.qa.yaml` may mount
it read-only over the Caddy runtime configuration; neither base nor runtime
production composition may select it.

`public_edge` is not a general application network. `web_internal`,
`app_internal` and `db_internal` are Docker-internal. `worker_egress` has only
worker and no host binding. No service is privileged or receives host network,
the Docker socket or an unbounded log.

The QA `public_edge` remains non-internal so Docker Desktop can publish Caddy's
exact `127.0.0.1:443` binding. Caddy is its only member and only Caddy publishes
a port. One `PROOFLINE_PUBLIC_ORIGIN=https://127.0.0.1` configures Caddy
internal TLS and API browser authority; unavailable port 443 fails before
Compose without a skip or alternate origin. This topology does not prove DNS
or provider denial. No-external-effects acceptance additionally requires only
Web/API Caddy upstreams, no worker or live provider credentials, an HTTPS
ledger restricted to that default origin, allowed and hostile wallet-auth
preflight checks with no challenge/signature effect, explicit forbidden
Coinbase/Open-Meteo/verifier/Coston2 RPC hosts, and live port inspection.

### Web server

The Web server accepts only a validated internal port and a fixed client root.
GET/HEAD existing files preserve bytes; asset-like misses are 404; non-asset
GET/HEAD deep routes return `index.html`; other methods fail without SPA
fallback. It does not proxy `/api`, read credentials, list directories or make
outbound requests.

## Rejected candidates and second corrective RED

Production-author commit `20e8d998318168b2aaf9622b9fce453ff6d9fe42`, tree
`9b2d7a5e10225a5e22297e2832f0a143b1016eeb`, is rejected by both independent
verifiers. The frozen corrective contracts require credential-isolated prefetch,
one exact HTTPS origin, independent base/runtime Compose files, executable
immutable-image validation, bounded FIFO rejection and read-only Caddy. The
first replacement production-author implementation satisfied those files but
is also rejected: commit
`464e797ed630a8dfff87e867ff42daf5f0d19624`, tree
`80a63b91838ac9ba8270c3eda845e7313047ec9c`. Both independent verifiers found
that its production Caddyfile unconditionally used QA-only loopback internal
TLS, blocking public ACME certificates. Core additionally found pre-Compose
temporary secret and ambiguous port-probe cleanup gaps. Product confirmed no
additional finding before the candidate was rejected. The second corrective
contracts extend these files without weakening the accepted six boundaries:

- `apps/api/test/slice027a-deployment-secrets.contract.test.ts`;
- `apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts`;
- `tests/deployment/slice027a-image-boundary.contract.test.mjs`;
- `tests/deployment/slice027a-compose-caddy.contract.test.mjs`;
- `tests/deployment/slice027a-docker-gates.contract.test.mjs`.

Both prior candidates' local Docker runs remain historical rejected evidence.
The [Slice 027A GREEN](../evidence/slice-027a-green-credential-free-container-runtime.md)
preserves that rejection history and separately records the second corrective
production-author result. Its frozen contracts are GREEN, but this is still not
a module PASS before Core and Product independently verify one new frozen tree
hash.

## Acceptance

### Focused and nearest controls

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

The historical and second corrective RED failures remain in the RED evidence.
A new production-author candidate must pass the commands above without
weakening those frozen contracts before independent reviews begin.

### GREEN image and Docker gates

```bash
npm run test:docker:static
npm run docker:prefetch
npm run test:docker
```

`docker:prefetch` is separately observable and validates the locked official
manifests with a fresh no-auth Docker CLI configuration. This proves only
CLI-side isolation, not daemon-global state. `test:docker` performs the
no-network repeat and exact HTTPS QA smoke with `pull_policy: never`. Neither
command accepts registry credentials or contacts an upstream provider. The
final handoff also runs affected backend/worker coverage, root build and Sites
compatibility.

## Explicit exclusions

- no migration job, login-role provisioning, `/healthz`, `/readyz`, schema
  readiness, deployment worker heartbeat or retention (027B);
- no WAL/base backup, MinIO, Spaces or restore (027C);
- no OCI archive/release manifest (028A), registry publication (028B), full
  credential-free product journey (029A) or promotion (029B);
- no Redis, Kubernetes, Helm, Docker socket, host network, dummy live secret,
  production test adapter, DNS, SSH, DigitalOcean or hosted evidence.
