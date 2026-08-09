# Slice 025 GREEN — static catalog and template-led Composer

Status: Production-author candidate; independent Core and Product verification
pending.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Production implementer

Final corrective RED commit: `b299cf9b1c44461155b5b0eb8633bfba80fcd5bc`

Final corrective RED tree: `25152cab7a0abefdd8b45d0d2ea11e4a39512c9b`

Architecture decision: [ADR 0033](../adr/0033-static-template-catalog-boundary.md)

Slice contract: [025](../slices/025-template-led-composer.md)

## Implementation

Contracts now own cycle-free manifest, validation and template feature leaves.
The strict template summary/catalog/detail/provenance contracts are available
through `@proofline/contracts/templates`; manifest schemas and public URL/ABI
helpers are available through `@proofline/contracts/manifest`. Root exports are
the same runtime identities and both pure packages retain `sideEffects:false`.

The pure domain catalog contains exactly immutable revision `1` of featured
Open-Meteo Berlin temperature followed by the preserved `eth-usd` Coinbase
template. Resolution reparses the strict manifest, checks canonical JSON and
recomputes the SHA-256 binding before returning a defensive snapshot. The
legacy `createEthUsdComposerDraft` delegates to this one catalog and preserves
caller-owned timestamps and idempotency keys without a second manifest literal.

API composition precomputes the two canonical public representations and
response-byte ETags. Anonymous exact no-query routes precede bearer parsing,
reuse the configured exact-origin CORS boundary and invoke no API service,
database, worker, verifier, RPC or source-host port.

Web provides same-origin gallery, detail and Composer selection. A resolved
template becomes an editable authoritative draft; another selection remains
pending until explicit replacement. Selection identity is exactly
`{id, revision}`, so step-only Back/Forward preserves draft and storage bytes
without refetch or destructive review. Confirmed replacement installs a fresh
idempotency key and clears pending create, submission, validation, trust and
focus state. Review is disabled while authenticated create is in flight. Its
modal starts on the safe keep action, wraps Tab/Shift+Tab, supports Escape and
restores focus to the Review opener.

## Semantic and coverage evidence

```sh
npm run typecheck
npx vitest run \
  packages/contracts/test/slice025-template-catalog.contract.test.ts \
  packages/domain/test/slice025-template-catalog-resolver.contract.test.ts \
  apps/api/test/slice025-public-template-api.contract.test.ts \
  src/services/slice025-template-catalog-client.contract.test.ts \
  src/slice025-template-gallery-composer.contract.test.tsx \
  apps/worker/test/slice009-production-worker-purity.contract.test.ts \
  src/slice014-stage-url.contract.test.tsx \
  src/slice015a-source-trust.contract.test.tsx \
  src/slice015a-manifest-import.contract.test.tsx \
  src/slice015b-transform-draft.contract.test.tsx \
  src/product-entry.states.test.tsx
npx vitest run \
  packages/contracts/test/public-contracts.test.ts \
  packages/contracts/test/composer-draft.contract.test.ts \
  packages/domain/test/manifest-composer.test.ts \
  packages/domain/test/manifest-composer-finalization.contract.test.ts \
  apps/api/test/slice022-network-capability.contract.test.ts \
  apps/api/test/api-contract.test.ts \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/live-runtime-adapter.contract.test.ts \
  src/composer-journey.contract.test.tsx \
  src/slice023c2b2-wallet-product-journey.contract.test.tsx \
  src/App.surface-contract.test.tsx \
  src/product-entry-accessibility.contract.test.tsx
npm run test:core:coverage
npm run test:coverage:backend
npm run test:coverage:web
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

- Typecheck is PASS.
- Expanded Slice 025 matrix: 11 files and 163 tests PASS.
- Final corrected Composer component matrix: 19/19 PASS, including exact-byte
  same-selection history, distinct pending selection, auth-intent invalidation,
  in-flight refusal and modal keyboard/focus cases.
- Nearest contracts, Composer/domain, API, worker and accepted Web regression:
  12 files and 145 tests PASS.
- Contracts/domain: 44 files and 520 tests PASS at 100% statements, branches,
  functions and lines.
- Backend: 107 files and 1035 tests PASS; overall 92.19% lines and 87.25%
  branches, with API at 90.87% lines and 86.07% branches. The 37 PostgreSQL
  cases skipped by this coverage configuration are not integration evidence.
- Web: 67 files and 561 tests PASS at 92.69% lines and 85.99% branches. React
  components are 89.27% lines and 81.47% branches; `ManifestComposer` is
  93.58% lines and 81.79% branches.
- Real Testcontainers PostgreSQL: 20 files and 151 tests PASS with zero skips.

## Build, package and Sites evidence

The fresh worker package/metafile purity gate is 14/14 PASS. It retains the
required manifest runtime contribution while both template feature leaves
contribute zero output bytes. Root Web/Sites, API and worker builds PASS. The
known Vite large-chunk warning is unchanged and is not a failed gate.

Sites compatibility is 28/28 PASS and emits `dist/client/index.html`,
`dist/server/index.js` and `dist/.openai/hosting.json`. Protected Sites files
are unchanged. Because public contracts/domain code changed, the checked-in
Node 20 Action artifact was regenerated. Clean byte sync, executable artifact
and production-surface controls are 3 files and 9 tests PASS.

## Browser acceptance

The locally built credential-free product was inspected at desktop
`1488x1058` and mobile `390x844`. Gallery, immutable detail, Composer and
standalone unavailable states were visually accepted. The detail displayed the
exact provider, revision and manifest digest, and both cards produced the
canonical revision-bearing Composer URL.

An edited Open-Meteo draft traversed Source to Transform, Back and Forward with
the same selection: the exact edited value survived and Review replacement was
absent on both history states. A different template entered pending review.
Opening the modal focused Keep; Shift+Tab wrapped to Replace, Tab wrapped to
Keep, Escape preserved the draft and restored Review focus. A signed-out
pending create was invalidated by confirmed replacement and later local QA
authentication made zero create calls. An authenticated pending create made
one call, disabled Review until deterministic failure, then allowed replacement
and cleared the old submission error.

An axe run scoped to the production Composer main reported zero
serious/critical findings. No application-origin console warning or error was
recorded; the observed warnings belonged only to an installed browser
extension. The complete local server ledger contained only local static assets
and same-origin `/api/v1/templates*` requests, with no Coinbase, Open-Meteo,
RPC, compiler, verifier or other provider request.

The Browser evaluation surface did not expose `performance` resource entries,
so network containment relies on that complete local request ledger plus the
frozen deterministic client/component tests. No production change was made for
this Browser limitation. Temporary QA files and both local servers were removed
after acceptance.

No source response, provider fetch, credential, PostgreSQL schema change,
Redis, Docker change, external network, live Coston2, hosted Sites or
DigitalOcean deployment is claimed. The deployment truth remains ADR 0029:
DigitalOcean VDS/Droplet with Docker Compose is selected but not provisioned or
deployed. This production author cannot serve as either independent verifier.
