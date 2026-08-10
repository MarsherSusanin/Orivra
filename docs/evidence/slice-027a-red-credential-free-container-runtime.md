# Slice 027A RED — credential-free container runtime

Status: Corrective intentional RED; first production-author candidate rejected.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Architect and Contract/Test Designer

Accepted parent commit: `48001e76070746960260437a2a03d3c48d054d1c`

Accepted parent tree: `dc85b763cd96c4ba0bf8b7a68ad0fd41e399c23a`

Architecture decision: [ADR 0035](../adr/0035-credential-free-container-runtime-boundary.md)

Slice contract: [027A](../slices/027a-credential-free-container-runtime.md)

Rejected candidate commit: `20e8d998318168b2aaf9622b9fce453ff6d9fe42`

Rejected candidate tree: `9b2d7a5e10225a5e22297e2832f0a143b1016eeb`

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

Result: 29 tests; 25 intentional RED and 4 control PASS.

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

### Legacy worker compatibility correction

After the initial RED freeze and the Unicode-safe file-URL harness correction
at `8bd77ee15b6c8494c692b54e8593f00ae0b808a1`, the accepted Slice 005 worker
lifecycle expectations were reconciled with ADR 0035. Missing database,
verifier or private-key deployment authority now requires the same fixed
redacted configuration error and zero Pool, verifier, live-port or loop effect.
The private-key case uses a locally restored test signal listener to stop the
loop if the absent 027A implementation improperly reaches signal registration;
GREEN must reject before that point. This avoids a timeout without queuing a
mock implementation into the following case. The existing direct-environment
start, signal, loop and pool-close happy path remains a separate control.

```sh
npx vitest run \
  apps/worker/test/slice005-bootstrap-lifecycle-coverage.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: 14 tests; 3 intentional RED and 11 compatibility controls PASS. The
three failures are only the missing redacted/pre-effect deployment-secret
boundary; there is no timeout or lifecycle fixture failure.

### Compose profile harness correction

The full five-service semantic renderer explicitly passes `--profile
runtime-after-027b`; otherwise Compose correctly omits the three gated services
and a future GREEN inventory assertion would inspect an incomplete model. A
separate sanitized `config --services` invocation passes no profile and proves
that only Caddy and Web are active by default. The harness removes any inherited
`COMPOSE_PROFILES`, so an operator environment cannot create a false PASS. The
QA metadata renderer uses the explicit profile, while the real smoke remains
contractually limited to explicitly targeted Caddy, Web, PostgreSQL and API and
never starts worker.

### Superseded Docker Desktop edge correction

The earlier RED topology incorrectly required the QA `public_edge` network to
be internal. That prevents the required random loopback host publish on Docker
Desktop. The corrected contract keeps the edge non-internal, with Caddy as its
sole member and sole published service, and derives bounded no-external-effects
evidence from the HTTP-only `:80` site, exact Web/API upstreams, absence of live
worker credentials, a loopback-only runner request ledger with explicit
provider-host denials, and live port inspection. It makes no DNS/provider claim
from network topology alone; production `public_edge` egress remains intact.
The later independent-verifier corrective RED below supersedes this random
HTTP-port authority with exact `https://127.0.0.1:443`; this paragraph remains
only as chronology for the earlier RED iteration.

All invalid iterations through this correction were tests/documentation-only.
No Docker build, pull, Compose start, container, network, volume or secret file
was created in the RED wave, so there was no runtime resource to abandon. The
future real smoke remains required to record its unique project identity and
complete `down --volumes --remove-orphans` plus post-cleanup absence after every
failed or successful attempt.

### Slice 023D2 raw-socket harness correction

During the 027A production wave, the frozen absolute-auth-body-deadline test
intermittently reported client-side `ECONNRESET`. The active production diff
only added secret resolution after `startProductionApi`; the guarded body
reader and direct rejection/close implementation were byte-identical to the
accepted Slice 023D2 implementation. An approved isolated run passed, while a
ten-run serial diagnosis produced nine PASS and one `ECONNRESET`. Slice 026
evidence had already recorded the same timing-sensitive case. This rules out a
027A production regression and identifies a raw client race: the harness kept
writing chunks after the server had begun its complete 408 response, while its
socket error handler rejected even a post-response reset.

The tests-only correction stops the trickle and half-closes the client write
side on the first response bytes. Socket errors remain failures by default;
the deadline case opts in to completion only when the socket is closed, the
full declared `Content-Length` body is captured and the exact
`REQUEST_BODY_TIMEOUT` predicate is already true. The unchanged exact status,
private envelope, CORS/cache/referrer headers, connection-close and zero-fetch
assertions then run normally. Errors or resets before that full predicate still
fail.

```sh
# same isolated command executed in 30 separate serial processes
npx vitest run \
  apps/api/test/slice023d2-node-auth-stream-boundary.contract.test.ts \
  -t "uses one absolute body deadline instead of resetting it for each chunk" \
  --reporter=dot --maxWorkers=1
npx vitest run \
  apps/api/test/slice023d2-node-auth-stream-boundary.contract.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: isolated deadline `30/30 PASS`; full Slice 023D2 `31/31 PASS`. No
production source changed for this correction.

## Corrective RED after independent verifier FAIL

Core and Product independently inspected the same stopped production-author
candidate `20e8d998318168b2aaf9622b9fce453ff6d9fe42`, tree
`9b2d7a5e10225a5e22297e2832f0a143b1016eeb`, and returned formal FAIL. The
candidate and its earlier GREEN evidence are rejected. The corrective RED
freezes all confirmed release-boundary findings without changing production,
dependencies, migrations, Docker files or protected Sites sources:

1. `scripts/docker-prefetch-orchestration.mjs` must be import-pure and expose
   injectable `runDockerPrefetch`. Fake-Docker tests seed ambient auth/helper,
   Docker config, registry auth, home config and token/key sentinels. Every
   registry-capable child must instead observe one fresh mode-0700 Docker CLI
   directory with exact no-auth config, explicit daemon selection and no
   sentinels; success and failure both remove it. The resulting claim is only
   CLI-side isolation, never daemon-global credential absence.
2. QA uses one exact `PROOFLINE_PUBLIC_ORIGIN=https://127.0.0.1` for Caddy
   internal TLS and API browser authority. It binds only `127.0.0.1:443`, fails
   before Compose if unavailable, and makes default-port HTTPS requests. Exact
   allowed wallet-auth OPTIONS must return 204 with ACAO/Vary; hostile Origin
   is denied without ACAO. No challenge, signature, wallet or live effect is
   created.
3. Base `compose.yaml` contains only independently renderable Caddy/Web plus
   edge/Web networks and Caddy volumes. `deploy/compose.runtime.yaml` owns all
   API/worker/PostgreSQL services, profiles, networks, secrets and PostgreSQL
   state. QA combines all three exact files and still never starts worker.
4. Import-pure `scripts/compose-production.mjs` is the sole production Compose
   entry. It rejects tag, uppercase, short, suffixed and arbitrary image refs
   before Docker and accepts only lowercase repository paths with an exact
   lowercase SHA-256 digest. Base validates Caddy/Web; runtime also validates
   API/worker. QA local tags remain inaccessible from production mode.
5. Deployment secret files use `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` before
   `fstat`. A real FIFO fixture must reject with the fixed redacted error within
   the bound 30 consecutive times instead of hanging.
6. Caddy is non-root and read-only with bounded `/tmp`; only named `/data` and
   `/config` are writable. Existing capabilities, ports, routes, worker absence,
   offline double-build and scoped cleanup remain unchanged.

The first bounded corrective runs are semantic RED, not harness failures:

```sh
npm run typecheck
npx vitest run apps/api/test/slice027a-deployment-secrets.contract.test.ts \
  --reporter=dot --maxWorkers=1
node --test tests/deployment/slice027a-docker-gates.contract.test.mjs
node --test tests/deployment/slice027a-compose-caddy.contract.test.mjs
```

- typecheck: PASS;
- exact secret/worker matrix: 2 files and 22 cases, 2 intentional RED and 20
  controls PASS; the 19-case secret file contributes both RED cases, and the
  runtime FIFO case times out at the frozen 100 ms, is safely released and
  leaves no blocked operation;
- Docker-gate source/fake-runner contract: 10 cases, 5 intentional RED and 5
  controls PASS;
- Compose/Caddy contract: 17 cases, 16 intentional RED and 1 control PASS.

The combined deployment static suite is 37 cases: 21 intentional RED and 16
controls PASS, including all 10 unchanged image-boundary controls. The nearest
API/worker baseline is 4 files and 34/34 PASS; the legacy worker lifecycle is
14/14 PASS; the deployment-roadmap contract is 15/15 PASS; Sites compatibility
is 36/36 PASS. There are zero skipped cases. Root build is deliberately not
rerun because this corrective wave changes tests/documentation only.

No Docker build, pull, service start or external network operation ran. The
only Docker CLI use was semantic `docker compose config`, which starts no
daemon resource. There was no container, network, volume, image or temporary
secret cleanup to perform.

## Second corrective RED after replacement verifier FAIL

Core and Product independently inspected replacement commit
`464e797ed630a8dfff87e867ff42daf5f0d19624`, tree
`80a63b91838ac9ba8270c3eda845e7313047ec9c`, and both returned formal FAIL.
Both confirmed the blocking production-TLS defect: the shared production
Caddyfile unconditionally set loopback `default_sni` and `tls internal`, so a
VDS hostname could not use Caddy automatic public ACME. Core also confirmed
that temporary secret files were created before the only cleanup `try/finally`
and that an ambiguous Docker reservation failure could bypass port-probe
removal. Product reported no additional blocker before the coordinator stopped
all Docker/build/coverage work. The replacement and its GREEN evidence are
rejected.

The second corrective tests freeze two narrow changes without touching
production, dependencies, Docker/Compose inputs or protected Sites files:

1. Production `deploy/caddy/Caddyfile` contains neither `tls internal` nor
   loopback `default_sni`, preserving automatic HTTPS/ACME. Exact
   `deploy/caddy/Caddyfile.qa` owns both loopback directives and the same
   private routing boundary. Only `deploy/compose.qa.yaml` selects it through
   one read-only bind override; production base/runtime rendering does not.
2. Import-pure smoke orchestration exposes executable lifecycle seams. Its
   outer temporary-directory cleanup begins immediately after creation and
   runs after setup/write, pre-Compose, smoke and success outcomes. The
   EACCES-only exact-port reservation attempts scoped removal after both a
   successful start and an ambiguous Docker CLI failure; EADDRINUSE never uses
   the Docker fallback. The main smoke must consume those tested seams.

The first focused execution is intentional semantic RED:

```sh
node --test --test-reporter=spec \
  tests/deployment/slice027a-docker-gates.contract.test.mjs \
  tests/deployment/slice027a-compose-caddy.contract.test.mjs
```

Result: 30 cases, 6 intentional RED and 24 controls PASS, zero skipped. The two
Caddy failures are exactly the still-shared production internal-TLS file and
missing QA-only read-only override. The four smoke failures are the absent
import-pure lifecycle usage plus three executable success/failure cleanup
cases. No Docker build, pull, service start or external network operation ran;
the only Docker CLI use was semantic `docker compose config`.

The complete bounded RED handoff is:

- typecheck: PASS;
- deployment static suite: 40 cases, the same 6 intentional RED and 34
  controls PASS, zero skipped; all 10 unchanged image-boundary controls PASS;
- nearest API/worker baseline: 4 files and 34/34 PASS;
- deployment-roadmap contract: 15/15 PASS;
- Sites compatibility: 36/36 PASS.

No Docker build, pull, service start, registry access or external network ran.
No production, dependency, lockfile, Docker/Compose or protected Sites source
was changed by this second corrective freeze.

## RED interpretation

Only absent 027A production surfaces are accepted failures. A TypeScript
error, fixture failure, missing Docker executable, unbounded command, image
pull/build, registry request or skipped test is not semantic RED evidence.
GREEN must satisfy the exact tests, then execute the controlled prefetch,
offline-repeat build and bounded QA smoke described by ADR 0035. It must not
promote PostgreSQL engine liveness or routing success into application
readiness; 027B and 027C remain separate authority boundaries.
