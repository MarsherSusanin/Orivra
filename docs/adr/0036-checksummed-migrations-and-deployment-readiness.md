# ADR 0036 — Checksummed migrations and deployment readiness

Status: accepted

## Context

[ADR 0029](0029-digitalocean-vds-deployment.md) requires a one-shot migration
container, exact schema verification and separate process liveness and
application readiness. [ADR 0035](0035-credential-free-container-runtime-boundary.md)
packages the API, worker and PostgreSQL but deliberately leaves their runtime
profile blocked until those lifecycle authorities exist.

The accepted database currently records only integer versions in
`proofline_private.schema_migrations`. Migrations 001–009 are exact immutable
files, but their historical rows carry no filename or digest. Silently adopting
those rows as checksummed history would turn a version number into evidence it
never contained. The production API and worker also start without an exact
schema gate, and the existing worker command-lease renewal proves only one
claimed command, not that the deployed worker process is current.

Slice 027B must make migration, role and readiness truth durable without
inventing worker availability in the credential-free Docker gate. Backup,
restore and disk-capacity evidence remain separate work.

## Decision

### Delivery waves

027B is one persistence and deployment-readiness boundary delivered in three
stopped-tree waves:

1. **027B1** freezes and implements the immutable migration manifest, role
   bootstrap, migration runner and additive migration 010;
2. **027B2** freezes and implements API liveness/readiness plus the production
   worker deployment heartbeat and retention;
3. **027B3** replaces the 027A runtime profile block with verified Compose
   ordering and a bounded credential-free PostgreSQL/API lifecycle gate.

No wave may call a SQL-inserted test heartbeat actual worker readiness, live
Coston2 evidence, hosted evidence or deployment evidence.

### Immutable migration authority

`apps/api/db/migrations/manifest.v1.json` is a strict checked-in ordered
manifest. Its exact root is `{version: "1", lockKey:
"-4708329426407388777", schema: {targetVersion: 10,
minimumCompatibleVersion: 10, maximumCompatibleVersion: 10}, migrations}`.
Each entry has exactly positive
integer `version`, exact filename and lowercase `sha256:<64 hex>` over the raw
checked-in file bytes. Entries are contiguous, filenames begin with the same
three-digit version and only the listed files may exist in the migration
directory. Missing, extra, reordered, duplicated, renamed, non-UTF-8, wrapper-
invalid or digest-mismatched input fails before a PostgreSQL connection or any
Docker effect.

The one-shot runner uses the exact release API image. It obtains the fixed
session advisory lock `-4708329426407388777`, applies a 60-second statement
timeout and holds one database client until commit or rollback and explicit
unlock. Each migration must begin with exact `BEGIN;\n` and end with exact
`\nCOMMIT;\n`. The runner removes only that wrapper and applies every pending body
plus its exact checksum-ledger row in one runner-owned transaction. It never
executes a down migration, skips a version, edits a migration row, imports from
HTTP or scans an alternate path.

`010_deployment_lifecycle.sql` is the first schema compatible with this runner.
It creates exact table `proofline_private.migration_checksums`: integer
`version` is its primary key and references `schema_migrations(version)` with
delete restricted; `filename` is unique and matches the exact migration-name
grammar; `sha256` is exactly 32 bytes. Both `schema_migrations` and
`migration_checksums` deny update, delete and truncate. The API, worker and
recording-importer groups receive read-only checksum history.
A fresh database applies 001–010 and records the complete ledger atomically.
An existing database with version-only rows 1–9 has no checksum evidence and
must fail with fixed code `MIGRATION_HISTORY_UNVERIFIED`; the runner must
not infer or backfill those digests. A future operational adoption, if ever
required, needs separate externally verified evidence and a new ADR. Unknown,
future, gapped, duplicate or mismatched history also fails before applying a
pending migration.

Bounded runner failure codes are exactly
`MIGRATION_MANIFEST_INVALID`, `MIGRATION_LOCK_TIMEOUT`,
`MIGRATION_HISTORY_UNVERIFIED`, `MIGRATION_CHECKSUM_MISMATCH`,
`MIGRATION_VERSION_GAP`, `MIGRATION_DATABASE_AHEAD`,
`MIGRATION_APPLY_FAILED` and `MIGRATION_TARGET_MISMATCH`. Logs contain only bounded code/version information,
never SQL, database URLs, file paths, stack traces or secret values.

The runner verifies exact resulting version 10 and the entire ledger before
success. Two concurrent runners serialize under the same lock: one applies;
the other rereads, verifies byte-identical history and exits successfully
without mutation. A failed body rolls back its schema and ledger row, and a
subsequent run may retry.

### Role bootstrap and least privilege

Two one-shot jobs use the exact release API image and separate commands. The
database-role bootstrap job alone receives the PostgreSQL administrator URL
and four role-specific database URL files. A bind-parameterized database function creates or
rotates the exact deployment login roles without interpolating, logging or
serializing passwords. The migration job uses a dedicated non-superuser
`CREATEROLE` schema-owner login; it does not receive the PostgreSQL administrator
password after bootstrap.

The exact inputs are `DATABASE_URL_FILE` for the administrator and
`PROOFLINE_MIGRATOR_DATABASE_URL_FILE`,
`PROOFLINE_API_DATABASE_URL_FILE`,
`PROOFLINE_WORKER_DATABASE_URL_FILE` and
`PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE`. Every URL selects the same
`postgres:5432/proofline` database and its exact login username. The temporary
`pg_temp.ensure_login` function receives login and password values only as bind
parameters.

Application logins inherit only their existing `NOLOGIN` group roles:
`proofline_api`, `proofline_worker` and
`proofline_recording_importer`. Exact LOGIN roles are
`proofline_migrator_login`, `proofline_api_login`,
`proofline_worker_login` and `proofline_recording_importer_login`. They are
`LOGIN INHERIT` with no superuser, database creation, replication or bypass-RLS
authority. API, worker and recording importer cannot create
roles, own the private schema, mutate migration history or use another
application role. The migrator cannot perform worker live effects or use an
application token/key. Public access remains revoked. Role bootstrap is
idempotent, password rotation is explicit, and every error is bounded and
redacted.

The order is PostgreSQL engine healthy → role bootstrap completed successfully
→ migration completed successfully → API and worker startup. API and worker
never apply migrations implicitly.

### Schema gate and public process endpoints

Both application processes verify exact schema version 10 and exact migration
ledger before ordinary work. API performs this gate before binding its socket.
Worker performs it after all live deployment secrets/configuration have been
validated but before creating a deployment heartbeat or claiming a command.
Mismatch, unreachable database or unverified history fails startup with a
bounded configuration error and no listen, claim or external effect.

The strict public schemas live in the cycle-free pure feature subpath
`@proofline/contracts/deployment`, with root identity re-export compatibility.

Anonymous `GET /healthz` with no query returns exact canonical JSON
`{"version":"1","status":"ok"}` and performs no database, worker, verifier,
RPC, source, compiler or wallet I/O. Anonymous `GET /readyz` with no query uses
PostgreSQL to verify database reachability, schema version/checksum authority
and the current deployment's worker heartbeat. Ready returns exact
`{"version":"1","status":"ready","checks":{"database":"ready","schema":"ready","worker":"ready"}}`.
Unavailable returns 503 with strict status `not-ready`; database is
`unavailable|ready`, schema is `unavailable|mismatch|ready` and worker is
`unavailable|missing|stale|ready`. Database unavailable forces schema and worker
to `unavailable`; schema mismatch forces worker to `unavailable`.

Both routes are outside `/v1` and dispatched before auth and CORS. Exact
responses carry JSON UTF-8, exact content length, `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; they carry
no ETag, ACAO, `Vary` or `WWW-Authenticate`. Any non-GET method, including
OPTIONS, returns the ordinary bounded 405 with `Allow: GET`; any query returns
the ordinary bounded 404. Neither route emits secrets, connection strings, SQL,
paths, stack traces, hostnames or raw exceptions. Liveness never implies
readiness. Disk free space is not truthfully observable from this API contract
and is excluded.

### Persisted deployment worker heartbeat

Migration 010 adds private table
`proofline_private.deployment_worker_heartbeats`, bound to one exact
deployment identity `deployment_<64 lowercase hex>`, one 40-character lowercase
release tree and one startup UUID. Its primary key is
`(deployment_id, worker_instance_id)`. Millisecond PostgreSQL timestamps require
`last_heartbeat_at >= started_at` and nullable
`stopped_at >= last_heartbeat_at`. The current-row partial index orders
`(deployment_id, release_tree_sha, last_heartbeat_at DESC)` where stopped is
null; retention orders `(last_heartbeat_at, deployment_id,
worker_instance_id)`. The actual production worker alone writes
its heartbeat, and only after live configuration and schema verification have
passed. Timestamps come from the PostgreSQL clock.

The worker refreshes every 10 seconds. Readiness requires a non-stopped row for
the exact configured deployment and release tree whose database age is no more
than 30 seconds. A row for another deployment/tree, a future timestamp, a
stopped row, no row or a row older than 30 seconds is unavailable. Restart uses
a new startup UUID and cannot inherit the previous process's authority.

On graceful shutdown the worker records its stopped marker. A crash naturally
becomes stale. Heartbeat persistence failure stops new command claims; an
already claimed command may finish its bounded persisted outcome, after which
the process exits nonzero. Heartbeat failure must never cause a second external
effect or mark an uncommitted command successful.

The worker performs bounded cleanup using the database clock: rows older than
seven days, at most 100 per attempt. API has read-only heartbeat access. Worker
has only the exact insert/update/own-stop/bounded-delete privileges required;
PUBLIC, API writes and unrelated roles remain denied. This heartbeat is
independent of command-lease renewal.

### Compose and credential-free acceptance

The runtime overlay removes the `runtime-after-027b` block and adds exact
one-shot services `db-role-bootstrap` and `migrator` plus explicit
`service_healthy`/`service_completed_successfully` ordering. Both use the exact
API image on `db_internal`, `restart: "no"`, non-root/read-only/tmpfs/resource
hardening, no host port/socket/egress, and exact entrypoints
`/app/apps/api/dist/db-role-bootstrap.js` and
`/app/apps/api/dist/migrate.js`. PostgreSQL
`pg_isready` remains engine liveness only. API health checking uses `/healthz`;
deployment acceptance requires `/readyz` and may not be inferred from container
state alone. Worker has no public or host port.

The credential-free Docker gate starts no actual live worker and supplies no
dummy verifier key, relayer private key, test adapter or heartbeat sidecar. It
proves role bootstrap, migration concurrency/idempotency, exact schema, API
liveness and readiness transitions using an explicitly controlled test-only SQL
heartbeat fixture. That fixture is not copied into an application image and is
never described as real worker readiness. Static Compose and bootstrap tests
prove that the production worker is ordered after migration and that only its
real startup path owns heartbeat writes. Actual live-worker readiness remains
credential-gated; a future genuine replay-only production mode would require a
new frozen contract.

027B restart tests preserve the named PostgreSQL volume, prove migration
re-entry, fresh/stale/stopped heartbeat transitions and concurrent migration
serialization, then remove only their exact temporary project resources. They
make no registry, provider, DNS, hosted or deployment claim.

## Excluded authority

027C owns WAL archiving, base backup, MinIO and restore into a new PostgreSQL
volume. Disk-capacity monitoring, `pg_dump`, same-volume copy, Droplet snapshot
or skipped restore tests are not 027B readiness or recovery evidence.

028A/028B own frozen OCI release identity and credentialed publication. 029A
owns the credential-free recorded-fixture product matrix. 029B owns production
promotion and canary evidence.

## Consequences

- A legacy version-only database is deliberately rejected rather than silently
  upgraded into false checksum evidence.
- Schema version 10 is the only compatible 027B application schema.
- Role bootstrap, migration and application startup become distinct auditable
  authorities in the exact API image.
- A current worker heartbeat becomes necessary but does not assert verifier,
  RPC or Coston2 upstream availability.
- Credential-free Docker can prove database/API lifecycle truth without
  fabricating a live worker.
- 027B changes persistence and the release path and therefore requires real
  PostgreSQL evidence plus two independent verifiers on one stopped tree.
