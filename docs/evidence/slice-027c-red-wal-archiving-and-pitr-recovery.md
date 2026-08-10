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

No hash or OCI digest was invented. The controlled 027C1 GREEN prefetch must
discover and lock real upstream values before any offline build can pass.

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

## Required GREEN evidence

- 100% statements/branches/functions/lines for pure recovery contracts;
- affected API coverage at least 90% lines and 85% branches;
- real PostgreSQL backup-role cases with zero skip;
- controlled no-auth prefetch followed by two offline/no-pull builds;
- exact 027A, 027B and `test:docker:recovery` gates with scoped cleanup;
- build/Sites compatibility and two independent reports on one stopped tree.

Until those gates pass, Proofline has no WAL-G runtime, base backup, PITR,
Spaces, actual RPO/RTO, hosted restore or promotion evidence.
