# Proofline development roles

Every small vertical slice follows one evidence-producing cycle:

`Slice Contract / ADR → RED → GREEN core → GREEN surfaces → refactor → targeted code verification → targeted product verification`

## Roles

| Role | Responsibility | Required artifact |
|---|---|---|
| Proofline Slice Architect | Scope, dependencies, risk class, ADR impact and acceptance criteria | Slice Contract |
| Contract & Test Designer | Public schema plus intentional failing contract, migration and acceptance tests | Frozen RED tests and RED evidence |
| FDC Run Core Implementer | Minimum deterministic state machine, diagnostics, replay, codegen and ports | GREEN core |
| Surface & Adapter Implementer | Web/API/worker/PostgreSQL/FDC/wallet/CLI/Action/Sites compatibility and Docker/VDS integration | GREEN surfaces |
| Core Code Verifier | Read-only review of correctness, determinism, SSRF, relayer, idempotency and edge cases | PASS or findings |
| Product Integration Verifier | Black-box Web/API/CLI/Action/package/live Coston2 verification | PASS or findings with browser/CLI/live evidence |

The root coordinator acts as Slice Architect. Other roles use independent agents when the slice requires code changes.

## Wave rules

- One writer owns the shared tree during a wave; read-only audits may run in parallel.
- Contract/Test Designer demonstrates the expected RED reason and freezes those tests before implementation.
- Core implementation reaches GREEN without introducing surface-specific I/O.
- Surface implementation connects the same public contracts; it does not create an alternate lifecycle.
- Refactor may improve structure but cannot change frozen acceptance contracts.
- Record the module commit and tree hash before either targeted verification wave.
- Production authors cannot act as either verifier. The two verifiers must be different agents.
- Verifiers inspect the exact same tree and report findings; they do not patch production code.
- Any production edit after either targeted review invalidates both module
  reviews and starts a new module snapshot.
- Module reviews may run in parallel after the writer stops, but they are not
  release PASS reports. A release candidate is frozen only at the unified gate
  described below.

## Validation cadence

TDD uses the smallest test loop that can prove the current state. A full
repository matrix is a candidate-freeze gate, not an inner-loop command:

| Moment | Required validation |
|---|---|
| RED | New frozen tests plus the nearest unchanged baseline; record the exact expected failure reason |
| GREEN core | Focused contracts/domain/package tests for the changed core and its direct dependants |
| GREEN surfaces | Focused acceptance tests, `npm run typecheck`, and the affected Web/API/worker/CLI/Action package matrix |
| Refactor / wave commit | Affected regression suite and affected coverage threshold |
| Module handoff | Targeted affected regression and affected coverage; two independent read-only reviews of the same module tree hash |
| Unified candidate freeze | Once after all credential-free 022–029A modules: the complete hermetic, coverage, PostgreSQL, Solidity, E2E, build, Sites compatibility and Docker matrix from `docs/runbook.md` |
| Release verification | Two independent verifiers recheck the same frozen tree hash; Product Verification additionally performs the affected black-box browser/CLI/Action journey |

When a change crosses public contracts, package boundaries, migrations,
authentication, journal/replay semantics, workspace build configuration,
Action artifacts, Sites behavior or ADR 0029 deployment boundaries, run all
affected tests immediately. Do not run the unrelated full repository after
every edit. The unified full matrix runs once after the credential-free modules
022–029A are complete. Both independent release verifiers must PASS that same
tree hash before credentials authorize 028B.

For ADR 0035 container work, a static YAML or Dockerfile regex is not sufficient
release evidence. The Surface & Adapter Implementer must record semantic
Compose configuration, fresh image contents, the controlled no-network repeat,
private network/port inspection and exact Caddy/Web black-box routing. Prefetch
evidence also proves fresh no-auth Docker CLI configuration and cleanup with a
fake runner; it may not infer daemon-global credential state. Production
Compose evidence begins at the immutable-reference validator/wrapper, not a
direct YAML invocation. QA must prove one exact HTTPS Caddy/API origin and both
allowed and hostile CORS preflights. Until 027B, neither `pg_isready`, a DB-free
API response nor a running container may be described as application readiness;
027A QA must not start the live worker.

DNS, restricted SSH, DigitalOcean, GHCR pull, Spaces and live Coston2
credentials remain unavailable during module development. They are requested
only after the unified matrix and both independent PASS reports. A credentialed
host check cannot substitute for missing local evidence, and a local PASS cannot
be described as hosted or deployed.

028A is the local release composition. It exports verified OCI archives and a
frozen manifest with distinct per-image `archiveSha256`,
`imageManifestDigest`, platform and repository/reference fields. ADR 0039
freezes exactly five ordered Linux/amd64 archives, one clean private producer
snapshot, a caller-supplied use-time verified WAL-G context, deterministic OCI
layout packaging and an atomic non-circular receipt. Its module gate never
prefetches, pulls, pushes or reaches a registry. 029A is the
credential-free local MLP validation and freeze. Product gates and user testing
use recorded fixtures through local Docker Compose. 029A runs with no
credentials and no external network; the whole 022–029A range remains
credential-free.

028B is credentialed and starts only after the unified matrix and two PASS
reports. It verifies exact frozen OCI archive bytes against `archiveSha256`
before publication, then load/copy/pushes them to GHCR with no rebuild. The
remote image digest matches only `imageManifestDigest`; never compare
the remote digest with `archiveSha256`.

Publication/deployment evidence is separate, immutable and append-only. It
contains `frozenReleaseManifestSha256`; it does not mutate frozen release manifest,
candidate tree or image bytes. The VDS pulls only a verified remote digest
bound by that publication evidence. 029B is the credentialed production
promotion and canary, only after 028B has published and staged that candidate.

ADR 0042 assigns 028B effects to a credentialed release operator only after
the accepted 029A candidate and both independent reports are revalidated. The
operator supplies a canonical explicit five-image GHCR target map; neither the
Git remote nor local archive names imply registry authority. A registry adapter
must preserve each single-manifest digest and may not build, repack, retag to a
mutable reference or convert media types. Staging uses a distinct read-only
pull credential and an isolated DigitalOcean project. Publication evidence and
staging evidence are separate append-only records; neither is production
promotion authority, which remains 029B.

Rollback verification must prove that a prior schema-compatible verified
remote digest is present in immutable publication/deployment evidence bound to
its `frozenReleaseManifestSha256`. The release manifest provides compatibility
metadata, never pull authority; missing, mismatched or unpublished evidence
blocks rollback, as does any unverified digest.

## Slice Contract minimum

Each Slice Contract names:

- user-visible outcome and explicitly excluded scope;
- affected public schemas/endpoints/events;
- dependency and ADR impact;
- security and data-migration risk class;
- intentional RED tests and expected failure reason;
- hermetic, PostgreSQL, Solidity, browser, Sites compatibility, Docker or live acceptance gates as applicable;
- evidence required from each verifier.

## Verification baseline

Core verification checks deterministic replay, event ordering, terminal immutability, checksum mutation detection, normalized errors, safe fetch boundaries, relayer authorization and duplicate/restart behavior.

Product integration verification checks the minimal user journey across all
affected surfaces, reload persistence, export/reparse, keyboard/accessibility,
clean console/network, package contents, Sites compatibility routing and—after
the [ADR 0029](../adr/0029-digitalocean-vds-deployment.md) credential gate—the
Docker VDS and persisted Coston2 gates. Commands and environment boundaries are
defined in `docs/runbook.md`.
