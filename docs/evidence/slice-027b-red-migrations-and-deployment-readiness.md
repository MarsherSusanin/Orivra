# Slice 027B RED — checksummed migrations and deployment readiness

Status: intentional RED frozen; implementation pending.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Architect and Contract/Test Designer; this author cannot implement the
production change or verify its eventual candidate.

Accepted parent commit: `820f61dd984cd92e17d5d23d495a45911ea2a286`

Accepted parent tree: `ea13cf179ef6dc4843775d4e56e5df85cde3a7bf`

Architecture decision: [ADR 0036](../adr/0036-checksummed-migrations-and-deployment-readiness.md)

Slice contract: [027B](../slices/027b-migrations-and-deployment-readiness.md)

## Accepted prerequisite

Slice 027A was independently verified on the exact parent identity above. Core
and Product both returned formal PASS with no P0/P1/P2, including the bounded
offline/no-pull image repeat and exact HTTPS Compose smoke. Cleanup left no
project containers, networks, volumes, port probes or temporary secret
directories. That is credential-free local container evidence only; it is not
worker readiness, hosted evidence, deployment evidence or live Coston2
evidence.

## Frozen surface

This wave changes tests and documentation only. It adds strict public
deployment health/readiness contracts; manifest, runner, role-bootstrap and
migration-010 tests; API readiness and worker-heartbeat tests; real-PostgreSQL
lifecycle cases; and rendered/runtime-Compose acceptance. Accepted 027A tests
are reconciled only where ADR 0036 deliberately supersedes the prior profile,
five-service inventory and absence-of-health assertions.

Production source, SQL migrations, manifest, package exports, dependencies,
lockfile, Docker/Compose/Caddy files, scripts and protected Sites sources are
unchanged. No Docker start/build/pull, registry request, provider request or
external network operation ran during RED.

## Intentional RED evidence

TypeScript structure remains valid:

```sh
npm run typecheck
```

Result: PASS.

The exact focused Vitest matrix is:

```sh
npx vitest run \
  apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  packages/contracts/test/slice027b-deployment-readiness.contract.test.ts \
  apps/api/test/slice027b-migration-manifest.contract.test.ts \
  apps/api/test/slice027b-db-role-bootstrap.contract.test.ts \
  apps/api/test/slice027b-migration-runner.contract.test.ts \
  apps/api/test/slice027b-health-readiness.contract.test.ts \
  apps/worker/test/slice027b-deployment-heartbeat.contract.test.ts \
  apps/api/test/postgres/slice027b-deployment-lifecycle.contract.test.ts \
  --maxWorkers=1 --reporter=dot
```

Result: 8 files, 105 cases: 79 intentional RED, 22 accepted controls PASS and
4 real-PostgreSQL cases SKIP because `PROOFLINE_TESTCONTAINERS=1` was not set.
Those skips are explicitly not PostgreSQL acceptance evidence.

The source/rendered-Compose matrix is:

```sh
node --test \
  tests/deployment/slice027a-compose-caddy.contract.test.mjs \
  tests/deployment/slice027b-runtime-lifecycle.contract.test.mjs
```

Result: 27 cases: 18 intentional RED and 9 accepted controls PASS, with zero
skip. Failures are the deliberately absent seven-service unprofiled runtime,
one-shot jobs/order, mounted URL secrets, health probe, packaged job entries,
forced one-shot recreation and credential-free runtime lifecycle script.

The nearest unchanged API/migration/worker baseline is GREEN:

```sh
npx vitest run \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/postgres/migration-static.test.ts \
  apps/api/test/production-service-coverage.test.ts \
  apps/worker/test/bootstrap-coverage.test.ts \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/slice005-bootstrap-lifecycle-coverage.test.ts \
  apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts \
  --maxWorkers=1 --reporter=dot
```

Result: 7 files, 54/54 PASS, zero skip.

Sites compatibility remains GREEN without rebuilding or changing protected
artifacts:

```sh
npm run test:sites
```

Result: 36/36 PASS, zero skip.

## Harness correction

The first expanded run exposed one test-only negative-control loop: accepted
pre-027B worker code continued claiming after the deferred command completed,
so fake timers could spin indefinitely after the intentionally rejected
heartbeat. The harness now bounds that negative control at a second claim;
the frozen assertion still requires corrected production to stop after exactly
one claim and reject with `DEPLOYMENT_HEARTBEAT_FAILED`. The heartbeat file then
completed deterministically as 11 intentional RED and 1 control PASS. A missing
one-shot service is likewise asserted explicitly instead of dereferencing an
undefined rendered service. Neither correction weakens production behavior.

## GREEN authority still required

Implementation must make the frozen contracts GREEN without adopting legacy
version-only history, weakening readiness, starting a credential-free live
worker or adding a heartbeat sidecar/test adapter. Required acceptance includes
contracts 100%, affected backend 90% lines/85% branches, real Testcontainers
PostgreSQL with zero skips, bounded offline/no-pull Docker lifecycle, build and
Sites compatibility, followed by two independent PASS reports for one stopped
commit/tree.

027C PITR/MinIO, 028 release publication and 029 deployment/product gates are
outside this evidence.
