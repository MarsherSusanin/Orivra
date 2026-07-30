# ADR 0008 — Attempt before I/O and local PR replay

## Status

Accepted for Slice 008.

## Decision

Relayer delivery uses a durable attempt boundary. The worker atomically records the
single allowed broadcast attempt before calling the RPC. A crash after that record
creates an ambiguous state, but restart recovery may only observe the known hash;
it may not broadcast again. If the transaction cannot be observed within the
bounded recovery policy, the command fails closed and requires operator recovery.
This prefers a visible incomplete run over an unprovable duplicate spend path.

Terminal immutability applies to the ordered run journal and new lifecycle
commands. Derived read-only products may be created after the result: safe source
generation and an opaque read-only share token do not alter the projection.
Idempotency lookup precedes the terminal mutation guard so an exact retry can
return the previously accepted intent.

Consumer intent belongs to the invoking surface. Web requests the canonical
vulnerable consumer for educational diagnostics. CLI and merge-queue Action request
canonical-safe when establishing a release predicate. Proof verification stops at
the proof boundary and never silently chooses a consumer on behalf of a surface.

Pull-request replay is a local integrity check over canonical ProofBundleV1 bytes.
It does not create API runs and is forbidden from network access. Merge queue is
the only Action mode that creates a persisted run and contacts Coston2 through the
authorized API/worker graph. Runtime configuration for that path is constructed
inside the Action error boundary.

## Consequences

PostgreSQL records broadcast attempt and acceptance separately. Release evidence
reports attempt count and ambiguous recovery honestly. The Action gains an
explicit local bundle input and a domain dependency. CLI production dependencies
become lazy for help. Existing tests that assumed automatic safe verification or
API-backed PR replay must be reconciled to this decision after the new RED suite is
demonstrated.
