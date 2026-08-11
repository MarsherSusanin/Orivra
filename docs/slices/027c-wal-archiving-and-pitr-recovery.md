# Slice 027C — WAL archiving and PITR recovery

## Outcome

Proofline continuously archives encrypted PostgreSQL WAL off-host, creates
regular evidence-bound base backups and proves exact-time recovery into a new
volume against credential-free local MinIO.

Architecture authority:
[ADR 0037](../adr/0037-wal-archiving-and-pitr-recovery.md), refining
[ADR 0029](../adr/0029-digitalocean-vds-deployment.md),
[ADR 0035](../adr/0035-credential-free-container-runtime-boundary.md) and
[ADR 0036](../adr/0036-checksummed-migrations-and-deployment-readiness.md).

Accepted prerequisite: Slice 027B independently passed Core and Product review
on exact commit `527c561ec37b1a6a0b0c45b2c9abe8a41107f1bf` / tree
`ebdf6484b0f9d755dbd55906c3a121fd9f3d2c64`. That is credential-free local
evidence only.

Risk: high release-path, database-role, secret, egress, backup-retention and
recovery change. No public HTTP or Web contract changes.

## Status

Exact production candidate `1218e589517c32af3cc45291d02a8b147b483760` /
tree `f0d6e325702338ed89c57d7160944eef8481f2a8` is rejected by both independent
verifiers. The runtime checks ran, but the positive path never emitted strict
canonical `RestoreDrillEvidenceV1`, promotion negatives used synthetic restore
evidence, and `BackupEvidenceV1.producer` reused one random value as both commit
and tree. Those P1 failures invalidate its local GREEN and security-scan status
as module acceptance evidence.

The later stash candidate `ccccf5d2c2d45415ceb68e6e670a793ee22e0382`
is also rejected after Codex Security scan
`ae807f50-4ceb-4412-94f2-03e8e311bff3`: it consumed mutable shared-worktree
sources after separate Git identity reads, published synthetic backup metadata,
published PASS before negatives/final cleanup, and let draft evidence reach the
promotion authority boundary. Corrective tests/docs-only RED freezes a
private immutable source snapshot, lossless exact WAL-G selected metadata,
terminal three-artifact publication and V2 authorization bound to the actual
handoff and restore. The replacement is now local credential-free
production-author GREEN: focused 53 and static 146 cases, affected coverage,
real PostgreSQL (22 files / 163 tests, zero skip), isolated prefetch, two
offline builds, Docker 027A/027B/027C and the unified author matrix passed with
exact cleanup. Core and Product independently PASS exact commit
`8137970091197160c3d002084a2b778a4d262034` / tree
`8c594cc58820670aba66e7b3cbd6f1f818420a19`.

Codex Security scan 8852 was canceled by the user before final
reportability/severity and is explicitly not a security PASS. Deferred
validation risk `PL-027C-HANDOFF-INVENTORY-DIGEST` / sibling
`C8852-CONTRACTS-002` remains open: a safe no-effect fixture observed
`published=true`, `strictParserRejected=true` and `promotionEffectCount=1`
when terminal handoff backup bytes carried an inventory digest inconsistent
with their entries and a self-consistent triad reached the promotion parser's
injected effect. This is not labeled a vulnerability or severity and is not
claimed fixed. This status is not hosted/VDS or production Spaces evidence,
uses no live Coston2 or deployment credential, and makes no actual RPO/RTO or
SLA claim.

## Delivery split

### 027C1 — contracts, tool identity and configuration

- add strict `BackupEvidenceV1`, `RestoreDrillEvidenceV1`,
  `RecoveryEvidenceHandoffV1` and `RestorePromotionAuthorizationV2` in
  cycle-free pure recovery contracts while retaining V1 authorization only as
  a compatibility data type;
- lock WAL-G v3.0.8 official release asset id `343810769`, exact archive
  `wal-g-pg-22.04-amd64.tar.gz`, size `17,891,961`, archive SHA-256
  `b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9`
  and extracted binary SHA-256
  `f30544c5ce93cf83b87578e3c4a2e9c0e0ffc3d160ef89ecddaf75f397d98deb`;
- lock official PostgreSQL 17.6 Debian, MinIO and MinIO-client index and
  Linux/amd64 manifest digests;
- extend controlled no-auth prefetch and named local build-context handling;
- bind the verified WAL-G descriptor bytes through a private captured context
  and an in-image copied-binary digest check across both offline builds;
- freeze strict Spaces/MinIO configuration and bounded secret-file loading.

The WAL-G URL, size and hashes are frozen exact inputs. Only exact new OCI
digests must be resolved from the controlled upstream during GREEN. RED rejects
missing or placeholder values and does not invent them.

### 027C2 — production archive and backup lifecycle

- build one custom official PostgreSQL image with the verified WAL-G binary;
- enable archive mode, 60-second archive timeout and overwrite prevention;
- add exact system-identifier/slot prefix construction and encrypted WAL push;
- add the dedicated `proofline_backup_login` role without application DML;
- add one-shot base-backup, backup-status and retention services;
- select exactly one WAL-G v3.0.8 `backup-list --detail --json` record through
  lossless raw uint64 parsing and derive backup times, LSNs and WAL segments
  solely from it;
- serialize backup with the fixed advisory lock, retain eight full chains and
  keep application health/readiness unchanged.
- validate strict canonical backup evidence, separate evidence hash, active
  prefix and derived encryption-key identity before destructive retention.

### 027C3 — encrypted MinIO recovery drill

- start private MinIO with separate ephemeral writer/reader/retention users;
- create a completed encrypted base backup and post-backup WAL cut A/target/B;
- remove source authority and fetch the exact backup into a new empty volume;
- recover to an exact UTC timestamp and timeline with inclusive paused action;
- prove schema 10/10 and A-present/B-absent without starting API or worker;
- reject missing/corrupt data, wrong key, future target, reused volume and
  unauthorized promotion;
- execute all eight named negative cases through an import-safe injected core,
  requiring their exact fixed failure codes, zero PASS/promotion effects and
  exact cleanup after each case;
- derive restore-state and cut/inventory evidence only from machine-readable
  `pitr-verify` results, never literal success booleans;
- independently enumerate and download every selected ciphertext object using
  restore-reader authority, then compare its canonical sorted inventory to the
  immutable completed backup evidence;
- require each negative result to bind a real case-scoped child execution and
  independently parent-observed mutation/sink/no-PASS/no-promotion state;
  driver/child-authored observation JSON and local synthetic mutations fail;
- bind those probes to the canonical negative project, exact service,
  container, object target, restore volume and PASS path; positive-project or
  child exit/status/output observations have no authority;
- require the future-target parent sink and zero-promotion probes to observe
  the exact bound negative container exited with a nonzero PostgreSQL process
  status and the exact unavailable-target terminal signature; running recovery
  is explicitly insufficient;
- construct exact credential-free Docker and negative-child environment
  profiles, rejecting ambient Docker endpoint/context/TLS/certificate/auth,
  SSH and BuildKit authority while stripping all other ambient credentials;
- run prepare/execute/parent-inspect and separately bounded cleanup through
  killable async process trees whose timeout settles only after group close
  and reap, with fixed normalized timeout semantics;
- remove temporary secrets in the outermost lifecycle finalizer even when
  project cleanup rejects or times out;
- give prefetch inspect/pull/build children only the exact isolated eight-name
  no-auth environment;
- clean exact project resources.
- stage the canonical backup/restore/handoff triad before negatives, but publish
  it atomically only after all negatives, diagnostics, project/secret/snapshot
  cleanup and final source revalidation succeed.

## Frozen contracts

- WAL-G version is exactly v3.0.8 and its asset is exactly
  `wal-g-pg-22.04-amd64.tar.gz`; Docker builds perform no download.
- Production storage is strict DigitalOcean Spaces HTTPS; QA alone may use the
  exact internal MinIO origin.
- Prefix is constructed as
  `s3://bucket/proofline/v1/<slot>/<systemIdentifier>`.
- `LATEST`, mutable tags, caller-owned prefixes and ETag-as-SHA are forbidden.
- A use-time open-descriptor check, private captured context and in-image hash
  bind the ignored WAL-G input to the frozen binary digest; pathname mode alone
  is insufficient.
- Writer, restore-reader and retention credentials are distinct; client-side
  encryption key is separate from all of them.
- Primary PostgreSQL is the only continuous archive owner and returns archive
  success only after encrypted off-host upload.
- Backup evidence metadata comes from one exact WAL-G v3.0.8
  `backup-list --detail --json` record. Raw uint64 LSN/system-identifier tokens
  are parsed losslessly, the system identifier equals the independent DB
  observation, RFC3339 UTC 0–6 fractional digits normalize to exact
  microseconds, and no wall clock/current LSN/post-cut WAL may substitute them.
- Restore always targets a distinct new volume, remains paused and requires a
  separate evidence-bound promotion authorization.
- `/healthz` and `/readyz` remain byte-identical to ADR 0036.
- Negative child output carries only failed case/code and parent-owned
  exit/output identity; parent probes are the sole mutation, sink, PASS and
  promotion authority.
- Future-target parent evidence requires exact bound `exited` state, nonzero
  PostgreSQL process status and the exact unavailable-target terminal log
  signature; `running` plus `pg_is_in_recovery() = true` cannot satisfy it.
- A canonical SHA-256 probe identity binds all case/project/service/container/
  object/volume/PASS-path fields before execution; any cross-binding fails.
- The case deadline is 30 seconds, child cap 25 seconds, process-tree kill grace
  one second, per-case cleanup deadline 15 seconds and project-finalizer
  deadline 30 seconds. Timeout rejection waits for process-group close/reap.
- Recovery uses only the isolated local-default Docker engine. Prefetch uses
  exactly `PATH`, isolated `DOCKER_CONFIG`/`HOME`/`XDG_CONFIG_HOME`/`TMPDIR`
  and fixed `LANG`/`LC_ALL`/`TZ`; all transport, builder and credential
  authority is absent.
- The positive gate captures one commit, derives `${capturedCommit}^{tree}` and
  materializes a private read-only commit snapshot. Every verified drill input
  comes only from that snapshot; directories are mode 0500, files are 0400,
  symlinks are forbidden and snapshot cleanup precedes publication. Final
  HEAD/tree/clean equality is checked before publication. Dirty author bytes
  use a private captured-copy manifest only as `draft`/`releaseClaim: false`
  and can never be terminally published.
- Positive evidence is atomically published under the caller-owned mode-0700
  output root as exact directory `recovery-evidence.v1` containing only
  `backup-evidence.v1.json`, `restore-drill-evidence.v1.json` and
  `recovery-evidence-handoff.v1.json`, all mode 0600, strict canonical UTF-8
  and parsed by `@proofline/contracts/recovery`.
  The backup has `status: "completed"`; restore has the frozen
  `status: "passed"`, exact source-backup digest and only actual-derived paused,
  recovery, target, inventory, system, migration and volume evidence.
- A successful handoff is preserved for the caller and removed only through an
  explicit exact-scoped cleanup operation. Failed publication removes its
  private staging directory and leaves neither final artifact nor unrelated
  caller files. Promotion negatives consume the staged canonical triad and
  vary only V2 authorization. V1-only, draft and synthetic handoffs cannot
  authorize promotion, and no automatic valid promotion is allowed.

## Exact operational inputs

Secret-file inputs:

- `PROOFLINE_BACKUP_DATABASE_URL_FILE`;
- `PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE`;
- `PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE`;
- `PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE`;
- `PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE`;
- `PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE`;
- `PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE`;
- `PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE`.

Nonsecret production inputs are exact backup slot, endpoint, region and bucket.
Restore additionally requires exact backup ID, backup-evidence SHA-256, target
UTC time and numeric timeline. Direct values and files are XOR; file reads are
non-following, nonblocking, regular, nonempty and bounded.

## Intentional RED surfaces

1. pure strict recovery schemas, canonical serialization/checksum, no extra
   keys and immutable defensive output;
2. real digest/asset locks, controlled credential-isolated prefetch and two
   offline named-context builds, including same-owner replacement, symlink,
   type, exact mode/size/digest and copied-byte identity negatives;
3. strict endpoint/bucket/slot/target/prefix configuration, secret redaction
   and ambient AWS rejection;
4. exact backup login properties, grants and denials under real PostgreSQL;
5. production Compose services, image, archive settings, egress/secrets,
   fixed wrapper, advisory lock and strict canonical evidence/hash/prefix/key
   authorization before eight-full retention;
6. MinIO identities, exact backup selection, new-volume paused restore,
   immutable evidence, independent downloaded ciphertext inventory and
   promotion authorization;
7. executable missing/corrupt-object, wrong-key, future-target,
   reused/nonempty-volume and absent/mismatched-promotion controls with exact
   real child output, independent parent probes, fixed failure codes, zero
   PASS/promotion effects, forged-observation and cross-project binding
   rejection, close/reap-gated async process-tree timeout, separately bounded
   cleanup and unconditional temporary-secret removal;
8. executable static seams plus one checked-in `test:docker:recovery` gate.

## GREEN and verification gates

- `npm run typecheck` and focused recovery/API/deployment tests;
- contracts recovery coverage at 100% statements, branches, functions and
  lines; affected API at least 90% lines and 85% branches;
- real PostgreSQL role/grant tests with zero skip;
- source/static Compose and wrapper tests;
- one controlled credential-free prefetch, then two offline/no-pull builds;
- existing 027A/027B Docker regressions plus `npm run test:docker:recovery`;
- exact project/container/network/volume/secret/temp cleanup;
- `npm run build` and `npm run test:sites` with protected artifacts intact;
- two independent reviews of one stopped module tree.

The unified repository matrix still runs once only at 029A.

## Exclusions

No production Spaces credential, hosted backup, VDS restore, actual RPO/RTO,
live worker, DNS/SSH/GHCR action or production promotion is part of 027C.
Droplet backups, `pg_dump`, same-volume copies, Redis and Helm remain excluded.
