# Slice 026 GREEN — public product surface

Status: Production-author candidate; independent Core and Product verification
pending.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Production implementer

Corrected RED commit: `477372465789ea17a180971ee35f99826c07c326`

Corrected RED tree: `f22425e21d14fd3b585495892fb8c125b912d840`

Architecture decision: [ADR 0034](../adr/0034-public-landing-and-onboarding-boundary.md)

Slice contract: [026](../slices/026-public-product-surface.md)

## Implementation

Exact `/` now composes a credential-free public shell before any private
wallet/session composition. Search and fragment input is synchronously removed
before the two public clients start. Unknown routes render the bounded honest
unavailable state without public or private reads, while explicit injected
`runId` and the accepted Runs, Settings, template and exact demo routes retain
their prior authority and behavior.

Landing starts one strict catalog-summary read and one strict persisted-demo
summary read independently. App-owned request references deduplicate landing
remounts during same-App navigation. Each region owns loading, ready and neutral
unavailable state. The featured card and encoded Composer path reuse the
existing template catalog presentation; landing contains no second manifest,
provider literal, detail/download request, wallet, run port or analytics event.

The API now merges exactly one `Origin` token into every cacheable static
template catalog/detail 200 or 304 response when a Web origin is configured.
Absent and hostile request origins receive no ACAO; only the exact configured
origin receives authority. With no configured Web origin there is no new
variation or grant. Canonical bytes, ETags, cache lifetime, bodyless 304,
pre-auth dispatch and service-port silence are unchanged.

## Semantic and coverage evidence

```sh
npm run typecheck
npm test -- \
  apps/api/test/slice026-template-cache-variant.contract.test.ts \
  src/slice026-public-landing.contract.test.tsx
npm test -- \
  apps/api/test/slice023b1-cors-readiness.contract.test.ts \
  apps/api/test/slice024b-public-demo-api.contract.test.ts \
  apps/api/test/slice025-public-template-api.contract.test.ts \
  src/services/slice024b-canonical-url-attack-demo-client.contract.test.ts \
  src/services/slice025-template-catalog-client.contract.test.ts \
  src/slice024b-canonical-url-attack-demo.contract.test.tsx \
  src/slice025-template-gallery-composer.contract.test.tsx \
  src/product-entry.contract.test.tsx \
  src/product-entry.states.test.tsx \
  src/product-entry.mobile.contract.test.ts \
  src/product-entry-accessibility.contract.test.tsx \
  src/App.surface-contract.test.tsx \
  src/slice023c2b2-app-wallet-authority.contract.test.tsx \
  src/product-truth-and-analytics.contract.test.tsx
npm run test:coverage:backend
npm run test:coverage:web
```

- Typecheck is PASS.
- Exact API/Web Slice 026 matrix: 2 files and 32 tests PASS.
- Nearest public API, clients, templates, routing, wallet and analytics matrix:
  14 files and 164 tests PASS.
- Backend coverage: 108 files and 1048 tests PASS; overall 92.33% lines and
  87.40% branches. API is 91.16% lines and 86.36% branches; `app.ts` is 97.05%
  lines and 95.38% branches. The 37 PostgreSQL cases skipped by this coverage
  configuration are not PostgreSQL integration evidence.
- Web coverage: 68 files and 580 tests PASS at 92.77% lines and 86.04%
  branches. React components are 89.50% lines and 81.51% branches.

The first backend coverage attempt was unable to open sandboxed loopback
sockets. An approved loopback run then had one isolated timing-sensitive
`ECONNRESET`; that exact case passed alone and the complete approved repeat
passed with the counts above. No production change was made for either
environmental condition.

## Build and Sites evidence

```sh
npm run build
npm run test:sites
```

The root production build is PASS. Sites compatibility is 36/36 PASS and emits
`dist/client/index.html`, `dist/server/index.js` and
`dist/.openai/hosting.json`. The protected Sites source, package lock,
contracts/domain, dependencies, SQL, worker, CLI, Action, Docker and Caddy are
unchanged.

## Browser acceptance

The Browser skill and its local-development workflow were applied only after
semantic, coverage and build gates were GREEN. The built product was inspected
at desktop `1488x1058` and mobile `390x844` with QA-only same-origin summary
responses. Ready, both-unavailable and mixed catalog-unavailable/demo-ready
states were accepted. The ready view had one H1, no active rail item, exact
Overview/Coston2/Web2Json shell, response-derived featured card, canonical
Composer target, persisted-evidence summary, no horizontal overflow and mobile
controls of 44–46 pixels. The reduced-motion rule was present.

Root query/fragment input was removed to exact `/`. Direct unknown `/home`
rendered only the bounded unavailable state and caused no API read. Back/forward
restored mixed and ready root states; direct template navigation and root reload
also restored their accepted headings. Keyboard Tab entered the accessible
`Proofline home` control with a visible focus outline.

The application-origin console had no warning or error. Browser extension
warnings were excluded by origin. The QA server ledger contained only local
static assets and the two same-origin summary GETs; it contained no template
detail, recording, provider, RPC, compiler, verifier or wallet-provider chunk.
The browser environment also probed `/offline-sw.js`; repository source and the
built asset inventory contain no service-worker registration or such asset, so
this was browser infrastructure rather than application work.

The frozen ready-state axe case reported zero serious or critical findings.
The Browser control surface exposes only read-only page evaluation and no
non-mutating axe injection, so browser evidence records semantic DOM, focus and
layout inspection plus that deterministic production-component axe result
rather than claiming a second injected axe run. One composite history operation
timed out in Browser control after navigation; bounded individual back/forward
checks then passed. No production change was made for either limitation.

The temporary QA response file and all local preview servers were removed after
acceptance. No credential, external provider request, recording fixture in the
product, live Coston2 run, PostgreSQL change, Docker deployment, hosted Sites or
DigitalOcean deployment is claimed. The selected deployment remains the
unprovisioned ADR 0029 DigitalOcean VDS/Docker Compose target. This production
author cannot serve as either independent verifier.
