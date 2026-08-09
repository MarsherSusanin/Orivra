# ADR 0009 — No test custody code in the worker artifact

## Status

Accepted for Slice 009. Amended for the worker packaging-purity correction.

## Decision

Runtime environment checks are not a sufficient boundary for custody-sensitive
test adapters. Code that accepts a project token or passes a private key through a
synthetic execution request must not be reachable from the production entry graph.

The production bootstrap composes only PostgreSQL, persisted command handlers, and
live Coston2 pipeline ports. Legacy live-gate orchestration, if retained for narrow
tests, lives outside that graph and cannot be injected into `createProductionWorker`.
Artifact scanning is a release contract in addition to source-level assertions.

The source graph and the shipped graph are distinct contracts. Pure workspace
packages `@proofline/contracts` and `@proofline/domain` declare
`sideEffects: false`, so an unused feature module can be removed from a bundle
without treating schema construction as an observable package effect. Wallet
and account-authentication contracts live at the feature subpath
`@proofline/contracts/wallet-auth`; the root contracts entry re-exports the same
runtime values for backwards compatibility.

Worker artifact evidence is built into a fresh temporary directory from
`apps/worker/src/entry.ts` with the production esbuild settings and a metafile.
A checked-in or previously rebuilt `dist/worker.js` is not sufficient evidence.
The fresh artifact must retain the entry/bootstrap/worker/live-runtime execution
graph and the top-level `startProductionWorker` call, while excluding
`projectToken`/`PROJECT_TOKEN`. In the selected metafile output, unused
`wallet-auth` and `canonical-url-attack-demo` inputs contribute exactly zero
bytes; esbuild may still list a parsed side-effect-free re-export. Required
worker, API persistence, contracts, domain and FDC runtime inputs each retain a
non-zero contribution, preventing an `externalize-all` false PASS.

The `sideEffects: false` declaration is backed by a source gate: these pure
packages have no side-effect-only imports and perform no module-load process or
global access, I/O, timers, dynamic imports or top-level await. Pure schema and
constant construction remains allowed.

## Consequences

Bootstrap tests assert the persisted pipeline rather than the deleted compatibility
handler. The worker still owns its configured relayer key internally, but no public
command or adapter transports that key as request data.

Root-barrel imports remain source-compatible. Adding a pure feature module does
not silently expand the production worker artifact; the fresh build plus
metafile gate fails before release if that packaging boundary regresses.
