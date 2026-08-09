# Slice 023D1 — Persisted API admission quotas

## Outcome and exclusions

Proofline bounds wallet challenge creation, daily project run creation and
active nonterminal wallet/relayer runs with restart-safe PostgreSQL admission.
Users receive sanitized, bounded retry evidence without counter or identity
leakage. Same-intent create retries remain free idempotent replay.

This module does not change success schemas, append-only run semantics, worker
effects, relayer policy, account retention, Docker/VDS deployment, Sites or the
Node pre-buffer 8 KiB boundary. Stream hardening is Slice 023D2.

## Contracts and ADR impact

- ADR 0030 defines defaults, environment bounds, database clock authority,
  subject digests, transaction order, cleanup and HTTP/client behavior.
- Migration 008 is additive and grants the API minimum quota/cleanup access;
  the worker receives none.
- Existing ErrorV1 JSON stays unchanged. New normalized outcomes are private
  `429 WALLET_CHALLENGE_RATE_LIMITED`, public authenticated
  `429 PROJECT_RUN_QUOTA_EXHAUSTED` and
  `409 ACTIVE_LIVE_RUN_LIMIT_REACHED`.
- Allowed-origin quota responses expose the bounded `Retry-After` header. No
  wildcard or credentialed CORS is introduced.

Security and migration risk are high: the slice changes authentication
admission, run idempotency ordering, PostgreSQL privileges and concurrent
project admission. No credential or external network access is required.

## Frozen RED

Intentional RED contracts cover:

1. pure bounded environment parsing and invalid-composition refusal;
2. migration 008 structure, constraints, indexes, version and least privilege;
3. transaction-scoped challenge address/global admission from one database
   clock, frozen first-row limits and atomic rollback;
4. create-run replay before quota, project advisory locking, daily quota,
   persisted UTC-day `active_live` policy, active live cap and replay
   exclusion;
5. exact 429/409 API mapping, bounded Retry-After and exact-origin CORS;
6. wallet/run client allowlists, fixed copy and hostile-header/message
   suppression;
7. bounded cleanup which preserves all current and unrelated evidence;
8. real PostgreSQL restart, skew, concurrency, project isolation and rollback.

Expected RED is the absent migration 008 and absent quota/configuration/API and
client behavior. Existing wallet auth, create-run idempotency, CORS, run client
and migration baselines must remain GREEN.

## Acceptance gates

RED records the new focused failures plus nearest unchanged baselines. GREEN
requires focused API and Web suites, `npm run typecheck`, API/adapters at least
90% lines and 85% branches, React at least 85% lines and 80% branches, and the
mandatory real-PostgreSQL command:

```sh
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

The PostgreSQL suite must report zero skipped quota cases. This is a module
gate, not the unified 022–029A candidate matrix and not hosted/deployed
evidence.

Core verification reviews SQL atomics, database clock use, digest separation,
idempotency, rollback, concurrency, privilege and leakage. Product integration
verification reviews HTTP/CORS, wallet/run client retry evidence and unchanged
ordinary create/sign-in behavior on the same recorded tree.

## Implementation status

Production GREEN is implemented by migration 008, fail-fast quota composition,
transactional wallet/run admission, bounded cleanup, exact HTTP/CORS mapping and
sanitized Web clients. Author evidence is recorded in
[`../evidence/slice-023d1-green-persisted-api-admission-quotas.md`](../evidence/slice-023d1-green-persisted-api-admission-quotas.md).
This status is module evidence only; two independent verifiers must still PASS
the exact committed tree before the module is accepted.
