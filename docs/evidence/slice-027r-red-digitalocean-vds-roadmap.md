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
   credential to read-only and records separate publication evidence bound to
   the frozen release-manifest checksum.

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

## Final corrective RED — distinct digests and external publication evidence

Rejected candidate `e7c7aa237ed518f4852f505253427156a727ef48` /
tree `81891455aea72e5757f27a3a5385dab567ffc871` made the first corrective
contracts GREEN but treated an archive checksum, an OCI image-manifest digest
and credentialed publication evidence as if they were one mutable release
manifest value.

The frozen contract is corrected before adding implementation requirements:

- every image entry has distinct `archiveSha256`, `imageManifestDigest`,
  `platform` and repository/reference identity; the frozen manifest also binds
  commit/tree and has its own canonical checksum;
- 028B checks exact archive bytes only against `archiveSha256`, and the GHCR
  remote digest only against `imageManifestDigest`; either mismatch aborts and
  no rebuild is allowed;
- publication/deployment evidence is a separate immutable append-only external
  record containing `frozenReleaseManifestSha256`, commit/tree, remote
  repository/digests, timestamp, operator and run evidence. It cannot rewrite
  the frozen manifest, candidate tree or images;
- the VDS may pull only the verified remote digest bound by that separate
  record to the frozen manifest.

The previous requirement that publication evidence be included in the frozen
release manifest is explicitly removed. The original eleven tests remain, with
their remote-digest expectation corrected to `imageManifestDigest`; three new
tests freeze the manifest schema, digest-role separation and external evidence
binding.

Recorded on the rejected parent above:

- `npm run typecheck` and `git diff --check` — PASS;
- `node --test --test-reporter=dot
  tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs` — 14 tests:
  10 unchanged controls PASS and exactly 4 intentional RED
  (`..........XXXX`);
- the four RED results are the corrected existing remote-digest comparison plus
  the three new manifest-schema, digest-role and external-evidence contracts;
- nearest unchanged documentation contract
  `npm test -- tests/slice016-runbook.contract.test.ts --maxWorkers=1` — 1 file /
  3 tests PASS.

Candidate commit/tree are reported after commit. This wave changes no canonical
implementation, production, infra, dependency, credential or network surface.

## Rollback authority corrective RED

Rejected candidate `20ba3788f3433cc4baa6e3a117f315bd277457e5` /
tree `bca38448226863fb07b4d0aa63564573d1151f33` makes all prior fourteen
documentation contracts GREEN, but rollback still selects a prior digest from
the frozen release manifest alone. That bypasses the publication authority
introduced by the preceding correction.

One additional contract requires ADR 0029, roadmap and runbook to state that:

- application rollback selects a prior schema-compatible verified remote
  digest only from its prior immutable publication/deployment evidence;
- that evidence is bound to the corresponding frozen manifest through
  `frozenReleaseManifestSha256`;
- the frozen manifest supplies schema-compatibility metadata but is never pull
  authority;
- unpublished or unverified digests are forbidden, and missing/mismatched
  evidence blocks rollback;
- database schema rollback remains forward repair or restore to a new volume.

The previous fourteen tests remain unchanged controls. Recorded on the rejected
parent above:

- `npm run typecheck` and `git diff --check` — PASS;
- `node --test --test-reporter=dot
  tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs` — 15 tests:
  14 controls PASS and exactly one rollback-authority RED (`..............X`);
- nearest unchanged documentation contract
  `npm test -- tests/slice016-runbook.contract.test.ts --maxWorkers=1` — 1 file /
  3 tests PASS.

Candidate commit/tree are reported after commit. This tests/evidence-only
correction changes no canonical implementation, production, infra, dependency,
credential or network surface.
