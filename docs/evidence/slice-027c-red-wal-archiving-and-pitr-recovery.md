# Slice 027C RED — WAL archiving and PITR recovery

Status: intentional RED frozen; production implementation pending.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Architect and Contract/Test Designer; this author cannot implement the
production change or verify its eventual candidate.

Accepted parent commit: `527c561ec37b1a6a0b0c45b2c9abe8a41107f1bf`

Accepted parent tree: `ebdf6484b0f9d755dbd55906c3a121fd9f3d2c64`

Architecture decision: [ADR 0037](../adr/0037-wal-archiving-and-pitr-recovery.md)

Slice contract: [027C](../slices/027c-wal-archiving-and-pitr-recovery.md)

## Accepted prerequisite

Core and Product independently returned PASS for Slice 027B on the exact parent
identity above. That stopped tree passed local coverage, real PostgreSQL,
offline/no-pull Docker, runtime lifecycle, build and Sites gates. The runtime
heartbeat was a test-only SQL fixture: it is not actual worker, hosted,
DigitalOcean, Spaces or live Coston2 evidence.

## Frozen surface

This wave changes documentation and tests only. It freezes pure recovery
evidence, canonical bytes and checksums; WAL-G and official image locks;
credential-isolated prefetch and offline build seams; strict backup
configuration and file-secret loading; the dedicated backup login; encrypted
archive/base-backup/status/retention services; and private MinIO exact-time
new-volume recovery with explicit promotion authorization.

Production source, dependencies, lockfile, Dockerfiles, image locks,
Compose/Caddy configuration, package scripts and protected Sites files remain
unchanged. No Docker, image pull/build, Testcontainers, external network,
registry, provider or credential effect ran during RED.

## Intentional RED evidence

TypeScript remains structurally valid:

```sh
npm run typecheck
```

Result: PASS.

The focused contracts and backup-role matrix is:

```sh
npx vitest run \
  packages/contracts/test/slice027c-recovery.contract.test.ts \
  apps/api/test/slice027c-backup-role.contract.test.ts \
  apps/api/test/postgres/slice027c-backup-role.contract.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: 3 files: 15 intentional RED, 2 accepted controls PASS and 2 real
PostgreSQL cases SKIP because `PROOFLINE_TESTCONTAINERS=1` was not set. The
skips are a frozen future gate and are not PostgreSQL acceptance evidence.
Failures are exactly the absent cycle-free recovery export/schemas/canonical
serializers and absent sixth file-only backup database profile, strict URL,
bind-parameter replication login and exact grants.

The deployment/recovery matrix is:

```sh
node --test tests/deployment/slice027c-backup-recovery.contract.test.mjs
```

Result: 14 cases: 12 intentional RED and 2 accepted documentation/readiness
controls PASS, zero skip. Failures are exactly the absent real WAL-G hashes,
official image digests, recovery PostgreSQL image, isolated prefetch/build,
configuration/secrets, production backup overlay/wrapper/scripts, recovery
gate, private MinIO drill and promotion seam.

No hash or OCI digest was invented. WAL-G URL, exact size and both SHA-256
values are now frozen inputs; controlled 027C1 GREEN prefetch must verify them.
Only the absent OCI image digests remain controlled discovery before an offline
build can pass.

## Accepted controls

The nearest accepted contracts remain GREEN:

```sh
npx vitest run \
  packages/contracts/test/slice027b-deployment-readiness.contract.test.ts \
  apps/api/test/slice027b-db-role-bootstrap.contract.test.ts \
  apps/api/test/slice027b-deployment-database-authority.contract.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: 3 files, 30/30 PASS, zero skip.

```sh
node --test \
  tests/deployment/slice027a-compose-caddy.contract.test.mjs \
  tests/deployment/slice027b-runtime-lifecycle.contract.test.mjs \
  tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs
```

Result: 45/45 PASS, zero skip.

Sites compatibility remains GREEN without a rebuild or protected-file change:

```sh
npm run test:sites
```

Result: 36/36 PASS, zero skip.

## Harness review

The frozen schema validates the shape and digest grammar of a promotion
authorization but does not pretend to know the external restore digest it must
match; that binding is operationally checked before `pg_promote`. Backup-login
tests require the exact four-value bind call
`[proofline_backup_login, password, false, true]` instead of depending on SQL
statement ordering. The recovery gate may mention worker only to prove it was
not started; the QA Compose file itself must contain neither a worker service
nor its private-key input.

### Slice 009 package-boundary compatibility correction

After the initial RED freeze at commit
`bef57561458c980405ba1bb97a616c22e842d1e5` / tree
`11c389950fbd760158137e43102f19413161eeba`, the unchanged accepted Slice 009
worker-purity test still required the pre-027C contracts export map to contain
exactly five entries. That historical absence contradicts ADR 0037 and would
reject the frozen sixth exact feature entry `./recovery: ./src/recovery.ts` even
after correct implementation.

The compatibility correction preserves all five prior entries byte-for-byte,
adds only the exact sixth entry, requires recovery feature/root runtime identity
and a cycle-free/effect-free feature module, and proves a fresh worker bundle
and esbuild metafile contain neither recovery schema strings nor recovery input
bytes. Existing wallet, manifest, template, deployment, custody, side-effect and
worker-artifact exclusions remain unchanged. This is intentional 027C RED, not
a package-boundary or worker-custody weakening.

The first focused attempt used a literal dynamic deep import, which Vite tried
to resolve before test execution while the intentionally absent package export
was still RED. The harness now follows the adjacent accepted pattern and passes
the specifier through a variable, allowing all purity controls to execute
without changing the production contract.

Typecheck remains PASS. The corrected Slice 009 plus recovery-contract focus is
2 files / 23 cases: 8 intentional RED and 15 controls PASS. The fresh worker
bundle/metafile case is among the PASS controls and proves zero recovery input
bytes. The nearest worker bootstrap/entry/lifecycle matrix is 4 files, 21/21
PASS with zero skip; Sites compatibility remains 36/36 PASS. No production
source, package metadata, build artifact, Docker resource or network state was
changed.

### WAL-G release-asset identity correction

The initial RED freeze inserted an extra `ubuntu-` component into the asset
filename; that object does not exist in the official v3.0.8 release and made
the future controlled prefetch unsatisfiable. The exact
official Linux/amd64 asset is GitHub release asset id `343810769`, filename
`wal-g-pg-22.04-amd64.tar.gz`, URL
`https://github.com/wal-g/wal-g/releases/download/v3.0.8/wal-g-pg-22.04-amd64.tar.gz`,
size `17,891,961`, archive SHA-256
`b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9`
and extracted binary SHA-256
`f30544c5ce93cf83b87578e3c4a2e9c0e0ffc3d160ef89ecddaf75f397d98deb`.

The deployment RED now requires those exact values and the prefetch source to
name the exact asset. All no-auth, bounded-size, two-checksum, named-context and
offline-build authority remains unchanged. This tests/docs-only correction
performed no network, Docker, production, dependency, lock or Compose effect.
After the correction, typecheck is PASS; focused recovery remains exactly 15
intentional RED, 2 controls PASS and 2 real-PostgreSQL cases gated; deployment
recovery remains 12 intentional RED and 2 controls PASS. The nearest accepted
deployment/roadmap matrix is 45/45 PASS and Sites is 36/36 PASS.

### Recovery-gate control-bypass corrective RED

The production WIP was inspected read-only from stash object
`6cd5c72c2835c87e6b8d7fb896669ddc02374f7d` / tree
`134cd52250824ebfc86f0a27224753faf6dc86b4` and its untracked tree
`f9360f74c913270842d1dee9b8210ea8c3587fb3`; it was never applied. The candidate
`scripts/docker-recovery-gate.mjs` declared negative case names and immediately
discarded them with `void negativeCases`. Its positive path then assigned
`beforeCutPresent` and `afterCutAbsent` literal `true` values after a job exit.
No missing/corrupt object, wrong key, future target, reused/nonempty volume or
promotion-authorization negative actually ran. This is a CWE-693 protection
mechanism failure, so the WIP is rejected and supplies no recovery evidence.

Corrective RED adds an import-safe injectable core contract with eight exact
cases and fixed failure codes. Each case must return structured failure, zero
PASS-evidence writes, zero promotion attempts and exact zero cleanup counts;
strings, names, wrong codes, timeout and leftover resources fail closed. The
core must derive every restore/check boolean from actual machine-readable
`pitr-verify` fields. Source assertions require the Docker runtime and entry to
invoke that core and explicitly prohibit discarded case arrays or hardcoded cut
booleans. No negative case may reach `pg_promote`.

Corrective RED was demonstrated on the clean base
`5bd192242b09ed3a348a80456c544b431c21a9f7` / tree
`3d81e905d600c3151482718799d0f8e02dd24fbd`: `npm run typecheck` PASS; the new
executable-negative suite is 16/16 intentional RED because the import-safe core
and runtime do not exist; the existing deployment recovery contract remains 12
intentional RED and 2 controls PASS. The unchanged nearest deployment/roadmap
controls are 45/45 PASS and Sites compatibility is 36/36 PASS. No Docker,
network, production, dependency or lockfile operation was run.

## Required GREEN evidence

- 100% statements/branches/functions/lines for pure recovery contracts;
- affected API coverage at least 90% lines and 85% branches;
- real PostgreSQL backup-role cases with zero skip;
- controlled no-auth prefetch followed by two offline/no-pull builds;
- exact 027A, 027B and `test:docker:recovery` gates with scoped cleanup;
- build/Sites compatibility and two independent reports on one stopped tree.

Until those gates pass, Proofline has no WAL-G runtime, base backup, PITR,
Spaces, actual RPO/RTO, hosted restore or promotion evidence.
