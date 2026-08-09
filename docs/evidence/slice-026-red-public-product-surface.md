# Slice 026 RED — public product surface

Status: Intentional RED contract; production implementation absent.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Architect and Contract/Test Designer

Accepted parent commit: `71ac54193c95fb3741efecece7b3b68477cd8739`

Accepted parent tree: `176c6248c8992bbce1a0a31c3db880d7e506d8ed`

Architecture decision: [ADR 0034](../adr/0034-public-landing-and-onboarding-boundary.md)

Slice contract: [026](../slices/026-public-product-surface.md)

## Accepted prerequisite and corrective input

Slice 025 production-author candidate was frozen exactly once at the accepted
parent commit/tree above. Independent Core and Product verifiers both returned
formal PASS on that same clean tree, with no P0/P1 and one matching nonblocking
P2: cacheable template responses for absent or hostile Origin omitted
`Vary: Origin` while an exact Web origin was configured.

Core evidence included typecheck; 163 focused and 145 nearest tests; 520
contracts/domain tests at 100%; backend 1035 tests at 92.19% lines/87.25%
branches and API 90.87%/86.07%; Web 561 tests at 92.69%/85.99%; purity,
builds, Sites 28, Action 9 and PostgreSQL 151 with zero skips. Product reran
typecheck, 122 focused tests, the same Web coverage, build/Sites and real
Chromium desktop/mobile/history/modal/axe/provider-free acceptance. Both ended
at the exact clean commit/tree. These are local credential-free reports, not
hosted, Docker, live Coston2 or deployment evidence.

The shared P2 is accepted as Slice 026 corrective input, not a Slice 025
failure. The new API contract freezes catalog/detail × 200/304 × absent/
configured/hostile Origin plus the no-configured-origin control.

## Frozen files and first-run evidence

The RED wave changes tests and documentation only:

- `apps/api/test/slice026-template-cache-variant.contract.test.ts`;
- `src/slice026-public-landing.contract.test.tsx`;
- `tests/slice026-public-landing-route.contract.test.mjs`;
- ADR/index, Slice 026, roadmap and canonical README/architecture/runbook docs.

Production, contracts/domain, migrations, dependencies/lockfile, worker,
CLI/Action, Docker/Caddy and protected Sites sources are unchanged.

Typecheck is structurally GREEN:

```sh
npm run typecheck
```

Result: PASS.

The new API and landing contracts were executed together:

```sh
npx vitest run \
  apps/api/test/slice026-template-cache-variant.contract.test.ts \
  src/slice026-public-landing.contract.test.tsx
```

Result: 2 files, 32 tests; 26 intentional RED and 6 control PASS.

- API: 13 tests; 8 RED are exactly catalog/detail × 200/304 × absent/hostile
  Origin missing the required `Vary: Origin`; the four configured-origin
  variants and no-configured-origin control PASS.
- Web: 19 tests; 18 RED are exactly absent root/PublicLanding and unknown-route
  composition; explicit injected `runId` compatibility PASS.

There are zero pending/skipped tests. The failures contain no compilation,
fixture, unhandled request or environment error.

The new Sites contract is independently GREEN:

```sh
node --test tests/slice026-public-landing-route.contract.test.mjs
```

Result: 8/8 PASS.

The nearest accepted API/client/Web baseline is GREEN:

```sh
npx vitest run \
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
```

Result: 14 files, 164/164 PASS.

Full Sites compatibility is GREEN:

```sh
npm run test:sites
```

Result: 36/36 PASS, zero skipped.

### Corrective harness note

After the initial RED commit `46e653a00fbf9babf3e3b6a22127865b7ec4c6b7`
was reviewed, the malformed-demo case was found to forbid the word `fixture`
while ADR 0034 requires the honest unavailable sentence `Proofline does not
substitute a fixture or synthetic result.` The corrective RED preserves that
exact sentence and instead forbids the fabricated payload marker, available
evidence state, hashes and recording CTA. Public behavior is unchanged and the
focused RED/PASS counts remain unchanged.

Focused failures must be the absent Slice 026 landing/route composition and the
known absent/hostile Origin cache variation only. A compilation, fixture,
timeout or test-environment failure is not accepted as semantic RED. A Sites
skip is not PASS.

## GREEN acceptance

Implementation must satisfy the exact frozen tests without weakening prior
024/025 public routes, evidence truth, template resolution, Composer draft
authority, wallet boundaries, analytics or provider-network containment.
Affected API and Web coverage, build/Sites artifacts and the browser matrix in
the Slice 026 contract are mandatory before candidate freeze. Two different
read-only verifiers must inspect one stopped commit/tree.
