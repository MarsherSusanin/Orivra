# Slice 027R RED — DigitalOcean VDS roadmap

## Intentional RED

The accepted parent intentionally has no ADR 0029 and still records Sites as
the Web host while leaving the API/worker/PostgreSQL provider undecided. The
new bounded documentation contract therefore fails until the canonical docs
agree on the DigitalOcean VDS topology, recovery model and credential gate.

The RED owns documentation only. It neither adds infrastructure files nor
provisions a Droplet, DNS, SSH, GHCR, Spaces, PostgreSQL or Coston2 access. It
cannot be cited as a hosted, deployed, backup/restore or live-network PASS.

## Expected failure boundary

`node --test tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs` must
fail because:

1. ADR 0029 is absent and ADR 0001/0021/0024 have no narrow supersession note;
2. canonical architecture and operations docs do not yet define the selected
   Compose/Caddy topology, host exposure, migration, readiness or PITR model;
3. the roadmap does not yet split 027A/B/C, 028A, the 028B credential gate and
   Slice 029 promotion/canary;
4. canonical agent/review docs do not yet freeze the one-post-module full
   matrix and two-PASS authorization boundary.

The existing absence of a Render production target and the existing honest
statement that infrastructure is not deployed are the green control.

Recorded on parent `829e5e44421634025e14ed991e3119adc231d60a` /
tree `e1d606cd5feab28548a468a905739fbc1a65b4bc`:

- `npm run typecheck` and `git diff --check` — PASS;
- `node --test --test-reporter=dot
  tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs` — 8 tests: one
  honest-current-state/no-Render control PASS and exactly 7 intentional RED;
- the seven RED reasons are absent/narrowly unrecorded ADR 0029, missing selected
  topology, missing host-exposure contract, missing immutable release/migration
  contract, missing off-host PITR/restore contract, missing staged credential
  gate, and canonical files not yet pointing to the decision;
- nearest unchanged documentation contract
  `npm test -- tests/slice016-runbook.contract.test.ts --maxWorkers=1` — 1 file /
  3 tests PASS.

The candidate commit/tree are reported after this tests/evidence-only wave is
committed. No production, dependency, infrastructure or canonical operating
document was changed.
