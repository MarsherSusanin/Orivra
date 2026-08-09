# Proofline product roadmap

The product journey is delivered as independently frozen vertical slices:

`Runs → Manifest → Preflight → Submission → Lifecycle → Consumer Lab → Evidence handoff`

## Status

| Slice | Outcome | Status |
|---|---|---|
| 014 | Honest routing and persisted run discovery | Complete |
| 015 | Four-step manifest Composer and recoverable local draft | Complete |
| 016 | Persisted preflight evidence and decision Workbench | Complete; independently verified |
| 017A | Manifest-owned submission decision and confirmation evidence | Complete; independently verified |
| 017B | Wallet, relayer and replay confirmation through one persisted path | Complete; independently verified |
| 018 | Restart-safe waiting, retry and terminal recovery semantics | Complete; independently verified |
| 019 | Consumer evidence matrix and deterministic safe artifact | Complete; independently verified in the final handoff journey |
| 020 | Evidence receipt, integration package and read-only handoff | Complete; independently verified |
| 021B | Deterministic local product QA report | Complete; independently verified |
| 022 | Network capability boundary | Complete; independently verified |
| 023 | Wallet identity and self-service access | In progress through small focused waves |
| 024A | Honest canonical URL attack recording contracts and recorder | Second corrective GREEN candidate; independent verification pending, credential-free |
| 024B | Persisted/public canonical URL attack presentation | Planned, credential-free; must remain unavailable without real evidence |
| 025 | Template-led Composer | Planned, credential-free |
| 026 | Public product surface | Planned, credential-free |
| 027A | Local Docker runtime, Compose/Caddy routing and private service networks | Planned, credential-free |
| 027B | One-shot migrations, health/readiness, worker heartbeat and retention | Planned, credential-free |
| 027C | WAL/base-backup PITR and local MinIO restore drill | Planned, credential-free |
| 028A | Verified local OCI archives and frozen digest manifest | Planned, credential-free |
| 028B | Byte-preserving GHCR publication and DigitalOcean staging | Blocked until unified local candidate PASS |
| 029A | Local MLP validation and candidate freeze | Planned, credential-free |
| 029B | Exact-digest production promotion and seven-day canary | Blocked until 028B hosted evidence |

## Completed pre-infrastructure product journey

The roadmap now delivers one coherent local and persisted journey from run
discovery through evidence handoff:

- recovery distinguishes waiting, same-command retry and terminal new-run
  outcomes without rebroadcast after a recorded transaction hash;
- Consumer Lab persists exact invariant evidence and deterministic safe Solidity
  bytes;
- Integration Package binds receipt, bundle, manifest and generated consumer,
  then hands them to a read-only fragment share recipient;
- local product reporting reduces bounded privacy-safe events into a strict
  aggregate-only `ProductQaReportV1` with deterministic canonical bytes.

No external analytics provider, deployment automation or live-infrastructure
PASS is part of these slices.

## MLP implementation and infrastructure roadmap

[ADR 0029](../adr/0029-digitalocean-vds-deployment.md) selects the deployment
target without provisioning it. One DigitalOcean Droplet/VDS will use Docker
Compose to run Web, API, worker and PostgreSQL behind Caddy with same-origin
`/api`. Sites remains compatibility-only. Hosting is not yet provisioned and
the repository has no current hosted or deployed PASS.

Credential-free delivery covers 022–029A:

- **027A** packages the local and VDS Docker runtime, Caddy/Web routing,
  private Compose networks and a persistent PostgreSQL volume. Public exposure
  is limited to 80/443; SSH is restricted, while 5432, API/worker host ports
  and the Docker socket remain private.
- **027B** adds a one-shot checksummed migration runner under a PostgreSQL
  advisory lock, exact schema verification, `/healthz`, `/readyz`, a worker
  heartbeat and retention behavior.
- **027C** adds off-host WAL archiving plus base backup for PITR and proves a
  credential-free MinIO restore drill. A Droplet backup is secondary host
  recovery, not database/PITR evidence.
- **028A local release truth** builds and exports OCI archives, then must verify them.
  The frozen release manifest stores per-image `archiveSha256`,
  `imageManifestDigest`, `platform` and `repository`/`reference` fields.
  `archiveSha256` covers exact OCI archive bytes and is distinct from
  `imageManifestDigest`, which identifies the OCI image manifest or index. The
  frozen release manifest binds commit and tree; its canonical JSON has its own
  SHA-256 checksum, `frozenReleaseManifestSha256`. 028A runs without registry
  or GHCR credentials and with no registry access, external network or push.

**029A is the credential-free local MLP validation and freeze.** Product gates
and user testing use recorded fixtures through local Docker Compose. 029A runs
with no credentials and no external network. The whole 022–029A range remains
credential-free.

After all 022–029A credential-free modules are implemented, one unified local
full matrix runs once. Two independent verifiers then sign the same tree hash.
The release requires two independent PASS reports for the same tree hash.
Credentials are requested only after that full matrix and both PASS reports.
Credentials for DNS, SSH and Spaces are issued strictly only after 022–029A;
the same applies to DigitalOcean, GHCR pull and live Coston2 configuration.

- **028B credential gate** is credentialed and starts only after the unified
  matrix and two PASS reports. It performs byte-preserving load/copy/push of
  exact OCI archive bytes. It verifies `archiveSha256` before load/copy/push
  publication; an `archiveSha256` mismatch aborts. It copies and pushes with no rebuild.
  The GHCR remote image digest only matches `imageManifestDigest`;
  never compare the remote digest with `archiveSha256`. An
  `imageManifestDigest` mismatch aborts before staging pull. Digest mismatch aborts.

  Publication/deployment evidence is a separate external record, immutable and
  append-only. Publication/deployment evidence contains
  `frozenReleaseManifestSha256`, commit, tree, remote repositories and remote
  digests, timestamp, operator and run ID. Publication evidence does not mutate frozen release manifest,
  does not mutate candidate tree and does not mutate image bytes. The VDS pulls only a verified remote digest
  that publication evidence binds through
  `frozenReleaseManifestSha256`; its GHCR pull credential is read-only. It may
  then provision isolated staging, run migrations, hosted browser smoke,
  restore drill and the persisted live Coston2 gate.

  Application rollback selects only a prior schema-compatible verified remote digest
  from its prior immutable publication/deployment evidence. That prior
  publication/deployment evidence binds the digest to the corresponding
  `frozenReleaseManifestSha256`. The frozen release manifest supplies schema compatibility metadata
  and is never pull authority. An unpublished digest is forbidden for rollback;
  an unverified digest is forbidden. Evidence mismatch blocks rollback, and
  missing publication/deployment evidence blocks rollback.
- **029B is the credentialed production promotion and canary.** 029B starts
  only after 028B has published and staged the exact frozen candidate. It
  records schema/backup/readiness evidence and runs the seven-day canary. A code
  change returns the plan to focused RED/GREEN and requires a new unified
  matrix and two-PASS freeze before another credentialed deployment.

## Validation policy

Each module above retains strict focused TDD: frozen RED, nearest baseline,
GREEN core/surfaces, affected coverage and targeted verification. Those
targeted reviews are not release PASS reports. The full/unified repository
matrix runs once after all credential-free 022–029A modules, not after every
small edit. A release candidate exists only after that matrix and two
independent PASS reports on one exact tree hash. See
`docs/development/roles.md` and `docs/runbook.md` for the exact cadence.

Slice 017 passed both independent verification roles on commit
`57099232f957123f11574e8137948de1467d1d6d` and tree
`3d99a54a249648781f63afb8519074b1b92c38a1`. Slice 020, including the complete
Consumer Lab handoff, passed both roles on commit
`24957228b59b32f0df2d77b902cd177af0489c4b` and tree
`e2813a3eafec08b28f3b88f780e33a5ca1b91e28`. Slice 021B passed both roles on
commit `b91b4da15bbbc3695fa6b83285652c90841383ea` and tree
`13384b721308a1e1a04319c0391679741fb01760`.
