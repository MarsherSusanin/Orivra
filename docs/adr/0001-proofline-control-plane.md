# ADR 0001 — Proofline control-plane boundaries

Status: accepted

The Sites-hosting portion is partially superseded by
[ADR 0029](0029-digitalocean-vds-deployment.md). All other control-plane and
package-boundary decisions remain accepted.

## Decision

Use an npm-workspace TypeScript monorepo with a pure domain core, versioned public contracts, a Node API, a PostgreSQL-backed worker, a Coston2 adapter package, React/Vite Web, CLI, GitHub Action, and Solidity consumer fixtures.

The browser and CLI own user signing. A separate worker owns the optional relayer key. The API prepares commands and persists events but cannot sign user transactions.

PostgreSQL stores an append-only event journal and derived run snapshot. Workers claim due commands with short `FOR UPDATE SKIP LOCKED` transactions; all external network calls occur after releasing database locks.

## Package boundaries

- `packages/contracts`: schemas and wire contracts; no I/O.
- `packages/domain`: state machine, diagnostics, canonicalization, replay, code generation, ports; no React, SQL, wallet, or network imports.
- `packages/fdc-coston2`: verifier, registry, RPC, Relay, DA, proof, safe HTTP, and relayer adapters.
- `apps/api` and `apps/worker`: composition roots and persistence.
- `apps/web`, `packages/cli`, and `packages/action`: public surfaces consuming the same contracts.

## Consequences

- Pull-request tests are hermetic and use recorded adapters.
- Coston2 is a separate merge-gate and cannot determine unit-test outcomes.
- `simulateConsumerVerification` is removed from production composition; replay remains explicit and fail-closed.
- Sites hosts only the Web build. API and worker are deployed separately against PostgreSQL/Supabase-compatible infrastructure.
