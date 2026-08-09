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

## Corrective package-boundary RED

A post-freeze architecture review found two package-boundary regressions before
GREEN acceptance. The frozen correction requires:

- `createEthUsdComposerDraft` to delegate to canonical `eth-usd` catalog
  resolution without retaining a second Coinbase URL, JQ, ABI or manifest
  literal, while preserving exact draft fields and caller-owned freshness;
- cycle-free `@proofline/contracts/manifest` ownership with root identity
  re-exports, contracts templates importing the relative manifest feature, and
  domain templates importing only the contracts template/manifest features;
- a fresh worker metafile to retain required manifest runtime bytes while both
  template leaves contribute zero bytes.

The earlier 100 RED / 55 PASS result above remains the exact first Slice 025
freeze and is not rewritten.

```text
npm run typecheck
PASS

npx vitest run \
  packages/domain/test/slice025-template-catalog-resolver.contract.test.ts \
  apps/worker/test/slice009-production-worker-purity.contract.test.ts

EXPECTED RED — 2 files failed; 27 failed, 9 passed, 36 total
```

The domain suite has 22 intentional failures: the original 21 absent catalog
and resolver contracts plus the new source-level delegation boundary. The
worker/package suite has five intentional failures and nine controls: the
original absent template metadata/feature entry, absent manifest feature
identity, absent cycle-free feature sources, and zero manifest feature bytes in
the fresh worker metafile. The failures are semantic boundary evidence; the
new source probes guard missing files before reading them.

The nearest unchanged affected baseline is PASS:

```text
npx vitest run \
  packages/contracts/test/public-contracts.test.ts \
  packages/contracts/test/composer-draft.contract.test.ts \
  packages/domain/test/manifest-composer.test.ts \
  packages/domain/test/manifest-composer-finalization.contract.test.ts \
  apps/worker/test/production-bootstrap.contract.test.ts \
  apps/worker/test/live-runtime-adapter.contract.test.ts

PASS — 6 files, 99 tests
```

No production, package metadata, dependency or generated artifact is changed
by this corrective RED wave. No broad/full, coverage, build, Docker, provider,
hosted or live matrix is claimed.

## Corrective Composer-authority RED

A second review examined uncommitted GREEN work based on accepted corrective
RED commit `5291467b28510c1ec9120ad5714818ae40eda715`, tree
`b36b7e30870b20c341b13eacc1879f53e6c053c1`. The rejected pre-candidate WIP was
stashed as `6a7f8855efa5121811daa364cc67d02196280644`, tree
`6562ce85b835d690bdb8529d038cfa9c921bb03b`. It was not a frozen candidate,
accepted GREEN commit or verification PASS.

The review found three P1 authority/accessibility gaps and froze four component
cases:

- once template A has been applied, edited and persisted, a later valid
  popstate selection of B preserves A byte-for-byte and enters pending
  replacement; a stale response may auto-apply only while no authoritative
  current or persisted draft exists;
- confirmed replacement clears a signed-out pending create intent, old manifest
  and idempotency key, submission error and validation/trust state before later
  authentication can resume creation;
- Review replacement is disabled and cannot mutate/open the dialog while an
  authenticated create is in flight, then is available after a failed request
  settles;
- the modal initially focuses the safe keep action, traps Tab and Shift+Tab,
  Escape preserves draft and pending selection, and focus returns to its Review
  replacement opener.

```text
npm run typecheck
PASS

npx vitest run \
  src/slice025-template-gallery-composer.contract.test.tsx

EXPECTED RED — 1 file failed; 18 failed, 18 total
```

The count is the original 14 absent 025C surface contracts plus four new
corrective authority/focus cases. The new cases compile and reach the same
absent frozen surface on the clean RED base; there is no new harness exception,
unexpected PASS or production fallback.

The nearest unchanged Composer, pending-authentication and dialog controls are
PASS:

```text
npx vitest run \
  src/composer-journey.contract.test.tsx \
  src/slice023c2b2-wallet-product-journey.contract.test.tsx \
  src/App.surface-contract.test.tsx \
  src/product-entry-accessibility.contract.test.tsx

PASS — 4 files, 15 tests
```

One accepted accessibility control emits its pre-existing non-fatal React
`act` warning. It does not change the PASS or constitute new product evidence.
No production, dependency, package metadata, style or generated artifact is
changed; no broad/full, coverage, build, browser, Docker, provider, hosted or
live matrix is claimed.
