# ADR 0020 — Persisted Consumer Lab evidence

## Status

Accepted for Slice 019.

## Context

Consumer verification persists `CONSUMER_VERIFIED`, `consumer-evidence` and
exact `safe-consumer` bytes, but Web currently reduces them to transient copy.
Client-side regeneration could disagree with the journal and downloaded bytes.

## Decision

`ConsumerLabReportV1` is assembled only from the owned manifest, terminal
consumer event and persisted artifact bytes. It includes four URL invariants,
canonical vulnerable/safe identities, diagnostics, exact Solidity, SHA-256,
compiler evidence and a deterministic unified diff.

`GET /v1/runs/:id/consumer-lab` is project-readable and run-scoped
share-readable. It returns 409 until evidence exists and fails closed on invalid
bytes or checksum mismatch. Copy and Download use those exact bytes; Web never
regenerates Solidity. `Safe to integrate` requires all four enforced checks and
successful compiler evidence.

Diagnostics persisted as canonical artifact bytes and as PostgreSQL `jsonb`
are cross-bound with canonical semantic equality. Object-key order is not
authority, while array order and every validated diagnostic value remain exact.
The vulnerable-consumer verdict and the generated safe artifact are separate
facts: code generation or local artifact verification never fabricates a
passing canonical-safe run.

## Consequences

No migration is required. A report-read failure after successful codegen keeps
the generated artifact visible and retryable without repeating codegen or the
consumer effect. Contracts/domain coverage, ownership/share checks, checksum
mutation, Solidity compilation and browser acceptance are release gates.
