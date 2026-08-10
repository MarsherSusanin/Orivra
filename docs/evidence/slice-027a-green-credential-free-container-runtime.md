# Slice 027A GREEN — credential-free container runtime

Status: REJECTED production-author candidate; retained as historical evidence
only.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Production implementer

Final corrected RED commit: `558070f84b1eb4f151c247ca584fe0536f755e99`

Final corrected RED tree: `98442ffea24335242f837a7daa3cd2319fadd4d6`

Architecture decision: [ADR 0035](../adr/0035-credential-free-container-runtime-boundary.md)

Slice contract: [027A](../slices/027a-credential-free-container-runtime.md)

Rejected candidate commit: `20e8d998318168b2aaf9622b9fce453ff6d9fe42`

Rejected candidate tree: `9b2d7a5e10225a5e22297e2832f0a143b1016eeb`

## Independent verification rejection

Independent Core and Product verification returned formal FAIL on the exact
candidate above. The candidate inherited ambient Docker CLI authentication in
registry-capable prefetch children, configured QA Caddy and API with different
origins, required inactive runtime variables to render the default base,
accepted mutable production image references, could block on a FIFO secret path
and left Caddy's root filesystem writable outside its named state volumes.

All commands and observations below are historical production-author evidence
for that rejected tree. They do not establish an accepted local Docker,
credential-free, same-origin or release-path result. Corrective RED is recorded
in [Slice 027A RED](slice-027a-red-credential-free-container-runtime.md); a new
candidate must rerun every affected gate and both independent verifiers.

## Implementation

One API-owned deployment adapter now resolves exact `api`, `worker` and
`recording-importer` profiles before any Pool, listener, verifier or live-port
composition. Direct values retain the existing trim-compatible boundary.
Production Compose uses only the exclusive `NAME_FILE` form. File reads use
`O_NOFOLLOW`, require one regular file, read at most 4097 bytes to enforce the
4096-byte boundary, decode strict UTF-8, reject NUL/empty values and expose only
the fixed `DEPLOYMENT_SECRET_CONFIGURATION_INVALID` code/message on failure.

The checked-in base lock records exact Node 22.14.0, Caddy 2.10.2 and
PostgreSQL 17.6 index plus Linux/amd64 manifest digests. Fresh Docker stages
build Web, the ordinary API, the isolated build-only importer and worker. The
Web final image contains only client bytes and the dependency-free static
server. API contains migrations 001–009 and the three exact canonical Solidity
sources; worker retains external `pg` and `solc`. No host `dist`, `node_modules`,
Git data, environment file, test adapter or credential is copied.

Compose defines exactly Caddy, Web, API, worker and PostgreSQL. Only Caddy
publishes ports; Web/API/PostgreSQL remain on bounded internal networks and
worker alone receives the egress network. Application containers are non-root,
read-only and capability-reduced. Caddy strips same-origin `/api` exactly once
before the Web fallback. The QA override keeps `public_edge` non-internal for
Docker Desktop loopback publication, puts only Caddy on that edge and selects
the HTTP-only `:80` site without ACME.

## Semantic, coverage and PostgreSQL evidence

```sh
npm run typecheck
npx vitest run \
  apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts
npx vitest run \
  apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/slice024b-recording-importer.contract.test.ts \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/bootstrap-coverage.test.ts \
  apps/worker/test/slice005-bootstrap-lifecycle-coverage.test.ts \
  apps/worker/test/entry-coverage.test.ts \
  apps/worker/test/slice009-production-worker-purity.contract.test.ts
npm run test:coverage:backend
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

- Typecheck is PASS.
- The exact Slice 027A secret/worker contract is 2 files and 20/20 PASS.
- The affected API/importer/worker matrix is 9 files and 77/77 PASS.
- Deployment-secret coverage is 98.14% lines and 94.44% branches, above the
  API 90/85 gate.
- Backend coverage is 110 active files and 1069 tests PASS; overall coverage is
  92.30% lines and 87.33% branches. API is 91.10% lines and 86.36% branches;
  worker is 90.54% lines and 86.27% branches. The four PostgreSQL files and 37
  cases skipped by this coverage configuration are not integration evidence.
- Real Testcontainers PostgreSQL is 20 files and 151/151 PASS with zero skips.

The first final backend attempt exposed a pre-existing raw-socket close race in
one frozen absolute-body-deadline test. A tests-only correction waited for the
received response before treating the subsequent connection close as failure;
production transport code did not change. On corrected RED commit/tree above,
the full backend gate passed with the recorded counts.

## Static, build and Sites evidence

```sh
npm run test:docker:static
npm run build
npm run test:sites
```

The semantic image/Compose/Caddy/runner matrix is 29/29 PASS. The root Web build
and Sites compatibility are PASS; Sites is 36/36 and emits
`dist/client/index.html`, `dist/server/index.js` and
`dist/.openai/hosting.json`. Protected Sites source and `package-lock.json`
bytes are unchanged.

## Controlled Docker operations

The production author ran the following registry-authorized cache preparation;
later verification proved that its CLI credential isolation was insufficient:

```sh
npm run docker:prefetch
```

It inspected the exact three official tag/index identities, verified the locked
Linux/amd64 child digests, pulled those exact child digests and prepared the
npm dependency cache. An early Dockerfile revision also caused BuildKit to
resolve an unpinned `docker/dockerfile:1.7` frontend. That attempt was rejected,
the syntax frontend directive was removed, and no fourth base identity remains
in production. This diagnostic is not counted as the accepted three-image
prefetch boundary.

After the locked images and npm cache existed locally, the accepted command was:

```sh
npm run test:docker
```

Its two consecutive Linux/amd64 Web/API/worker/Caddy passes used
`--network=none`, npm offline and `--pull=false`; they performed no new pull or
registry request. The final unique project `proofline-027a-q38347-3ec872f7`
started exactly Caddy, Web, PostgreSQL and API. Worker was absent. Live inspect
confirmed Caddy as the sole exact `127.0.0.1` published binding, no other host
port, exact service users and network memberships, named volumes and no Docker
socket mount.

The local request ledger contained only the selected loopback origin. Root and
the accepted Web deep route returned the Web shell; anonymous
`/api/v1/templates` returned 200; its unexpected query returned 400; the
double-prefix and unknown protected API paths returned 401 from API rather than
falling back to Web; the missing asset returned 404. The ledger explicitly
rejects Coinbase, Open-Meteo, verifier and Coston2 RPC hosts. Caddy logs
confirmed the QA site listened on HTTP only without automatic HTTPS/ACME.

Every failed diagnostic and the accepted smoke used a unique validated project
name and completed exact `down --volumes --remove-orphans` plus temporary secret
directory removal. Final Docker queries found zero `proofline-027a-*`
containers, networks or volumes. The final corrected RED changed only one
frozen socket test and RED evidence; a hash comparison proved all 19
production/Docker/runner files byte-identical to the object used by the
accepted Docker run. Static 29/29 was repeated on the corrected base, so the
expensive Docker operation was not repeated and no new external network access
occurred.

## Security and deployment truth

A diff-scoped review covered the strict file reader, startup ordering, image
inputs, Compose/Caddy topology, static path containment, child-process argument
construction, QA ledger and cleanup. Targeted author scans found no committed
secret, private key, credential echo, shell interpolation, public
application/database port, host network, privileged container or Docker socket
mount. Independent verification later identified the release-path findings
recorded at the top of this document, so the author's earlier no-finding
conclusion is withdrawn.

This is local credential-free packaging evidence only. It is not migration,
schema readiness, `/healthz`, `/readyz`, deployment worker heartbeat, retention,
PITR, OCI archive, registry publication, VDS staging, hosted production or live
Coston2 evidence. No DNS, SSH, DigitalOcean, GHCR or Spaces credential was
requested or used. 027B–029B retain those authorities. This production author
cannot serve as either independent verifier.
