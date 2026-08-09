# Slice 024B corrective RED — digest binding and API cache snapshot

Date: 2026-08-10 (Asia/Vladivostok)

Role: Contract & Test Designer

Rejected candidate commit: `57f1b38c14a33d9c6d3a2b76f39120469301a2a9`

Rejected candidate tree: `a7b803b4c724307cc3f8458cc8d6ea875c867754`

Architecture decision: [ADR 0032](../adr/0032-persisted-public-canonical-url-attack-demo.md)

## Verifier provenance and scope

Core and Product independently inspected the exact candidate tree. Their
complete reports were delivered as agent-message payloads rather than
repository files. Both confirmed the same two P1 findings and no additional
blocker:

1. pure summary derivation accepts a different but well-formed lowercase
   SHA-256 instead of binding it to the canonical recording bytes;
2. the API validates and hashes mutable injected cache bytes during each
   anonymous request rather than owning a composition-time snapshot.

This corrective wave changes tests and documentation only. It changes no
production source, package dependency, migration, PostgreSQL state, Web/Sites
surface, credential or deployment behavior.

## Frozen corrective contract

- A recording replayed from valid canonical bytes serializes back to those
  exact bytes. Derivation succeeds with their SHA-256 and throws for a
  deterministic one-nibble different, still well-formed SHA-256 envelope.
- An observable injected available cache exposes each private field through a
  counted getter and its summary through a poisonable Proxy. API composition
  must read every field exactly once, validate it, copy the recording bytes and
  freeze an owned summary snapshot.
- After composition, the caller mutates the original byte Buffer and all
  backing fields, then makes further reads throw. Two summary GETs, an exact
  summary If-None-Match 304 and a recording download must retain the original
  bytes and representation ETags without another input read.
- An invalid injected cache is normalized to the uniform unavailable snapshot
  during composition; poisoning it before the first request cannot affect the
  503 response. A genuinely absent cache remains on the same unavailable path.
- The exact demo response function contains no cache validation, Zod parsing,
  canonicalization or SHA-256 call; those operations belong only to composition.

## Intentional RED and controls

```text
npm run typecheck
PASS

npx vitest run \
  packages/domain/test/slice024b-canonical-url-attack-demo-summary.contract.test.ts \
  apps/api/test/slice024b-public-demo-api.contract.test.ts

EXPECTED RED — 2 files, 27 tests: 4 failed, 23 passed
```

The exact RED cases are digest mismatch acceptance, zero composition-time reads
for a valid cache, request-path cache revalidation, and zero composition-time
reads for an invalid cache. The behavior failures occur before poisoned
post-composition input can be consulted, while the source assertion locates the
existing validation call in the exact demo response function. They are semantic
RED rather than timing, crypto-spy or harness failures.

Nearest accepted controls:

```text
npx vitest run \
  packages/domain/test/bundle-replay.test.ts \
  apps/api/test/slice024b-demo-startup-cache.contract.test.ts \
  apps/api/test/api-contract.test.ts

PASS — 3 files, 45 tests
```

No broad/full, Testcontainers, Docker, external-network, live, hosted or
deployment command was run.
