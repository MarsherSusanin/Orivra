# Slice 024B GREEN — persisted public canonical URL attack demo

Status: Replacement production-author candidate after corrective RED;
independent Core and Product verification pending.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Production implementer

Original implementation RED commit: `4e03267277b449913b2f5f7bc781454b8825beed`

Original implementation RED tree: `fd5227d44e779bcf8ca0b1ff4d4bc8f4bf3088ea`

Digest/cache corrective RED commit: `f18d4d2356596c59f7cfee13b6f88b1b790bab22`

Digest/cache corrective RED tree: `e806234677929772e45b2eeb8a8fc38724e0bb98`

Architecture decision: [ADR 0032](../adr/0032-persisted-public-canonical-url-attack-demo.md)

Slice contract: [024B](../slices/024b-persisted-public-canonical-url-attack-demo.md)

## Implementation

The strict public summary and pure deterministic derivation expose only the
bounded, hash-only demonstration shape. Migration 009 stores one exact
recording Buffer immutably with append-only triggers and least-privilege grants.
The one-shot importer reads no more than 6 MiB, invokes the concrete 024A
checked-in-source compiler/EVM runtime before opening a transaction, then uses
the fixed advisory lock and accepts an existing digest only when bytes and
metadata are identical. Pure replay remains non-authorizing.

API startup accepts only the optional exact digest selector, caches one
canonical/digest/authority-validated row, and keeps compiler/EVM code outside
the ordinary server bundle. The anonymous summary and exact-byte download
routes use representation-specific strong ETags, public revalidation,
same-origin CORS and a uniform no-store 503. They reject query selection,
unsupported methods and malformed state without consulting bearer authority.

`/demo/canonical-url` uses a token-free same-origin client. It makes no wallet
restore, recording preload, source/RPC/compiler request or synthetic fallback.
The available view distinguishes persisted Coston2 evidence from deterministic
local replay and downloads only after an explicit user action. The unavailable
view remains honest. URL history preserves the route across reload, back and
forward.

The corrective ADR 0009 packaging work extracts schema primitives, auth
timestamps and the wallet/account custody schemas into pure feature leaves.
`@proofline/contracts/wallet-auth` is an explicit subpath, its ten runtime
values are reference-identical to root compatibility exports, and the root
exports the timestamp helper directly from `./auth-timestamp`. Contracts and
domain declare `sideEffects: false`; actual API and Web wallet consumers use
the feature subpath. `WalletTransactionV1Schema` remains at the root boundary.

## Semantic, coverage and PostgreSQL evidence

```sh
npm run typecheck
npx vitest run apps/worker/test/slice009-production-worker-purity.contract.test.ts
npm run test:core:coverage
npm run test:coverage:backend
npm run test:coverage:web
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

- Corrected worker/package purity: 11/11 PASS against a fresh temporary build,
  metafile and retained-dist defense.
- Affected wallet-auth/API/Web/worker matrix: 23 files and 220 tests PASS.
- Contracts/domain: 42 files and 477 tests PASS at 100% statements, branches,
  functions and lines.
- Backend: 106 files PASS, 1004 tests PASS; overall 92.11% lines and 87.15%
  branches, with API at 90.67% lines and 85.86% branches. The 37 PostgreSQL
  cases skipped by this non-PostgreSQL coverage configuration are not used as
  integration evidence.
- Web: 65 files and 527 tests PASS at 92.36% lines and 85.76% branches.
- Real Testcontainers PostgreSQL: 20 files and 151 tests PASS with zero skips.
- Exact 024B matrix with real PostgreSQL: 8 files and 86 tests PASS with zero
  skips; Sites deep-route acceptance remains in the separate Sites gate.

## Build, package and browser evidence

Root Web/Sites, API server, one-shot importer, worker, CLI and Action builds are
PASS. Sites compatibility is 23/23 PASS and emits
`dist/client/index.html`, `dist/server/index.js` and
`dist/.openai/hosting.json`. CLI/Action artifact controls are 24/24 PASS.

The fresh worker metafile proves that the wallet-auth feature leaf and
`packages/domain/src/canonical-url-attack-demo.ts` contribute zero bytes to the
selected worker output. The contracts package as a whole, domain package as a
whole, FDC runtime, API PostgreSQL adapter and required worker runtime inputs
each contribute non-zero bytes. The shared full ADR 0009 forbidden-marker scan
passes for both the fresh artifact and retained dist. A separate API metafile
scan finds no `packages/fdc-coston2`, `solc` or `@ethereumjs` contribution.

The locally built page was inspected at desktop and `390x844` mobile widths in
both available and unavailable states. It had no horizontal mobile overflow,
zero axe serious/critical findings, no application-origin console warnings or
errors, and exact API traffic of one unavailable 503 followed by the selected
200 summary and explicit 200 recording request. Reload and back/forward route
restoration passed. The Browser runtime's download-event observer did not
return reliably, but the Enter action produced the exact recording GET 200;
the frozen 16/16 component/client cases provide deterministic keyboard, focus
and explicit-download coverage. No production change was made for that Browser
harness limitation.

No recording fixture, credential, external request, live Coston2 run, Docker
deployment, hosted Sites result or DigitalOcean deployment is claimed. With no
configured exact digest the product deliberately returns unavailable. This
production author cannot serve as either independent verifier.

## Rejected predecessor and corrective implementation

Both read-only verifiers inspected commit
`57f1b38c14a33d9c6d3a2b76f39120469301a2a9`, tree
`a7b803b4c724307cc3f8458cc8d6ea875c867754`. Their reports were delivered as
agent-message payloads and were not written as repository files.

Core reported two P1 findings: summary derivation accepts an arbitrary
well-formed `recordingSha256` instead of recomputing the digest of the canonical
recording bytes, and anonymous API requests revalidate and rehash up to 6 MiB
of injected cache bytes on every summary/download/304 request. Product
independently reproduced both findings. Neither verifier confirmed any other
migration, importer, HTTP, browser, Sites or package blocker.

The command and browser results above remain historical production-author
evidence, but they do not constitute an accepted GREEN or verifier PASS.

The replacement implementation binds summary derivation to
`sha256(canonicalSerialize(validatedRecording))`; a different well-formed
digest now fails before summary projection. `createProoflineApi` prepares the
optional injected cache once during composition: it reads each valid field
once, parses and canonically validates the summary, verifies both ETags and the
recording digest, copies the visible `Uint8Array` bytes into an owned private
view, and freezes the independently parsed summary. Getter failure or invalid
input becomes the same unavailable snapshot. Request handling retains no
caller getter, Proxy or byte view and performs no validation, parsing,
canonicalization, hashing or explicit copy.

Corrective candidate evidence:

```sh
npm run typecheck
npx vitest run \
  packages/domain/test/slice024b-canonical-url-attack-demo-summary.contract.test.ts \
  apps/api/test/slice024b-public-demo-api.contract.test.ts
npm run test:core:coverage
npm run test:coverage:backend
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
npm run build
npm --workspace @proofline/api run build
npm --workspace @proofline/worker run build
npm --workspace @proofline/cli run build
npm --workspace @proofline/action run build
npm run test:sites
```

- Exact corrective matrix: 2 files and 27 tests PASS.
- Nearest domain replay, startup-cache and API controls: 3 files and 45 tests
  PASS.
- Contracts/domain: 42 files and 478 tests PASS at 100% statements, branches,
  functions and lines.
- Backend: 106 files and 1007 tests PASS; overall 92.12% lines and 87.18%
  branches, with API at 90.72% lines and 85.91% branches. PostgreSQL skips in
  this coverage configuration are not integration evidence.
- Exact 024B matrix with real PostgreSQL: 8 files and 90 tests PASS with zero
  skips. Full real PostgreSQL: 20 files and 151 tests PASS with zero skips.
- Fresh worker artifact/package purity: 11/11 PASS. Root Web/Sites, API,
  importer, worker, CLI and Action builds PASS. Sites is 23/23 PASS and all
  required compatibility artifacts exist.

This correction changes no migration, importer, Web/Sites behavior, package
boundary, credential or deployment surface. The predecessor remains rejected;
the replacement candidate still requires two independent reports on its exact
tree. This production author cannot serve as either verifier.
