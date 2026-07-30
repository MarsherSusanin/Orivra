# Slice 001 GREEN backend evidence

Date: 2026-07-30

Role: Surface & Adapter Implementer

Frozen RED commit: `49b6908`

## Implemented boundary

This wave changes no frozen test, fixture, Web cockpit, or Sites worker file. It implements:

- the Coston2 adapter package with injected, hermetic ports for pinned safe HTTP, exact Web2Json verifier preparation, deterministic preflight, registry and fee resolution, wallet transaction construction, Relay finalization, raw DA retrieval, proof verification, normalized errors, and persist-before-broadcast relaying;
- the canonical vulnerable/safe Solidity consumers and an invariant library that checks scheme, host, segment-bounded path prefix, and query values before registry-based proof verification;
- a Web `Request` API router with project/share authorization, idempotency, private-key rejection, stable errors, and all v1 routes;
- a transactional PostgreSQL migration and repositories for HMAC token digests, append-only ordered events, projections, canonical artifacts, short `SKIP LOCKED` leases, atomic completion, stale-lease rejection, relayer evidence, and least-privilege roles;
- a fail-closed worker composition boundary and restart-safe command execution;
- CLI and GitHub Action replay/wallet/live release modes without sending a user secret to the API;
- a network-disabled hermetic system for replay, diagnostics, code generation, bundle checksum/replay, and API/worker reconstruction;
- a live gate boundary that accepts only an injected `kind: "live"` runtime and returns a configuration error rather than silently falling back to replay or a simulator.

The two unreachable lifecycle message alternatives identified in RED were removed without coverage suppression.

## GREEN evidence

```text
npm run test:core:coverage
  7 files passed; 72 tests passed
  statements 100% (227/227)
  branches 100% (89/89)
  functions 100% (28/28)
  lines 100% (216/216)

npm run test:integration
  12 files passed, 1 Testcontainers file skipped by environment gate
  125 tests passed, 1 skipped

npm run test:solidity
  3 files passed; 31 tests passed

npm run test:e2e
  1 file passed; 2 tests passed

npx vitest run src/App.test.tsx
  1 file passed; 3 tests passed

npm run build
  Vite production build passed
  dist/client/index.html produced
  dist/server/index.js produced
  dist/.openai/hosting.json produced
```

The hermetic end-to-end gate runs with Undici network access disabled. It proves the replay flow, evidence-backed host diagnostic, safe consumer generation, canonical bundle checksum/reparse, byte-identical replay, and reconstruction without duplicate wallet submission evidence.

## Honest external blockers

`PROOFLINE_TESTCONTAINERS=1 npm run test:postgres` was attempted. Static and repository contracts passed, but Testcontainers reported `Could not find a working container runtime strategy` before starting PostgreSQL. The real-container test remains present and mandatory when the Docker/Testcontainers bridge is available.

No live Coston2 transaction was attempted because this environment has no funded Coston2 signing key, project token, verifier API key, or approved live manifest. The live gate is separate from hermetic acceptance and cannot report success without a real injected runtime and complete release evidence.

The root `npm test` and `npm run typecheck` remain intentionally RED only at the frozen Web surface boundary: `src/services/run-client.ts` is absent and four `App.surface-contract` cases await the next, separate Web/Sites writer wave. The original cockpit tests and production build remain green.
