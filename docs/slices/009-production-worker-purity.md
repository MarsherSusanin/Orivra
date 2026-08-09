# Slice 009 — Production worker purity

## Trigger

The Slice 008 root artifact scan found test-only custody compatibility code in
`apps/worker/dist/worker.js`. Runtime guards made it unreachable in normal
production configuration, but the shipped bundle still contained project-token,
private-key, and synthetic live-handler logic.

## Frozen acceptance contract

- The production worker entry/import graph contains only the persisted command
  pipeline. It has no injectable legacy runtime and no synthetic live command.
- The built worker artifact contains no project-token custody path, private-key
  execution field, legacy credential error, or synthetic live handler marker.
- Contracts expose wallet/account auth through
  `@proofline/contracts/wallet-auth` while preserving identical root exports;
  contracts and domain declare `sideEffects: false` and pass the module-load
  purity source gate.
- Artifact evidence comes from a fresh temporary production-equivalent esbuild
  plus its metafile, not from a possibly stale `dist/worker.js`. Wallet-auth and
  canonical-URL demo inputs contribute zero output bytes, while the worker
  entry/bootstrap/runtime, API PostgreSQL, contracts, domain and FDC runtime
  inputs contribute non-zero bytes.
- Test-only live-gate utilities remain in a separate module that is not reachable
  from `src/entry.ts` or `src/bootstrap.ts`.
- Production still reads its own low-balance relayer key from the worker
  environment through the live pipeline port; this is not user-key custody.
- Existing persisted worker, live-port, restart, and release-graph contracts remain
  green. A test adapter cannot be enabled by setting `NODE_ENV=test` on the
  production entry.

## Cycle

1. Contract & Test Designer freezes a failing production-graph/artifact contract.
2. Core Implementer separates legacy test runtime from production composition.
3. Test-only reconciliation updates obsolete bootstrap injection controls.
4. Root rebuilds and scans the exact artifact before the final candidate freeze.
