# Slice 024B RED — persisted public canonical URL attack demo

Date: 2026-08-10 (Asia/Vladivostok)

Role: Slice Architect and Contract & Test Designer

Starting commit: `cdeef530e7fe18549fb21d9d5d133c1146639c7d`

Starting tree: `82ff4b3fa6ff3c079c50c03240f7c610d1295097`

Architecture decision: [ADR 0032](../adr/0032-persisted-public-canonical-url-attack-demo.md)

Slice contract: [024B](../slices/024b-persisted-public-canonical-url-attack-demo.md)

## Scope assertion

This wave adds tests, test fixtures and documentation only. It adds no schema,
domain implementation, migration, importer, package dependency/script, API
route/cache, Web component/style, worker behavior, Docker behavior or
credential. Accepted 024A production code, Solidity, Sites packaging and
protected Sites files remain unchanged.

024B is frozen as B1 summary/persistence/import, B2 exact API selection/cache,
and B3 Web/Sites presentation. Pure 024A replay remains byte-integrity only;
the concrete FDC source/compiler/EVM runtime is the sole import authority.

## Frozen RED matrix

The focused contract files cover:

- strict public summary shape and pure redacted deterministic derivation;
- absence of raw bundle, source, standard JSON, bytecode, calldata, results and
  secrets from the summary;
- one-shot exact-file import, runtime verification before PostgreSQL,
  checksum-bound authority, fixed advisory lock, exact Buffer persistence,
  byte-identical conflict and no fallback/network/token path;
- additive migration 009 shape, bounds, append-only triggers and importer/API/
  worker/PUBLIC grants;
- real PostgreSQL row constraints, immutable operations, exact-byte conflict,
  grants and serialized import contract (gated by Testcontainers);
- exact environment digest selection, absent/no-query and malformed/fatal
  behavior, one-load lightweight canonical/digest/metadata cache and no
  compiler/EVM in ordinary startup;
- anonymous exact summary/download GET, bearer independence, no query,
  deterministic method rejection, representation-correct ETag/304, cache,
  exact-origin CORS, exact download headers/bytes and uniform unavailable 503;
- token/wallet-free `/demo/canonical-url`, one summary request, no recording
  preload/external source fetch/fallback, available/unavailable truth,
  user-initiated download, accessibility, mobile contract and history;
- Sites generic deep route with unchanged `/api` fail-closed behavior.

## First focused evidence

```text
npm run typecheck
PASS

npx vitest run \
  packages/contracts/test/slice024b-canonical-url-attack-demo-summary.contract.test.ts \
  packages/domain/test/slice024b-canonical-url-attack-demo-summary.contract.test.ts \
  apps/api/test/slice024b-recording-importer.contract.test.ts \
  apps/api/test/postgres/slice024b-recording-migration.contract.test.ts \
  apps/api/test/slice024b-demo-startup-cache.contract.test.ts \
  apps/api/test/slice024b-public-demo-api.contract.test.ts \
  src/services/slice024b-canonical-url-attack-demo-client.contract.test.ts \
  src/slice024b-canonical-url-attack-demo.contract.test.tsx

EXPECTED RED — 8 files failed; 77 failed, 1 passed, 7 skipped, 85 total
```

The 77 intentional failures are exact:

- contracts: 13 missing strict summary-schema cases;
- domain: 6 missing pure summary-derivation cases;
- importer: 8 missing separate concrete-runtime import cases;
- migration: 5 missing static migration-009 cases;
- startup/cache: 13 missing selector/load/authority-validation cases;
- anonymous API: 17 missing route/header/CORS/cache/error cases;
- browser client: 7 missing same-origin strict-client cases;
- Web: 8 missing available/unavailable/history/responsive/a11y cases.

The one passing control confirms that accepted ordinary API app/bootstrap
source does not currently import FDC compiler/EVM authority. The seven real
PostgreSQL cases are intentionally gated by
`PROOFLINE_TESTCONTAINERS=1`; their skip is not a PASS and GREEN must run them
with `--maxWorkers=1`. No table-driven negative case passes merely because an
absent export throws: a missing boundary fails the case before its rejection
expectation can succeed.

The nearest unchanged affected baseline is PASS:

```text
npx vitest run \
  packages/contracts/test/public-contracts.test.ts \
  packages/domain/test/bundle-replay.test.ts \
  apps/api/test/api-contract.test.ts \
  apps/api/test/bootstrap-coverage.test.ts \
  src/product-entry.contract.test.tsx \
  src/product-entry-accessibility.contract.test.tsx

PASS — 6 files, 107 tests

node --test tests/slice024b-sites-deep-route.contract.test.mjs
PASS — 1 test
```

The Sites test is a compatibility control: the existing generic SPA fallback
already serves the new deep route while `/api` remains fail closed. It is not a
substitute for the 024B3 Web route or later built Sites gate.

The accepted comprehensive Testcontainers migration inventory and the 023D1
quota suite are also frozen to expect exact migration 009 after 008. Their
gated cases remain deferred to GREEN; the production author does not need to
edit earlier tests to admit the new schema version.

No broad, full, Docker, hosted or live matrix is run in this RED wave.
