# Slice 031 RED evidence — production canonical URL demo restoration

Status: intentional RED before production implementation.

The public demo currently fails closed because production has no selected,
runtime-verified canonical recording. This slice freezes the missing boundaries:

- the checked-in safe consumer must enforce the exact Open-Meteo template URL;
- one deterministic static attack response is served from an immutable public
  Git commit and remains compatible with the control transform/ABI;
- production API startup receives one exact recording SHA selector;
- the operator reads one root-owned regular mode-0400 file with `O_NOFOLLOW`,
  checks its byte SHA and runs one dedicated-role importer through the existing
  `db-role-bootstrap` service;
- any path, metadata, digest, selector or Compose failure is fail-closed before
  API restart and never emits recording bytes or credentials.

The live wallet transaction, recording, import and deployment are intentionally
absent from this RED commit.
