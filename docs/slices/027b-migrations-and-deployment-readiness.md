# Slice 027B — checksummed migrations and deployment readiness

## Outcome

Proofline gains a one-shot immutable migration path, least-privilege deployment
roles, separate process liveness and application readiness, and a persisted
worker heartbeat. The credential-free Docker gate proves PostgreSQL/API
lifecycle without pretending that a SQL fixture is a live Coston2 worker.

Architecture authority:
[ADR 0036](../adr/0036-checksummed-migrations-and-deployment-readiness.md),
refining [ADR 0029](../adr/0029-digitalocean-vds-deployment.md) and
[ADR 0035](../adr/0035-credential-free-container-runtime-boundary.md).

Risk: high persistence, database-role, startup-order and release-path change;
no provider credential, live Coston2 effect, backup, restore or hosted claim.

Implementation status: corrective RED is frozen after both independent
verifiers rejected production-author candidate
`4ac66f9693d1b8ae16a01d839923cdcdfad044eb` / tree
`477f67988e63645da32c4a98fc307302a872d19b`. That candidate inserted a current
heartbeat before late live-worker composition could fail, creating temporary
false readiness. A corrected candidate and two new independent PASS reports are
required. The test-only SQL heartbeat fixture is not actual worker readiness or
deployment evidence.

## Delivery split

### 027B1 — migration and role authority

- strict `manifest.v1.json` binds ordered raw migration bytes and schema
  compatibility `[10,10]`;
- one runner-owned transaction operates under the fixed session advisory lock,
  60-second statement timeout and exact result verification;
- `010_deployment_lifecycle.sql` adds immutable checksum history and
  deployment-heartbeat state;
- legacy version-only 1–9 history fails closed rather than being adopted;
- separate exact-API-image role bootstrap and migration jobs create only the
  minimum deployment login/group ownership boundary.

### 027B2 — health, readiness and worker heartbeat

- `/healthz` is anonymous process-only liveness with no dependency I/O;
- API verifies schema before listen; `/readyz` verifies database, exact schema
  authority and the current deployment/tree heartbeat;
- actual production worker validates live config and schema before its first
  heartbeat or claim;
- worker construction validates the repository, relayer policy and live
  pipeline before lifecycle coordination and the first heartbeat insert;
- heartbeat uses PostgreSQL time, 10-second refresh, 30-second staleness,
  startup UUID and explicit stopped state;
- heartbeat loss stops new claims and leads to nonzero exit after any current
  bounded command outcome;
- cleanup removes at most 100 rows older than seven days.

### 027B3 — Compose and real lifecycle evidence

- PostgreSQL engine health gates role bootstrap; successful bootstrap gates
  migration; successful migration gates API and worker;
- the 027A runtime profile block is removed without publishing a new port;
- two concurrent migrators serialize, restart against the same PostgreSQL
  volume is byte/history-idempotent, and API readiness transitions are observed
  through Caddy;
- credential-free Docker uses an explicit test-only SQL heartbeat fixture and
  never starts or claims readiness for the live worker;
- static/real-PostgreSQL tests prove the real worker wiring separately.

## Frozen trust boundaries

- Migration input is only the checked-in strict manifest plus exact local raw
  files from the API image. No network, alternate path, glob authority or
  mutable tag is accepted.
- Existing migration bytes are immutable. The runner strips only the exact
  outer transaction wrapper and owns the enclosing transaction and ledger row.
- Role passwords are bind parameters loaded from bounded secret files and are
  absent from Compose environment, SQL strings, logs and errors.
- API/worker startup performs no implicit migration.
- API never writes the worker heartbeat; worker never gains API token or
  migration-history authority.
- A stale/missing/stopped/wrong-release heartbeat makes readiness unavailable
  while liveness remains process-only.
- Command-lease renewal and deployment heartbeat are separate tables and
  separate meanings.

## Frozen RED surfaces

The Contract/Test Designer freezes, before production implementation:

1. manifest and runner unit contracts for strict parsing, raw-byte hashes,
   wrapper grammar, pre-DB rejection, transaction/lock/unlock ordering,
   rollback, concurrency and fixed public failures;
2. migration 010 static and real-PostgreSQL contracts for immutable history,
   roles, heartbeat constraints, least privilege and bounded retention;
3. API contracts for exact `/healthz` and `/readyz` grammar, dependency calls,
   response redaction and schema-before-listen startup;
4. worker contracts for config/schema/heartbeat/claim order, refresh/stopped/
   failure behavior and new-startup identity;
5. rendered Compose/image contracts for exact one-shot services, secrets,
   start order, no host ports and removal of the 027A profile block;
6. a bounded credential-free Docker lifecycle contract for fresh migration,
   concurrent re-entry, restart/persistence and controlled readiness
   transitions, explicitly excluding actual worker readiness.

Real PostgreSQL cases remain gated by `PROOFLINE_TESTCONTAINERS=1` during RED;
a skipped suite is not acceptance evidence.

## Compatibility and exclusions

- Accepted migrations 001–009 and their exact bytes remain unchanged.
- Existing API routes, Caddy strip-once behavior, Web/Sites artifacts and worker
  command/recovery contracts remain unchanged.
- 027A's historical tests that asserted the deliberate absence of 027B
  authority must be replaced by exact 027B contracts, not weakened into broad
  regex acceptance.
- No Redis, Helm, Docker socket, host network, public database/API/worker port,
  dummy production credential or production-importable test adapter is added.
- 027C PITR/MinIO/WAL, 028 release publication and 029 product/deployment gates
  remain excluded.

## GREEN and verification gates

- `npm run typecheck`;
- focused 027B plus nearest API/worker/PostgreSQL/027A deployment tests;
- contracts/domain 100% only if a public package contract is added;
- affected backend coverage at least 90% lines and 85% branches;
- `PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1` with zero
  skipped 027B cases;
- source-only deployment/static tests, then the bounded credential-free Docker
  lifecycle gate with no pull/network;
- `npm run build` and `npm run test:sites` with protected Sites artifacts intact;
- two independent PASS reports on one exact stopped commit/tree.

These gates do not claim hosted, deployed, backup, restore or live Coston2
evidence.
