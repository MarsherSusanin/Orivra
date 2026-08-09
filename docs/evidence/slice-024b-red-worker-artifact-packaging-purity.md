# Slice 024B corrective RED — worker artifact packaging purity

## Status

Intentional RED recorded on 2026-08-10. This is contract evidence, not a
production, hosted, Docker or Coston2 PASS.

## Accepted base

- commit: `cc6af6490625fcda615fbd8550afea71ef646b66`
- tree: `7655aba74c10a6ac4fca182045272a09906339d3`
- scope before implementation: tests and canonical documentation only

## Frozen correction

- `@proofline/contracts` and `@proofline/domain` declare `sideEffects: false`
  and pass a source gate against side-effect-only imports, async/dynamic module
  execution, process/global access, I/O and timers.
- `@proofline/contracts/wallet-auth` is the exact wallet/account-auth feature
  subpath. Its ten runtime exports are reference-identical to the compatible
  exports from `@proofline/contracts`.
- The worker purity gate invokes esbuild into a fresh temporary directory with
  the production worker entry, target, externals and banner, and reads that
  build's metafile. It does not treat the checked-in `dist/worker.js` as fresh
  evidence.
- `projectToken` and `PROJECT_TOKEN` are absent from the fresh artifact.
  `wallet-auth.ts` and `canonical-url-attack-demo.ts` may be parsed through pure
  re-exports but contribute zero bytes to the selected output.
- Worker entry, bootstrap, worker runtime, live runtime and API PostgreSQL
  inputs each contribute non-zero bytes; the contracts, domain and FDC runtime
  input groups also each contribute non-zero bytes. The artifact retains the
  top-level `startProductionWorker` call and the worker-owned Coston2
  relayer-key configuration marker.
- The pre-existing artifact regex remains unchanged.

## RED and control evidence

`npm run typecheck`

- PASS.

`npx vitest run apps/worker/test/slice009-production-worker-purity.contract.test.ts`

- 10 tests total: 4 intentional RED, 6 control PASS.
- RED: package purity/subpath metadata is absent.
- RED: the wallet-auth feature subpath is not exported yet.
- RED: the independently built fresh worker artifact contains `projectToken`.
- RED: the retained checked-in-artifact defense also sees `projectToken` in the
  current `dist/worker.js`; this stale artifact result is not substituted for
  the fresh-build finding.
- PASS controls include the pure-package source scan, production entry graph,
  preflight NODE_ENV exclusions, worker-owned relayer-key boundary and removal
  of the obsolete direct orchestrator.

Nearest accepted controls:

`npx vitest run apps/worker/test/production-bootstrap.contract.test.ts apps/worker/test/production-command-pipeline.contract.test.ts apps/worker/test/live-runtime-adapter.contract.test.ts apps/worker/test/slice008-release-truth.contract.test.ts`

- PASS: 4 files, 11 tests.

No broad/full matrix or external-network command was run. The fresh-build test
removes its temporary directory in `finally`, including on RED.
