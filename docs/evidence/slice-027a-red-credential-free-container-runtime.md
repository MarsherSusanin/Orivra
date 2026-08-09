# Slice 027A RED — credential-free container runtime

Status: Intentional RED contract; production container surfaces absent.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Architect and Contract/Test Designer

Accepted parent commit: `48001e76070746960260437a2a03d3c48d054d1c`

Accepted parent tree: `dc85b763cd96c4ba0bf8b7a68ad0fd41e399c23a`

Architecture decision: [ADR 0035](../adr/0035-credential-free-container-runtime-boundary.md)

Slice contract: [027A](../slices/027a-credential-free-container-runtime.md)

## Accepted prerequisite

Slice 026 was independently verified on the exact accepted parent commit/tree
above. Core and Product both returned formal PASS with no P0/P1. Core ran
typecheck, 32 focused and 164 nearest tests, affected backend/Web coverage,
build and Sites. Product independently exercised the stopped build in real
Chromium at desktop and mobile sizes, including keyboard, axe, console/network,
reload and history behavior. Both ended at the same clean identity. These were
local credential-free results, not Docker, hosted, deployed or live Coston2
evidence.

The exact official Node, Caddy and PostgreSQL tag/index/Linux-amd64 identities
in ADR 0035 were supplied as decision-complete registry-manifest inspection
input before this wave. The RED writer performed no registry request, image
pull or image build and does not claim independent registry verification.

## Frozen files

This RED wave changes tests and documentation only:

- `apps/api/test/slice027a-deployment-secrets.contract.test.ts`;
- `apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts`;
- `tests/deployment/slice027a-image-boundary.contract.test.mjs`;
- `tests/deployment/slice027a-compose-caddy.contract.test.mjs`;
- `tests/deployment/slice027a-docker-gates.contract.test.mjs`;
- ADR 0035/index, Slice 027A, roadmap and canonical README/architecture/
  runbook/role documentation.

No production source, dependency, lockfile, migration, Dockerfile, Compose
file, Caddyfile, script or protected Sites source is added or changed. The
static gate records exact SHA-256 controls for the protected Sites files and
`package-lock.json`.

## First-run evidence

Typecheck remains structurally GREEN:

```sh
npm run typecheck
```

Result: PASS.

The strict secret-file and bootstrap contracts are intentional RED:

```sh
npx vitest run \
  apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  apps/worker/test/slice027a-worker-deployment-boundary.contract.test.ts \
  --reporter=dot
```

Result: 2 files, 20 tests; 18 intentional RED and 2 control PASS.

- the API-owned deployment adapter is absent, so direct/file profile,
  XOR/allowlist, bounded file, non-leaking error and pre-composition cases RED;
- worker production-source controls for no dummy authority and no invented
  HTTP readiness PASS, while shared secret resolution before Pool/verifier RED.

The deployment artifact and gate contracts are intentional RED:

```sh
node --test --test-reporter=dot tests/deployment/*.contract.test.mjs
```

Result: 28 tests; 24 intentional RED and 4 control PASS.

Failures are the deliberately absent base lock, multi-target Dockerfile,
Caddy/Web runtime, semantic Compose model and Docker gate scripts. Controls
for hidden orchestration absence, protected bytes and explicit 027B/027C
exclusions PASS. There are zero skipped/pending tests. No Docker build, pull,
Compose start or external network operation ran.

The nearest API/worker baseline is GREEN:

```sh
npx vitest run \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/worker/test/bootstrap-coverage.test.ts \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/slice009-production-worker-purity.contract.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: 4 files, 34/34 PASS.

The accepted deployment-roadmap contract is independently GREEN:

```sh
node --test --test-reporter=dot \
  tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs
```

Result: 15/15 PASS.

Root build and Sites compatibility are GREEN:

```sh
npm run build
npm run test:sites
```

Result: build PASS with `dist/client/index.html`, `dist/server/index.js` and
`dist/.openai/hosting.json`; Sites 36/36 PASS with zero skips.

## RED interpretation

Only absent 027A production surfaces are accepted failures. A TypeScript
error, fixture failure, missing Docker executable, unbounded command, image
pull/build, registry request or skipped test is not semantic RED evidence.
GREEN must satisfy the exact tests, then execute the controlled prefetch,
offline-repeat build and bounded QA smoke described by ADR 0035. It must not
promote PostgreSQL engine liveness or routing success into application
readiness; 027B and 027C remain separate authority boundaries.
