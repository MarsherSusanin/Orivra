# ADR 0009 — No test custody code in the worker artifact

## Status

Accepted for Slice 009.

## Decision

Runtime environment checks are not a sufficient boundary for custody-sensitive
test adapters. Code that accepts a project token or passes a private key through a
synthetic execution request must not be reachable from the production entry graph.

The production bootstrap composes only PostgreSQL, persisted command handlers, and
live Coston2 pipeline ports. Legacy live-gate orchestration, if retained for narrow
tests, lives outside that graph and cannot be injected into `createProductionWorker`.
Artifact scanning is a release contract in addition to source-level assertions.

## Consequences

Bootstrap tests assert the persisted pipeline rather than the deleted compatibility
handler. The worker still owns its configured relayer key internally, but no public
command or adapter transports that key as request data.
