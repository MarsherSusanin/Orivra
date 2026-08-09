# Slice 025 RED — static template catalog and template-led Composer

Date: 2026-08-10 (Asia/Vladivostok)

Role: Slice Architect and Contract & Test Designer

Starting commit: `d9f6c56abadd21286b3110df5f16fce9621ca500`

Starting tree: `801ef50411febfc762725427e8bad1f422ac1ad2`

Architecture decision: [ADR 0033](../adr/0033-static-template-catalog-boundary.md)

Slice contract: [025](../slices/025-template-led-composer.md)

## Scope assertion

This wave changes tests, test fixtures and canonical documentation only. It
adds no production schema/catalog/resolver, package dependency, SQL migration,
API route, Web component/style, worker behavior, Docker behavior, credential or
external-network effect. The accepted Slice 015 Composer manifest remains the
run authority and protected Sites packaging files remain unchanged.

The RED contract is split into 025A pure contracts/catalog resolution, 025B
anonymous deterministic API representations and 025C gallery/detail/Composer
selection. The catalog is static and credential-free. Its Open-Meteo manifest
is derived from the provider's documented request contract, but neither the
focused tests nor their fixtures contact Open-Meteo or Coinbase.

## Frozen RED matrix

The focused contract files cover:

- strict bounded catalog, summary, detail and provenance V1 schemas;
- pure feature subpaths with root identity re-exports, effect-free package
  metadata and zero emitted worker bytes from both template leaves;
- exact immutable catalog order, canonical manifest JSON and fixed SHA-256
  bindings for featured Open-Meteo Berlin temperature and preserved `eth-usd`;
- reparsing with `Web2JsonManifestV1`, defensive immutable snapshots and
  rejection of mixed summary, detail, provenance, ID, revision, path, manifest
  and digest values;
- exact anonymous `GET /v1/templates` and `GET /v1/templates/:id` before
  bearer parsing, with no query/latest/alias/revisioned route or service call;
- canonical response bytes, representation-derived strong ETags, exact 304,
  short public revalidation, exact-origin CORS and bounded no-store errors;
- a strict same-origin browser client with no bearer/body/provider fetch;
- token-free gallery/detail routes and canonical revision-bearing Composer URL;
- preserved legacy `eth-usd` deep-link compatibility, strict requested revision
  agreement and no sample/static Web fallback;
- saved-draft precedence, byte-identical cancel, explicit destructive
  confirmation, fresh idempotency on replacement and exact manifest submission;
- provider-host containment across render, hover, focus, review, replacement,
  edits, reload and history navigation;
- generic Sites deep-route compatibility with `/api` still fail closed.

## Focused evidence

```text
npm run typecheck
PASS

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

EXPECTED RED — 11 files: 10 failed, 1 passed; 100 failed, 55 passed, 155 total
```

The 100 intentional failures are exact:

- contracts: 20 missing strict public-schema and feature-entry cases;
- domain: 21 missing exact static catalog/resolution cases;
- API: 24 missing public dispatch, representation and containment cases;
- browser client: 15 missing same-origin strict-client cases;
- new Web product surface: 14 missing gallery/detail/Composer cases;
- worker/package purity: 2 missing template feature-boundary cases;
- accepted surface compatibility: 4 changed expectations for the gallery
  entry, canonical legacy revision, revision preservation and explicit saved-
  draft replacement.

The 55 passing controls comprise one existing global OPTIONS behavior, ten
worker/package purity controls and 44 unchanged accepted Web/Composer
behaviors. The five Sites controls pass separately. Missing modules are
asserted before negative validation tables, so absence cannot masquerade as
successful strict rejection. Existing non-fatal React `act` warnings in
accepted controls do not change the result and are not counted as new contract
evidence.

The nearest unchanged affected baseline is PASS:

```text
npx vitest run \
  packages/contracts/test/public-contracts.test.ts \
  packages/domain/test/manifest-composer.test.ts \
  packages/domain/test/manifest-composer-finalization.contract.test.ts \
  apps/api/test/slice022-network-capability.contract.test.ts \
  apps/api/test/api-contract.test.ts \
  src/product-entry-accessibility.contract.test.tsx

PASS — 6 files, 100 tests

node --test tests/slice025-template-deep-route.contract.test.mjs
PASS — 5 tests
```

The Sites result is a compatibility control for the existing generic SPA
fallback and fail-closed `/api` behavior. It is not a substitute for GREEN
gallery/detail implementation or the later production build and Sites gate.

No coverage, browser, build, Docker, broad/full, hosted, provider-network or
live Coston2 matrix is claimed by this intentional RED wave. GREEN must run the
slice coverage, black-box browser, production build and Sites acceptance gates
frozen by ADR 0033 and the Slice 025 contract.
