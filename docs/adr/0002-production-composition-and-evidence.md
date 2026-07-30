# ADR 0002 — Production composition is a release artifact

## Status

Accepted for Slice 002.

## Context

Slice 001 proved the domain and adapter contracts hermetically, but injectable ports were mistaken for shipped surfaces. The candidate had no default live runtime, runnable API/worker, CLI binary, Action bundle, or Web token/run hydration path. Green unit tests therefore did not imply an executable release.

## Decision

Production composition roots, package entrypoints, generated distributable artifacts, migrations, and UI configuration/hydration are first-class acceptance artifacts.

- Ports remain injectable for tests, but each mandatory surface owns a default production constructor that validates configuration and wires only live adapters.
- Build verification starts from a clean artifact directory and proves every referenced `bin`, `main`, server, and worker entry exists and executes a bounded smoke command.
- Live evidence is a typed value containing commit/tree/run/transaction/round/proof/consumer/broadcast facts. An implementation seam or fixture cannot create it.
- Project tokens may be entered by the user and retained in session storage only. User private keys stay in EIP-1193 or local CLI/Action signing processes.
- Replay remains the PR/default developer mode, but its semantic verifier is stricter than checksum validation.

## Consequences

The repository gains explicit runtime dependencies and build artifacts. Tests must distinguish port-level correctness, production composition, packaging, black-box Web behavior, external PostgreSQL, and live Coston2. A release can be hermetically green yet remain blocked when external gates cannot run, but it cannot pass while a required composition is missing.
