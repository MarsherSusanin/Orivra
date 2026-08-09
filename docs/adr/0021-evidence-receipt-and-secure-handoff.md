# ADR 0021 — Evidence receipt and secure handoff

## Status

Accepted for Slice 020.

The Sites-hosting portion is partially superseded by
[ADR 0029](0029-digitalocean-vds-deployment.md). Evidence, share and exact-byte
handoff decisions remain accepted.

## Context

Proofline already persists a canonical proof bundle, exact generated Solidity and
run-scoped share credentials. The product does not yet expose a compact receipt,
and share URLs currently place the raw credential in the query string. A shared
reader also cannot prove replay by calling the mutating replay endpoint.

## Decision

`EvidenceReceiptV1` is a deterministic aggregate derived only from exact verified
`ProofBundleV1` bytes. It keeps proof and bundle checksums distinct and includes
run/network identity, optional live transaction hash, voting round, consumer
result, safe-consumer checksum and local byte-identical replay result.

`GET /v1/runs/:id/receipt` is project-readable and run-scoped share-readable. The
API verifies both the persisted artifact-column SHA-256 and the bundle's internal
checksum before returning a receipt. Missing evidence returns 409; corrupt or
contradictory evidence fails closed.

The Integration Package composes this receipt with the already verified bundle,
exact persisted Solidity, repository-local CLI replay instructions and the
checked-in GitHub Action contract. It introduces no second server aggregate and
no archive format.

New share links use `#share=<opaque token>`. Web consumes the fragment before its
first request, stores the credential only in session storage, and immediately
removes the fragment with `history.replaceState`. Query credentials, persistent
storage, logs, analytics and downloaded artifacts are forbidden. Share access
remains read-only and never calls `POST /v1/replays`.

## Consequences

No migration is required. Bundle-byte integrity, project/share scope, fragment
scrubbing, exact downloads, CLI/Action truthfulness, browser accessibility and
Sites deep routes are release gates. Until CLI and Action are published, generated
instructions are explicitly repository-local.
