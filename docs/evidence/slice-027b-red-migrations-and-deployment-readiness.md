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

### 027B2 compatibility correction

After the 027B1 implementation checkpoint at commit
`c25197c6ae09642707e1c4c74572247c6c468734` / tree
`2fb7006cd30e75d07123145abb3e051c68c9496d`, the historical 027A worker test
still prohibited any deployment-heartbeat reference in the production worker
bootstrap. That absence was deliberate in 027A but contradicts ADR 0036.
The corrected compatibility contract continues to forbid worker HTTP health,
dummy credentials, sidecars, test adapters and API-owned heartbeat writes. It
now requires the real worker heartbeat only after strict deployment-secret,
live-verifier and exact-schema validation and before worker command claims.
This is an intentional 027B2 RED, not a weakening of 027A secret custody or
artifact purity.

The correction is structurally GREEN under `npm run typecheck`. Its focused
worker boundary is 2 files / 15 cases: 12 intentional 027B2 RED and 3 accepted
controls PASS. The nearest worker bootstrap/lifecycle baseline remains 3 files,
21/21 PASS with zero skip.

### Identity-key harness correction

The frozen startup-identity test originally scanned serialized JSON with the
substring expression `runId|command|claim|lease`; that falsely classified the
required key `releaseTreeSha` as lease authority. The corrected harness asserts
the exact enumerable/JSON-visible keys `deploymentId`, `releaseTreeSha` and
`workerInstanceId`, then recursively rejects only explicit run, command, claim
and lease field names. Identity custody is unchanged and the rejection is no
longer coupled to an innocent substring.

### Slice 005 lifecycle compatibility correction

The accepted Slice 005 successful worker-bootstrap fixture predated mandatory
deployment identity, schema verification and the persisted heartbeat. It now
supplies one exact `deployment_<64 lowercase hex>` identity and 40-hex release
tree, and its Pool double exposes explicit query/connect/client-release
lifecycle for schema and heartbeat SQL. The successful path must observe exact
checksum-ledger and heartbeat insert/stopped activity before Pool close, while
the existing missing-secret cases still require zero Pool, verifier, schema,
heartbeat, claim or cleanup effect. No test-only production bypass or queued
mock is introduced.

The same compatibility audit found the accepted Slice 009 purity test still
listed the pre-027B contracts exports exactly. It now admits only the new exact
`./deployment` feature, proves both deployment schemas retain root/feature
runtime identity through a cycle-free leaf, and requires the deployment leaf
and schema implementation to contribute zero bytes to a fresh worker bundle.
All prior `sideEffects: false`, wallet/manifest/template identities and custody
forbidden rules remain unchanged.

Typecheck remains PASS. The Slice 005 plus old/new heartbeat focus is 3 files /
29 cases: 13 intentional 027B2 RED and 16 controls PASS. The nearest bootstrap,
entry and fresh worker-purity matrix is 4 files, 23/23 PASS with zero skip.

### 027B3 Compose compatibility correction

After the 027B2 implementation checkpoint at commit
`9dbc9e1d3e016f3b86118b2c7f58e3dfbd043c35` / tree
`14a46be19de3e7297948f124685917c515dd55b0`, the retained 027A full-runtime
assertion still expected Caddy to depend only on Web. The base Compose model
continues to render independently with exact Caddy → Web `service_started`
authority. The combined base/runtime model now requires both Web
`service_started` and API `service_healthy`, with `required: true`, and
explicitly forbids a Caddy → worker dependency. Seven-service/profile removal,
private networks, no worker/job ports or Docker socket and all 027A hardening
assertions remain intact.

Typecheck remains PASS. The retained 027A plus frozen 027B runtime Compose
focus is 2 files / 27 cases: 17 intentional 027B3 RED and 10 controls PASS.
The nearest image and Docker-gate controls are 2 files / 23 cases, all PASS;
Sites compatibility is 36/36 PASS. All runs used the clean B2 production
checkpoint and did not build, pull, start or contact Docker or the network.

The follow-up renderer correction supplies exact valid non-secret
`PROOFLINE_DEPLOYMENT_ID` and `PROOFLINE_RELEASE_TREE_SHA` values to the retained
027A combined-runtime environment. It keeps the new production interpolation
fail closed with no default while allowing the compatibility test to reach the
frozen topology assertions. The separate 027B runtime renderer already supplied
the same bounded identities and needed no correction.

After that correction, typecheck remains PASS; the two-file Compose focus
remains exactly 17 intentional RED and 10 controls PASS, the nearest deployment
controls remain 23/23 PASS and Sites remains 36/36 PASS. No Docker process,
build, pull or network operation was used.

### Real-PostgreSQL inventory compatibility correction

The retained Slice 023D1 quota migration fixture and the generic empty/previous
schema Testcontainers fixture now require the immutable ordered migration
inventory to continue through exact `010_deployment_lifecycle.sql`. The generic
history assertions likewise require versions 1–10 on an empty schema and 0–10
after upgrading the historical fixture. This preserves every 001–009 ordering,
quota, idempotency and historical-upgrade assertion while removing the stale
nine-migration ceiling.

Typecheck is PASS. The credential-free focused source run was 3 PASS with 7
Testcontainers cases gated, so it is not PostgreSQL evidence. The first enabled
affected real-PostgreSQL run used the already-cached `postgres:16-alpine` image:
the generic migration test passed, while one quota assertion crossed the exact
minute boundary at `04:05:00.012Z` and produced 9 PASS / 1 FAIL. An immediate
unchanged serial rerun outside that boundary passed 10/10 with zero skip. The
nearest immutable-manifest suite is 17/17 PASS; an additional lifecycle source
run produced 23 controls PASS and 4 gated integration skips, which are not
claimed as integration evidence. No image was pulled, no Compose/runtime Docker
gate ran, and post-run label inspection found no Testcontainers resource.

### Worker runtime-artifact compatibility correction

The retained clean-built worker artifact test now expects the accepted bounded
failure code `DEPLOYMENT_SECRET_CONFIGURATION_INVALID` and message `Deployment
secret configuration is invalid` when production starts without deployment
configuration. It still requires a non-zero exit and now explicitly rejects
deployment secret names, secret mount paths, raw database/key/verifier values,
connection failures and live-worker markers in process output. The Slice 005
unit boundary remains the authority proving Pool, verifier and live ports are
never constructed before all deployment secrets resolve.

Typecheck is PASS. The clean-built worker plus unchanged Action artifact focus
is 2/2 PASS, and the nearest Slice 005 deployment-secret, retained 027A worker
boundary and worker entry controls are 18/18 PASS. The repository-wide scan
found no second retained assertion for the obsolete live-worker database error.
No Compose or Docker gate ran.

## Corrective RED — heartbeat must follow full worker composition

Both independent read-only verifiers rejected production-author candidate
`4ac66f9693d1b8ae16a01d839923cdcdfad044eb` / tree
`477f67988e63645da32c4a98fc307302a872d19b` with the same P1. The worker passed
its secret and schema gates, inserted a current heartbeat, and only then called
`createProductionWorker`. Missing or invalid relayer/live-pipeline configuration
could therefore abort before any claim loop existed while `/readyz` treated the
un-stopped row as ready for up to 30 seconds. Core stopped coverage,
real-PostgreSQL, Docker and build gates after independently confirming the
ordering; Product likewise made no acceptance claim for the candidate.

The corrective contract freezes exact startup order: secrets/basic config →
Pool and exact schema → complete production-worker/repository/relayer/live-port
composition → shutdown coordination → heartbeat start → claim loop. The two
historical source-order assertions no longer require heartbeat creation before
`createProductionWorker`. An executable lifecycle regression reaches a valid
Pool and schema, then rejects invalid relayer configuration while requiring no
heartbeat INSERT, no repository/live-port/claim effect, redacted failure values
and an exactly closed Pool. Heartbeat stop remains legal only after start
succeeded. No sidecar, dummy credential or test adapter is introduced.

Typecheck is PASS. The corrective worker focus is 3 files / 30 cases: exactly
3 intentional RED and 27 controls PASS. The failures are the forbidden
heartbeat INSERT after successful schema but failed relayer validation, plus
the two retained source-order assertions observing heartbeat start before
lifecycle coordination. Nearest worker bootstrap/entry/purity controls are
23/23 PASS, rendered 027A/027B deployment controls are 27/27 PASS and Sites is
36/36 PASS. No coverage, PostgreSQL, Docker, build, provider or network gate ran.

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

## Second corrective RED — all live authority must be eager and deployable

Both independent verifiers rejected corrective production-author candidate
`a6fb72975440320421b0867f83fb9f7912294947` / tree
`2a1dfc837f5e11a66464c6c71a5e5931bc9bbd3b`. The candidate moved heartbeat
after the visible `createProductionWorker` call, but retained three command-time
configuration authorities after the heartbeat: replay bundle path/open,
preflight-report path/open, and safe-consumer address parsing. A worker could
therefore publish a current row and fail its first replay or safe-consumer
command. Its fixed production Compose overlay also supplied only the three
worker secret files plus deployment identity; it omitted the required relayer
policy, safe-consumer and replay-file wiring, so the selected immutable runtime
could not start an actual worker.

Product found both P1s during source verification and stopped before Docker or
build. Core independently reproduced both from the exact source and fixed
Compose wrapper, then issued formal FAIL on the same clean commit/tree. Before
the findings were confirmed, Core had completed typecheck, 119 focused controls
with four explicitly PostgreSQL-gated skips, 53 nearest controls, 27 deployment
static controls, contracts/domain 524 cases at 100% statements/branches/
functions/lines, backend 1,151 cases with 41 expected skips at 91.62% lines and
86.78% branches, and real PostgreSQL 161/161 with zero skip. Those local results
do not override the P1s. Core and Product intentionally made no Docker, build,
Sites, hosted, deployed or live-worker acceptance claim for the rejected tree.

The refrozen boundary is two-stage and entirely pre-authority. Pure
`parseWorkerRuntimeConfig` resolves exact database/login, deployment/tree,
policy, non-zero safe consumer, strict endpoints and bounded tuning, derives an
account without retaining the raw key, and returns a frozen typed configuration.
Async `loadWorkerReplayEvidence` opens the two absolute files once with
read-only/no-follow/nonblocking flags, applies the 2,200,000/65,536 byte limits,
fatal UTF-8, canonical/checksum/terminal-PASS validation and exact public-report
binding, then freezes canonical strings and their digests. Both complete before
Pool creation and schema verification. Repository, live ports and command
handlers receive typed immutable slices only and have no environment or
filesystem authority. Every failure is the fixed non-leaking
`WORKER_RUNTIME_CONFIGURATION_INVALID` error and creates no Pool, heartbeat,
claim or network effect.

Database URL authority is deliberately separate from the accepted generic
secret XOR/file reader. Shared pure `parseExactApplicationDatabaseUrl` runs
after secret resolution and before Pool construction for API, worker,
recording importer and migrator. It requires the exact decoded application
login on `postgres:5432/proofline`, a non-empty password and no query/fragment;
swapped, administrator or malformed authority returns only the existing fixed
deployment-secret configuration error. The role-bootstrap full-set validation
remains unchanged.

Production Compose must require the fee cap, balance floor, daily quota,
non-zero safe-consumer address and both host replay paths. It fixes container
paths below `/run/proofline/replay`, uses long read-only binds with
`create_host_path: false`, and retains exactly three Docker secrets. Optional
strict endpoints and numeric tuning use the frozen defaults. QA may provide
accepted recorded fixtures but still does not start worker.

This corrective run is intentionally RED on the rejected production
tree. Typecheck is PASS. The expanded worker/DSN/downstream compatibility focus
is 7 files / 86 cases: 63 semantic RED and 23 controls PASS. The rendered
deployment focus is 29 cases: exactly 2 semantic RED and 27 controls PASS. The
REDs identify the absent typed parser/loader/shared URL parser, post-authority
environment/filesystem reads, incomplete Compose configuration/mounts, and the
retained downstream tests now requiring typed immutable input. A directory
fixture initially targeted a child of the bundle file and produced `ENOTDIR`;
it was corrected before evidence to use a sibling directory and thereafter
failed only on the intended missing loader. Nine unchanged nearest API/worker
files remain 113/113 PASS, and Sites compatibility remains 36/36 PASS. No
production, dependency, migration, Docker, provider or network change is part
of this RED wave.

A final compatibility audit found one retained Slice 005 case still expecting
an invalid relayer cap to be discovered after Pool and schema construction.
That stale expectation was corrected to the same fixed pre-authority runtime
configuration error and now requires zero Pool construction or cleanup, schema,
heartbeat, claim, verifier or external effect. The narrow Slice 005/runtime
authority focus is intentionally 44 RED and 4 controls PASS; typecheck and the
unchanged 113-case nearest baseline remain PASS.
