# ADR 0037 — WAL archiving and PITR recovery

Status: accepted

## Context

[ADR 0029](0029-digitalocean-vds-deployment.md) requires off-host PostgreSQL
WAL archiving, regular base backups and a credential-free MinIO restore drill.
[ADR 0035](0035-credential-free-container-runtime-boundary.md) pins the
Linux/amd64 container boundary, while
[ADR 0036](0036-checksummed-migrations-and-deployment-readiness.md) proves
schema version 10, a 10-entry checksum ledger and application readiness. None
of those decisions currently creates recoverable backup bytes.

The independently verified 027B prerequisite is exact commit
`527c561ec37b1a6a0b0c45b2c9abe8a41107f1bf` / tree
`ebdf6484b0f9d755dbd55906c3a121fd9f3d2c64`. Core and Product verification
both passed the same stopped tree, including real PostgreSQL, exact migration
history, bounded Docker lifecycle and cleanup. Its SQL heartbeat fixture was
test-only and no actual worker, backup, restore, Spaces or hosted evidence was
claimed.

The current PostgreSQL 17.6 Alpine image cannot safely consume the official
WAL-G Ubuntu/glibc release binary. Building an unpinned package from a mutable
Alpine repository, downloading during an image build or using a third-party
all-in-one database image would weaken the accepted image authority.

## Decision

### Delivery waves

027C is delivered in three stopped-tree waves:

1. **027C1** freezes recovery schemas, WAL-G release identity, official image
   locks, configuration and secret-file authority;
2. **027C2** implements continuous encrypted WAL archive, one-shot base backup,
   status and retention through the production wrapper;
3. **027C3** proves exact-time encrypted PITR against private local MinIO into
   a distinct new volume, paused before any promotion.

No wave may claim a Droplet snapshot, running container, `pg_dump`, copied
volume or successful base-backup command as PITR evidence.

### Tool and image identity

WAL-G `v3.0.8` is the only backup tool. The controlled asset is the official
Linux/amd64 PostgreSQL build at
`https://github.com/wal-g/wal-g/releases/download/v3.0.8/wal-g-pg-ubuntu-22.04-amd64.tar.gz`.
A strict checked-in release lock records the exact asset URL, maximum bytes,
asset SHA-256 and extracted binary SHA-256. Empty, zero, repeated-placeholder,
uppercase or malformed digests are invalid.

The production PostgreSQL image is a Proofline-owned custom image built from
the exact official `postgres:17.6-bookworm` Linux/amd64 manifest. It copies the
already verified WAL-G binary from a named local BuildKit context
`wal_g_release`; it does not use `curl`, `wget`, package-manager network access,
GitHub access or a mutable tag during the Docker build. It retains the official
PostgreSQL entrypoint and non-root database user.

Controlled prefetch is the only network-capable step. It uses a fresh no-auth
Docker CLI configuration, strips registry, GitHub, AWS, provider, npm and live
Proofline credentials, follows only the exact bounded HTTPS release-asset
allowlist, limits redirect count, bytes and time, and verifies the archive and
binary digests before exposing the named context. The PostgreSQL Debian,
MinIO-server and MinIO-client images are also locked by official index and
Linux/amd64 manifest digests. Actual builds repeat twice with
`--pull=false --network none`. MinIO and its client are QA-only inputs and are
not production release images.

The exact new OCI digests and WAL-G archive/binary hashes are a controlled
027C1 GREEN discovery because they are not present in the accepted offline
tree. RED requires valid real values and rejects placeholders; documentation
and tests never invent them.

### Continuous WAL archive and storage authority

Production freezes `archive_mode=on`, `archive_timeout=60s`, an exact bounded
WAL-G `archive_command` wrapper and `WALG_PREVENT_WAL_OVERWRITE=true`. The
wrapper validates PostgreSQL's `%p` and `%f`, derives the database system
identifier from local `pg_controldata`, constructs the storage prefix itself,
loads bounded secret files without logging, and execs only `wal-g wal-push`.
It never accepts a complete caller-owned S3 prefix.

The exact root is:

`s3://<bucket>/proofline/v1/<slot>/<postgres-system-identifier>`

`slot` is `staging` or `production`; QA alone may use `qa`. WAL-G exclusively
owns `basebackups_005/` and `wal_005/` below that root. Backup IDs are selected
exactly from verified evidence. `LATEST`, an unbounded prefix, another system
identifier or another slot is never restore authority.

Production accepts only an exact HTTPS DigitalOcean Spaces endpoint
`https://<region>.digitaloceanspaces.com` on port 443, a matching lowercase
region and a DNS-compatible bucket. QA permits only exact internal
`http://minio:9000` through a separate override that the production wrapper
never loads.

The primary receives a write-only/list-bounded Spaces identity and the
client-side libsodium key through Docker secret files. Direct primary archive
authority is deliberate: PostgreSQL reports archive success only after the
off-host encrypted upload succeeds. A local-spool acknowledgement sidecar is
rejected because it would either acknowledge before off-host persistence or
introduce a second durable protocol. PostgreSQL gains no public port or Docker
socket, but joins the bounded backup-egress network.

Restore uses a different read-only object-store identity. Retention uses a
third identity with bounded deletion authority. The high-entropy libsodium key
is separate from all three identities and is never stored in the bucket,
evidence or logs. Evidence records only its SHA-256 key identifier. Rotation
uses a new key identifier and storage prefix; old restore keys remain separately
escrowed until their backup chain expires.

### Backup database role

Role bootstrap adds exact login `proofline_backup_login` from
`PROOFLINE_BACKUP_DATABASE_URL_FILE`. It is `LOGIN INHERIT NOSUPERUSER
NOCREATEDB NOCREATEROLE REPLICATION NOBYPASSRLS`, receives `CONNECT`,
`pg_monitor` and explicit execution authority for PostgreSQL 17 backup control
functions `pg_backup_start(text, boolean)`, `pg_backup_stop(boolean)` and
`pg_switch_wal()`. It receives no Proofline application group membership,
table DML, schema ownership, role creation or bypass-RLS authority.

This is cluster-level role provisioning under ADR 0037, not application schema
state. No migration 011 is added.

### Base backup, status and retention

The production recovery overlay defines exact one-shot services
`base-backup`, `backup-status` and `backup-retention`. They use the same custom
PostgreSQL image, remain non-root/read-only/capability-dropped/resource-bounded,
publish no port, mount no Docker socket and are reachable only on the database
and backup-egress networks they need. `base-backup` mounts the PostgreSQL data
volume read-only.

Base backup holds fixed advisory lock `-4708329426407388776` in the same
database session across `wal-g backup-push`. Concurrent invocation fails with
bounded code `BACKUP_ALREADY_RUNNING`. Backup runs daily at 02:00 UTC through a
host timer invoking the fixed production wrapper; no scheduler container gains
Docker authority.

Eight completed full backups are retained. `backup-retention` runs only after
a current verified backup evidence artifact and executes exact WAL-G retention
equivalent to `delete retain FULL 8 --confirm`, preserving WAL needed by every
retained backup. It never receives writer or reader credentials. An object-store
lifecycle may be a later safety backstop but cannot delete the WAL-G prefix
earlier than this policy.

Design objectives are RPO at most five minutes and production RTO at most 60
minutes. Archive timeout is 60 seconds; operational evidence is degraded when
archive failure/pending age reaches five minutes or the last completed base
backup exceeds 26 hours. The credential-free fixture drill must finish within
15 minutes. These are design objectives, not a production SLA before hosted
evidence exists.

Backup status is operator-only strict JSON. It does not alter `/healthz` or
`/readyz`, and the API receives no object-store credential.

### Immutable recovery evidence

Strict cycle-free schemas live at `@proofline/contracts/recovery` with root
re-export identity. `BackupEvidenceV1` contains exactly:

- `version: "1"`, `kind: "base-backup"` and `status: "completed"`;
- producer commit/tree, immutable PostgreSQL image digest and WAL-G version;
- deployment slot, PostgreSQL system identifier and major version 17;
- schema version 10, checksum count 10 and migration-manifest SHA-256;
- provider, endpoint origin, bucket, constructed prefix, libsodium algorithm
  and encryption-key identifier SHA-256;
- exact backup ID, UTC start/completion, start/stop LSN, WAL segments and
  timeline;
- sorted ciphertext object entries, object count, total bytes and canonical
  inventory SHA-256.

The inventory entries are exactly `{key, size, sha256}` sorted by UTF-8 key,
limited to relative `basebackups_005/` or `wal_005/` keys. Their count and byte
sum must equal the declared aggregates. ETag is never described as SHA-256.
Canonical UTF-8 serialization has its own SHA-256 and contains no credentials,
database URL, local path or object bytes.

`RestoreDrillEvidenceV1` contains producer identity, exact source backup
evidence SHA-256, UTC target, `inclusive: true`, exact timeline, distinct source
and restore volume identity digests, paused/in-recovery/not-promoted state,
system/schema/checksum/inventory results, before-cut-present and
after-cut-absent results, timestamps and `status: "passed"`.

`RestorePromotionAuthorizationV1` is a separate explicit operator artifact
bound to the exact restore-evidence SHA-256. Missing, expired, mismatched or
noncanonical authorization aborts before `pg_promote`. A restore PASS does not
itself authorize cutover.

### Exact-time MinIO PITR drill

The QA recovery overlay adds private, no-host-port `minio`, `minio-init`,
`pitr-fetch`, `pitr-postgres` and `pitr-verify`. MinIO root authority exists
only in the ephemeral init job, which creates distinct writer, reader and
retention identities. Application containers and production wrappers cannot
import this QA authority.

The source database applies exact schema 10/10 and inserts a base sentinel. A
base backup completes. Transaction A then commits; the harness records an
exact PostgreSQL-clock UTC target between A and later transaction B, forces WAL
switch and waits for encrypted archive completion. Source-container access is
removed before restore.

`pitr-fetch` requires an exact backup evidence digest, backup ID, target and
timeline, and writes only to a demonstrably new empty named volume. It writes
`recovery.signal`, exact restore command, `recovery_target_time`,
`recovery_target_inclusive=on`, exact numeric timeline and
`recovery_target_action=pause`. It never uses `LATEST`.

The restored server remains in recovery and paused. Verification proves the
same system identifier, schema version 10, ten matching migration checksums,
base sentinel and transaction A present, transaction B absent, and matching
object inventory. No API or worker starts. The ordinary drill never promotes.

An earlier-than-backup, future or later-than-verified-WAL target, missing WAL,
missing/corrupt object, wrong key, wrong system/slot/prefix, reused or nonempty
volume and promotion without exact authorization all fail closed. Failure
creates no PASS/promotion evidence and cleanup removes only the exact QA
project, volumes, secret directory and port probes.

## Excluded authority

- No DNS, SSH, DigitalOcean, Spaces, GHCR or live Coston2 credential is used.
- No hosted/VDS backup, actual RPO/RTO, staging restore or production promotion
  is claimed.
- A Droplet backup remains secondary host recovery and is not PITR evidence.
- `pg_dump`, filesystem copy and same-volume restart are not recovery evidence.
- Redis, Helm, public MinIO/PostgreSQL ports and Docker-socket mounts remain
  absent.
- 028A owns verified OCI archives, 028B owns credentialed staging publication,
  029A owns the unified credential-free freeze, and 029B owns production
  promotion.

## Consequences

- PostgreSQL changes from the accepted Alpine base to an exact official Debian
  base so the official WAL-G glibc artifact is supportable.
- The custom PostgreSQL image becomes a 028A production release artifact;
  MinIO and its client remain QA-only pinned dependencies.
- Object-store failure can accumulate local WAL and therefore requires bounded
  archive-age and disk-pressure operations before promotion.
- Restore is always new-volume, evidence-bound and paused before explicit
  promotion.
