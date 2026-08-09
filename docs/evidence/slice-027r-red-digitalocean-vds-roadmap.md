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

## Corrective RED — satisfiable 029 boundary and immutable publication chain

Rejected candidate `aed9d7c4fe2c58dc375c4528a768c108c4ae6aa3` /
tree `faab64ded0315b91803504e7f1e65b287e035854` made the original eight
documentation contracts GREEN but referred to credential-free `022–029A`
without defining 029A. It also described images as built and published by CI,
which leaves the pre-credential release candidate dependent on GHCR access.

Three corrective contracts now require:

1. ADR 0029, roadmap, runbook, roles and AGENTS define 029A as local,
   credential-free MLP validation/freeze over recorded fixtures and local
   Compose, including product gates and user testing with no credentials or
   external network; 029B is credentialed production promotion/canary after
   028B;
2. 028A builds, exports and verifies local OCI archives plus a frozen digest
   manifest without registry credentials or external registry access;
3. after the unified matrix and two PASS reports, 028B publishes those exact
   OCI bytes to GHCR without rebuild, verifies remote digests against the
   frozen manifest before staging pull, aborts a mismatch, limits the VDS pull
   credential to read-only and joins publication evidence to the release
   manifest.

The prior eight contracts are unchanged controls. Recorded on the rejected
parent above:

- `npm run typecheck` and `git diff --check` — PASS;
- `node --test --test-reporter=dot
  tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs` — 11 tests:
  original 8 PASS and exactly 3 corrective RED (`........XXX`);
- the three failures map one-to-one to the undefined 029A/029B boundary, absent
  offline OCI candidate chain and absent credentialed byte-preserving GHCR
  publication chain;
- nearest unchanged documentation contract
  `npm test -- tests/slice016-runbook.contract.test.ts --maxWorkers=1` — 1 file /
  3 tests PASS.

Candidate commit/tree are reported after commit. This correction changes no
canonical implementation, production, infra, dependency, credential or network
surface.
