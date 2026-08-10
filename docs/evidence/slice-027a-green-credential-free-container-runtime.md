# Slice 027A corrective GREEN — credential-free container runtime

Status: rejected production-author evidence; both independent verifiers FAIL.

Date: 2026-08-10 (Asia/Vladivostok)

Role: production implementer; this author cannot be either verifier.

Corrective RED commit: `5707460a8dc04edfd288fad1650a6856e433751f`

Corrective RED tree: `7b39be7d614bfe3b1e1b9caf15e14e0a69c16f9e`

Rejected production candidate commit:
`464e797ed630a8dfff87e867ff42daf5f0d19624`

Rejected production candidate tree:
`80a63b91838ac9ba8270c3eda845e7313047ec9c`

No credentialed authority was requested by this evidence.

Architecture decision: [ADR 0035](../adr/0035-credential-free-container-runtime-boundary.md)

Slice contract: [027A](../slices/027a-credential-free-container-runtime.md)

## Corrective outcome

This section records historical production-author results, not accepted GREEN.
Core and Product independently returned FAIL on the exact candidate above.
Both found that the shared production `deploy/caddy/Caddyfile` unconditionally
set `default_sni 127.0.0.1` and `tls internal`, preventing a VDS hostname from
using Caddy automatic public ACME. Core additionally found that smoke secret
files were created before the only cleanup `try/finally`, and port-probe
cleanup was conditional on an unambiguous Docker start result. Product found
no additional blocker before the coordinator rejected the candidate. No
Docker/build/coverage gate from either verifier is claimed after that blocker.

The replacement resolves all six findings that rejected commit `20e8d998` / tree
`9b2d7a5`:

1. registry-capable prefetch children receive one fresh mode-0700 Docker CLI
   directory with exact `{"auths":{}}`, stripped ambient config/auth/token/key
   variables, explicit daemon selection and success/failure cleanup. The
   system-installed Buildx executable is linked into that isolated directory;
   no ambient Docker configuration is read by a registry child. This proves
   CLI-side isolation only, not daemon-global state;
2. QA derives Caddy and API authority from the single exact origin
   `https://127.0.0.1`, publishes only `127.0.0.1:443`, uses Caddy internal TLS
   with exact IP default SNI, and proves exact-origin plus hostile preflights;
3. base `compose.yaml` renders and starts with Caddy/Web inputs only, while
   `deploy/compose.runtime.yaml` owns API/worker/PostgreSQL, their profiles,
   private networks, secrets and PostgreSQL state;
4. `scripts/compose-production.mjs` rejects mutable, uppercase, short,
   suffixed and arbitrary production image inputs before Docker. Base mode
   validates Caddy/Web; runtime mode also validates API/worker. QA tags exist
   only in the exact runner and always use pull-never;
5. secret paths are opened with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` before
   `fstat`; a real FIFO receives the fixed redacted error 30 consecutive times
   without blocking;
6. Caddy is non-root and read-only with bounded `/tmp`; only named `/data` and
   `/config` volumes remain writable.

The Caddy/Web base and the runtime overlay semantically compose to exactly five
services and five networks. QA explicitly starts only Caddy, Web, PostgreSQL
and API. Worker authority remains blocked until 027B.

## Frozen contracts and affected regressions

```sh
npm run typecheck
npx vitest run \
  apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts \
  --reporter=dot --maxWorkers=1
npm run test:docker:static
npx vitest run \
  apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/slice024b-recording-importer.contract.test.ts \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/bootstrap-coverage.test.ts \
  apps/worker/test/slice005-bootstrap-lifecycle-coverage.test.ts \
  apps/worker/test/entry-coverage.test.ts \
  apps/worker/test/slice009-production-worker-purity.contract.test.ts \
  --reporter=dot --maxWorkers=1
```

- typecheck: PASS;
- exact secret/worker contract: 2 files, 22/22 PASS;
- deployment image/Compose/Caddy/runner contract: 37/37 PASS;
- affected API/importer/worker matrix: 9 files, 79/79 PASS;
- zero skipped or pending cases in these focused gates.

The deployment-secret focused coverage is 98.14% lines and 94.44% branches,
above the API 90/85 gate.

## Backend and PostgreSQL evidence

```sh
npm run test:coverage:backend
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

Backend coverage ran outside the filesystem sandbox because its accepted raw
socket tests require local loopback bind. It passed 110 files and 1071 tests;
the 37 cases skipped by this unit-coverage configuration remain explicitly not
PostgreSQL evidence. Overall coverage is 92.30% lines / 87.33% branches; API is
91.10% / 86.36%, and worker is 90.54% / 86.27%.

Real Testcontainers PostgreSQL passed 20 files and 151/151 tests with zero
skips. This is integration evidence only; it is not a 027B migration, schema or
application-readiness claim.

## Static, build and Sites compatibility evidence

```sh
npm run build
npm run test:sites
```

Build passed and emitted `dist/client/index.html`, `dist/server/index.js` and
`dist/.openai/hosting.json`. Sites compatibility passed 36/36 with zero skips.
Protected Sites sources and `package-lock.json` remain byte-identical to the
frozen contract.

## Controlled prefetch and offline Docker evidence

```sh
npm run docker:prefetch
npm run test:docker
```

The accepted prefetch verified the exact three locked official tag/index and
Linux/amd64 child identities, pulled only those child digests and prepared the
lockfile dependency cache. Every registry-capable child used the isolated CLI
configuration exercised by the fake-runner success and failure tests. A first
diagnostic stopped before registry inspection because the isolated HOME hid
Docker Desktop's user-scoped Buildx plugin; the final implementation links only
the trusted system-installed plugin executable into the fresh CLI directory.
All temporary CLI directories were removed.

The final `test:docker` performed two consecutive Linux/amd64 Web, API, worker
and Caddy builds with BuildKit `--network=none`, npm offline and `--pull=false`.
It then used unique project `proofline-027a-q80526-d01f4703` for the exact local
HTTPS smoke. No registry access or pull occurred in this gate.

Ordinary macOS Node cannot reserve privileged host port 443 directly. The
runner still attempts exact `listen(443, "127.0.0.1")`; on that single EACCES
case it asks the same Docker daemon that will publish Compose to reserve exact
`127.0.0.1:443`, using the already-built Caddy image, `--pull never` and an
exact disposable name. An occupied or Docker-denied binding fails; the
reservation is always removed before Compose. Other bind errors never fall
back. Caddy's exact IP `default_sni` lets an ordinary HTTPS client use the IP
origin without a deprecated IP-SNI override.

Live inspection proved:

- exactly Caddy, Web, PostgreSQL and API ran; worker was absent;
- Caddy alone published `127.0.0.1:443`; no Web/API/PostgreSQL host port
  existed;
- exact non-root users, private memberships, named state volumes and no Docker
  socket mount;
- root and the accepted deep route returned the Web shell;
- anonymous `/api/v1/templates` returned 200 and the query variant 400;
- double-prefix and unknown protected API routes returned API 401 rather than
  SPA fallback; the missing asset returned 404;
- exact-origin `OPTIONS /api/v1/auth/wallet/challenges` returned 204 with ACAO
  and `Vary: Origin`; hostile origin returned 403 with no ACAO;
- the HTTPS ledger contained only default-port `https://127.0.0.1` and rejected
  Coinbase, Open-Meteo, verifier and Coston2 RPC hosts.

The final `down --volumes --remove-orphans` removed four containers, four
networks, three volumes and the temporary secret directory. Project-label
queries found zero remaining containers, networks or volumes. Failed
diagnostic iterations used separate project identities and received the same
scoped cleanup; one empty preflight directory created before the first port
failure was explicitly removed and the runner ordering was corrected.

## Deployment truth

This is rejected historical credential-free local packaging and same-origin
routing evidence from the production author. It is not an independent module
PASS and not a unified
MLP candidate freeze. It does not prove migration, schema readiness,
`/healthz`, `/readyz`, deployment worker heartbeat, retention, PITR, OCI
archives, registry publication, VDS staging, hosting, production deployment or
live Coston2. No DNS, SSH, DigitalOcean, GHCR, Spaces, verifier or relayer
credential was requested or used. Slices 027B–029B retain those authorities.
