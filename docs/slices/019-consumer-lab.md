# Slice 019 — Consumer evidence and safe artifact

## Acceptance

- Strict `ConsumerLabReportV1` and read endpoint.
- Scheme/host/path/query rows expose expected, observed, enforced and passed.
- Visible `Valid proof ≠ trusted URL` conclusion without hover.
- Deterministic vulnerable/safe unified diff.
- Exact persisted Solidity, compiler status/version and SHA-256.
- Copy, `.sol` download and verification action; no hardcoded consumer address.
- Project and run-scoped share read; unrelated share and missing evidence fail closed.
- Desktop/mobile, keyboard/Escape, axe and clean console/network verification.

Cycle: ADR → RED contracts/API/browser → GREEN core → GREEN surfaces → full
freeze → independent Core PASS → independent Product Integration PASS.
