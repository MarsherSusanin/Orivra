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

## Delivery split

### 027C1 — contracts, tool identity and configuration

- add strict `BackupEvidenceV1`, `RestoreDrillEvidenceV1` and
  `RestorePromotionAuthorizationV1` in cycle-free pure recovery contracts;
- lock WAL-G v3.0.8 official archive and binary SHA-256;
- lock official PostgreSQL 17.6 Debian, MinIO and MinIO-client index and
  Linux/amd64 manifest digests;
- extend controlled no-auth prefetch and named local build-context handling;
- freeze strict Spaces/MinIO configuration and bounded secret-file loading.

Exact new hashes/digests must be resolved from the controlled upstream during
GREEN. RED rejects missing or placeholder values and does not invent them.

### 027C2 — production archive and backup lifecycle

- build one custom official PostgreSQL image with the verified WAL-G binary;
- enable archive mode, 60-second archive timeout and overwrite prevention;
- add exact system-identifier/slot prefix construction and encrypted WAL push;
- add the dedicated `proofline_backup_login` role without application DML;
- add one-shot base-backup, backup-status and retention services;
- serialize backup with the fixed advisory lock, retain eight full chains and
  keep application health/readiness unchanged.

### 027C3 — encrypted MinIO recovery drill

- start private MinIO with separate ephemeral writer/reader/retention users;
- create a completed encrypted base backup and post-backup WAL cut A/target/B;
- remove source authority and fetch the exact backup into a new empty volume;
- recover to an exact UTC timestamp and timeline with inclusive paused action;
- prove schema 10/10 and A-present/B-absent without starting API or worker;
- reject missing/corrupt data, wrong key, future target, reused volume and
  unauthorized promotion;
- clean exact project resources.

## Frozen contracts

- WAL-G version is exactly v3.0.8; Docker builds perform no download.
- Production storage is strict DigitalOcean Spaces HTTPS; QA alone may use the
  exact internal MinIO origin.
- Prefix is constructed as
  `s3://bucket/proofline/v1/<slot>/<systemIdentifier>`.
- `LATEST`, mutable tags, caller-owned prefixes and ETag-as-SHA are forbidden.
- Writer, restore-reader and retention credentials are distinct; client-side
  encryption key is separate from all of them.
- Primary PostgreSQL is the only continuous archive owner and returns archive
  success only after encrypted off-host upload.
- Restore always targets a distinct new volume, remains paused and requires a
  separate evidence-bound promotion authorization.
- `/healthz` and `/readyz` remain byte-identical to ADR 0036.

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
   offline named-context builds;
3. strict endpoint/bucket/slot/target/prefix configuration, secret redaction
   and ambient AWS rejection;
4. exact backup login properties, grants and denials under real PostgreSQL;
5. production Compose services, image, archive settings, egress/secrets,
   fixed wrapper, advisory lock and eight-full retention;
6. MinIO identities, exact backup selection, new-volume paused restore,
   immutable evidence and promotion authorization;
7. corruption, missing-WAL, wrong-key, future-target and cleanup negatives;
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
