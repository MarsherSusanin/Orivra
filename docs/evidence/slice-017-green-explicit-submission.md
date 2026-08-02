# Slice 017 GREEN evidence — explicit submission

## Frozen contract waves

- Initial RED: commit `9dfd3d83679558ca60fc876b0ed9471e3a01bee7`, tree
  `1419d3e571d3e326acca0487614b33146a13a543`.
- Audit addendum RED: commit `da7197631baf38fcb048ba995d7762382fcb2213`,
  tree `30880384c75ee25a83e4fa58264ebd9cb3dce177`.
- The addendum reproduced wallet durability, relayer quota normalization,
  wallet-intent normalization, strict preflight evidence, stable conflict codes
  and hermetic/production authority parity before their fixes.

## GREEN implementation waves

- Core confirmation boundary: commit
  `1c87fd4a6447ab60a6e57dcbc8864f120ad26378`.
- Audit-driven core hardening: commit
  `028e2d6d87592d209f08110c662c4ea371e29b92`.
- Web, CLI and Action surfaces: commit
  `311e6a679336ffbe0b5efc0427e20528b808dc1c`.
- Canonical Action artifact correction: commit
  `76fabfd593a1588bcfcd5035cac30ff3acd0627c`.

Production authors did not edit frozen acceptance tests. Legacy expectations
were reconciled in separate test-only commits.

## Focused results before freeze

- contracts/domain: `325/325`, 100% statements and branches;
- migration 005 on real PostgreSQL: `6/6`;
- audit addendum API/worker/PostgreSQL contracts: `80/80`;
- hermetic explicit replay and authority addendum: `5/5`;
- affected backend: `520/520`;
- affected Web: `275/275`;
- React coverage: 90.13% statements, 84.98% branches;
- run-client coverage: 96.31% lines, 85.83% branches;
- focused Action/runtime/artifact matrix: `67/67`;
- Action clean-build sync: PASS twice, artifact SHA-256
  `144352973fdcce214bcd5d03a00f9897a7de7124dd236d7327c13e6f796fd6d1`;
- author visual check: desktop `1488x1058`, mobile `390x844`, axe zero
  serious/critical and clean application console.

These are implementation-wave results, not independent verification PASS.
The complete runbook matrix, candidate identity and two verifier reports are
recorded only after the final documentation commit is frozen.
