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
Linux/amd64 PostgreSQL build, GitHub release asset id `343810769`, at
`https://github.com/wal-g/wal-g/releases/download/v3.0.8/wal-g-pg-22.04-amd64.tar.gz`.
Its exact size is `17,891,961` bytes, archive identity is
`sha256:b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9`,
and extracted `wal-g` binary identity is
`sha256:f30544c5ce93cf83b87578e3c4a2e9c0e0ffc3d160ef89ecddaf75f397d98deb`.
A strict checked-in release lock records those exact values. Empty, zero,
repeated-placeholder, uppercase or malformed digests are invalid.

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

Prefetch and offline build form one continuous executable-identity lifetime.
Prefetch writes a strict canonical receipt containing the extracted binary's
exact byte size and frozen `binarySha256`. Before any Docker effect, the build
opens the selected `wal-g` with no-follow/nonblocking semantics, verifies that
it is a regular non-symlink file with exact `0555` mode, exact receipt size and
the checked-in digest through the open descriptor, then captures those same
descriptor bytes into a private bounded context. A replacement of the ignored
workspace pathname after prefetch therefore fails before build or cannot alter
the captured bytes. Both recovery-image build passes receive the expected
public digest, and the Dockerfile verifies the SHA-256 of the exact copied
`/usr/local/bin/wal-g` before the image can complete. Mode bits or a pathname
precheck alone are not an identity.

The WAL-G archive and binary identities above are frozen inputs, not a future
discovery. Controlled 027C1 GREEN prefetch verifies them before exposing the
named context. Only the exact new PostgreSQL/MinIO OCI index and Linux/amd64
manifest digests remain a controlled GREEN discovery because they are absent
from the accepted offline tree. RED rejects missing or placeholder values;
documentation and tests never invent them.

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

Before that destructive command, retention strictly parses
`BackupEvidenceV1`, requires byte-for-byte canonical JSON, verifies the
separately supplied evidence SHA-256, binds the evidence prefix to the active
constructed `WALG_S3_PREFIX`, derives the encryption-key identifier from the
mounted key bytes and validates every inventory key and aggregate. Missing,
stale, noncanonical, wrong-hash, wrong-prefix, wrong-key or invalid-key
evidence aborts before one `wal-g delete` effect. The security review did not
classify the earlier existence-only guard as exploitable across a lower
authority boundary, but strict validation remains required functional safety.

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

Expected inventory comes only from canonical completed `BackupEvidenceV1`.
Observed inventory comes from a fresh restore-reader-only enumeration of the
exact selected prefix after writer authority is removed. The verifier downloads
every bounded ciphertext object, computes its byte SHA-256, reconstructs the
UTF-8-key-sorted `{key,size,sha256}` entries and independently canonicalizes
`{entries,objectCount,totalBytes}`. Missing, changed or extra objects, duplicate
or out-of-prefix keys, truncated pagination and exceeded count/byte bounds fail
before PASS. The two digest operands may never be the same environment value,
`backup-list` output or provider ETag.

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

The recovery gate constructs two credential-free environments through the
import-safe `recovery-gate-environment` boundary: one complete Docker/Compose
profile containing only the exact checked-in run-scoped QA file paths and
nonsecret inputs, and one negative-child profile containing only the selected
PostgreSQL image plus reader-access-key, reader-secret and encryption-key file
paths. `PATH` is the only ambient value retained. A new empty
`DOCKER_CONFIG`, `HOME`, `XDG_CONFIG_HOME` and `TMPDIR` are explicit validated
gate inputs; locale and timezone are fixed. The CLI therefore selects only its
local default Unix engine through the isolated no-auth configuration.
`DOCKER_HOST`, `DOCKER_CONTEXT`, Docker TLS/certificate/auth configuration,
SSH-agent and BuildKit/buildx authority in the ambient environment or as a
direct constructor input fail with `RECOVERY_GATE_ENV_INVALID`. Other ambient
registry/cloud credentials, proxies, tokens, secrets, API keys and private
keys are stripped. An unknown scoped name, direct secret, empty value or NUL
also fails with the same fixed error. Neither inventory digest operand is an
allowed environment input.

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

The executable gate owns an import-safe core and an injected Docker runtime;
an array of case names, source-text matches or `void` references is not
negative evidence. It executes these exact bounded cases in order:

| Case | Required fixed failure |
|---|---|
| `missing-wal-object` | `RECOVERY_MISSING_OBJECT` |
| `corrupt-backup-object` | `RECOVERY_CORRUPT_OBJECT` |
| `wrong-encryption-key` | `RECOVERY_ENCRYPTION_KEY_INVALID` |
| `future-recovery-target` | `RECOVERY_TARGET_UNAVAILABLE` |
| `reused-restore-volume` | `RECOVERY_VOLUME_REUSED` |
| `nonempty-restore-volume` | `RECOVERY_VOLUME_NOT_EMPTY` |
| `promotion-authorization-absent` | `RESTORE_PROMOTION_FORBIDDEN` |
| `promotion-authorization-mismatch` | `RESTORE_PROMOTION_EVIDENCE_MISMATCH` |

Each case has a bounded abort signal, observes a structured `status: "failed"`
result with its exact code, writes zero PASS evidence, attempts zero promotion
and performs exact scoped cleanup before the next case. A success exit, wrong
code, string-only result, timeout, PASS write, promotion attempt or any leftover
container/network/volume/temporary path fails the entire gate. Promotion cases
must prove `pg_promote` was never called.

For the first six recovery cases, the case driver may prepare only the adverse
state. A separate runtime must invoke the actual case-scoped MinIO,
`pitr-fetch`, PostgreSQL restore or production volume-preflight path, capture
the real child exit and complete output, normalize the fixed code from that
output and independently observe that the mutation reached its sink. A result
also binds case ID, nonzero child exit, child-output SHA-256, mutation/sink
observations and zero PASS/promotion counts. A driver-supplied expected code,
local random-file comparison, timestamp tautology or path alias is rejected.
The two promotion cases continue to execute the real authorization helper.

Child output is authority only for the exact failed case/code and parent-owned
exit/output digest. It can never author mutation, sink, PASS or promotion
observations. After the child exits, the parent independently inspects the
case-specific MinIO object/hash, mounted key/target/volume state, Docker
container/log sink, PostgreSQL recovery state, PASS path and promotion state.
The accepted result names these fields `parentObservationSha256`,
`parentMutationObserved`, `parentSinkObserved`, `parentPassEvidenceCount` and
`parentPromotionCount`. A matching forged child JSON record or observation
file is ignored and must fail whenever any parent probe disagrees.

All negative prepare, execute, parent-inspect and cleanup effects use
non-shell asynchronous children in their own process group. `spawnSync`, sync
exec, blocking filesystem waits and advisory-only aborts are forbidden from
the negative import graph. Each child receives the remaining part of the exact
30-second case deadline, capped at 25 seconds, with 32 MiB combined output;
deadline or outer abort sends `SIGTERM` to the process tree, waits exactly one
second, sends `SIGKILL`, and reaps it before returning. Per-case cleanup runs in
a separate 15-second `finally` deadline and the whole-project finalizer has a
separate 30-second deadline. A hung prepare, execute, inspect or cleanup returns
fixed `RECOVERY_NEGATIVE_TIMEOUT` / `Recovery negative control timed out`,
writes no PASS/promotion evidence and cannot leave a child, container, network,
volume or temporary path. Residual resources still use the distinct cleanup
failure contract.

Every accepted parent observation is additionally bound to one canonical
negative-case identity: case id, random negative project, exact service and
container, object target when applicable, restore volume and case-local PASS
path. The identity is hashed before the child runs and the parent rejects a
fixture whose binding differs in any field. Object absence must be an exact
not-found observation for that key; corrupt-object evidence binds key, size
and digest; sink and promotion probes address only the negative project and
its case service/container. The positive restore project and child
exit/status/output are never mutation, sink, PASS or promotion evidence.

For `future-recovery-target`, the parent sink and zero-promotion observations
share one terminal-only, import-safe probe over the exact bound negative
container. Its parent-owned bounded Docker runner reads `{{json .State}}` and
the container logs. Acceptance requires `Status` exactly `exited`, a safe
integer PostgreSQL process `ExitCode` greater than zero, successful bounded log
collection and the exact case-sensitive PostgreSQL signature
`recovery ended before configured recovery target was reached`. A running
server, including `pg_is_in_recovery() = true`, is an ordinary intermediate
state and is never failure or no-promotion evidence. Child exit, output or
observation fields are not inputs to this probe and cannot substitute for the
parent-read terminal state.

Timeout settlement is close/reap-gated. For a TERM-resistant leader or
descendant, the async helper sends `SIGTERM`, waits the frozen grace, sends
`SIGKILL`, then waits for the whole process group to close before rejecting;
cleanup cannot begin while a case child remains. The outer project lifecycle
uses a nested outermost `finally`: project-finalizer rejection or normalized
timeout remains the reported failure, but recursive removal of the temporary
secret directory still runs before settlement.

Controlled prefetch uses its own exact child environment inventory: `PATH`, a
fresh `DOCKER_CONFIG`, `HOME`, `XDG_CONFIG_HOME`, `TMPDIR`, and fixed
`LANG=C`, `LC_ALL=C`, `TZ=UTC`. Inspect, pull and dependency-build children
receive no ambient Docker endpoint/context/TLS/certificate/auth, SSH,
BuildKit/buildx, proxy, cloud/GitHub, token, secret, API-key or private-key
authority. The fresh Docker config remains mode `0700`, contains exact
`{"auths":{}}`, and is removed on success or failure.

The positive restore evidence is constructed only from machine-readable actual
`pitr-verify` fields: recovery and replay-paused state, system identifier,
schema/checksum counts, before/after cut counts and inventory SHA-256. The gate
derives booleans by comparison with expected values. Literal assignments such
as `beforeCutPresent = true` or `afterCutAbsent = true`, or successful job exit
without parsed fields, cannot create PASS evidence.

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
