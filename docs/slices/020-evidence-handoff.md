# Slice 020 — Evidence receipt and integration handoff

## 020A — Evidence receipt

- Strict deterministic `EvidenceReceiptV1` derived from verified canonical bundle bytes.
- Distinct proof, bundle and safe-consumer checksums.
- Optional live transaction hash, voting round, consumer verdict and local replay result.
- Share-readable `GET /v1/runs/:id/receipt`; pending and corrupt evidence fail closed.
- API verifies the persisted artifact SHA before returning bundle or receipt bytes.
- Web supports exact Copy and Download without requiring project mutation authority.

## 020B — Integration package

- Exact receipt, bundle and generated `.sol` downloads.
- Repository-local CLI replay command and checked-in GitHub Action YAML.
- Project-only idempotent creation of a run-scoped read-only share link.
- Share token travels only in the URL fragment, is moved to session state before the
  first request and is immediately scrubbed from browser history.
- Share mode performs reads and local verification only; it never calls replay or any
  other mutation endpoint.
- One explicit next integration step; no new dashboard, ZIP format or infrastructure.

## Acceptance

Contract/domain/API/browser tests cover checksum mutation, event identity, project and
foreign-share scope, pending state, exact bytes, fragment leakage, reload, Copy/Download,
repository-local CLI/Action truth, desktop/mobile, keyboard, axe and Sites deep routes.

Cycle: ADR → RED contracts/API/browser → GREEN core → GREEN surfaces → full freeze →
independent Core PASS → independent Product Integration PASS.
