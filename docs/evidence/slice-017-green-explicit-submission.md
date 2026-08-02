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
- Corrective verifier-finding hardening: commit
  `49151b16e06aebf0214fe97f6ab98ff896aa919d`.
- Composed relayer quota correction: commit
  `2ae1af475aea65f103e267d3a0fba71a45ffa1f5`.

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

The first frozen candidate `fbbc93b24006fa6aa5c196a583b5b2f15f4d162b`
did not receive either formal PASS. Independent verification found a real CLI
readiness mismatch, missing strict CLI response parsing and an EIP-1193 `4001`
recovery gap. Those findings were converted to the corrective RED evidence in
`slice-017-red-corrective-verifier-findings.md` before the production fix.

Corrective focused GREEN results:

- verifier-finding contracts: `39/39`;
- nearest CLI, Action and wallet controls: `153/153`;
- CLI coverage: 93.10% statements and 94.35% branches;
- run-client coverage: 96.19% statements and 85.15% branches;
- CLI build, syntax check, typecheck and diff check: PASS.

The second frozen candidate `74f096620aa42b20ea2d8a48409f80e647bea673`
also did not receive Core PASS. Independent verification found that the live
relayer policy parser rejected valid `quotaRemaining: 0` evidence before the
stable quota validator could emit `RELAYER_QUOTA_EXHAUSTED`. The composed-path
RED is recorded in `slice-017-red-relayer-zero-quota-corrective.md`.

The production correction changes only the zero-boundary interpretation in the
live adapter. Focused composition passes `23/23`, nearest relayer/worker/
PostgreSQL controls pass `55/55`, and worker coverage remains above the gate at
90.41% lines and 86.75% branches. Zero quota now terminalizes before signing or
broadcast; malformed, noninteger and negative evidence remains fail-closed.

These are implementation-wave results, not independent verification PASS.
The complete runbook matrix, candidate identity and two verifier reports are
recorded only after the final documentation commit is frozen.
