# Slice 028B — Byte-preserving GHCR publication and DigitalOcean staging

Status: Core and Product independently PASS exact commit
`70f63cb0c4fac0c7661cb734896575be07edfa70` / tree
`88ec38335ab9630e1fd8c4d5247101bd046f06eb`; credentialed publication and
staging effects remain pending.

Architecture authority: [ADR 0042](../adr/0042-byte-preserving-ghcr-publication-and-digitalocean-staging.md).

## Outcome

An explicitly authorized operator publishes the exact frozen 029A OCI image
manifests/blobs to explicit GHCR repositories without rebuild or conversion,
records immutable publication evidence, and deploys only an isolated
DigitalOcean staging environment from those exact remote digests.

## Frozen vertical split

### 028B1 — Publication contracts and pure verification

- strict `GhcrPublicationTargetsV1`, `PublicationEvidenceV1` and
  `StagingDeploymentEvidenceV1` canonical contracts;
- exact 029A candidate/manifest/receipt/two-verifier binding;
- exact ordered five-image mapping and remote digest equality to
  `imageManifestDigest`, never `archiveSha256`;
- separate checksums for target, publication and staging records.

### 028B2 — GHCR adapter and append-only publication

- all archives stream-verified before registry I/O;
- bounded safe OCI entry/descriptor/blob inspection;
- explicit manifest+blob copy adapter, no rebuild/repack/index conversion;
- remote digest verification and conditional-create publication evidence;
- redacted partial report plus exact-scoped cleanup on failure.

### 028B3 — DigitalOcean staging

- file-only least-authority credentials and pinned SSH host key;
- explicit read-only pull of five publication-authorized digest references;
- isolated staging project/volumes/secrets/origin and fixed start order;
- migration/readiness/real heartbeat/browser/PITR/live staging checks;
- separate append-only staging evidence and no production/canary authority.

## RED files

- `packages/contracts/test/slice028b-publication.contract.test.ts`
- `packages/domain/test/slice028b-publication-evidence.contract.test.ts`
- `tests/deployment/slice028b-ghcr-publication.contract.test.mjs`
- `tests/deployment/slice028b-digitalocean-staging.contract.test.mjs`
- retained `apps/worker/test/slice009-production-worker-purity.contract.test.ts`

## Explicit exclusions

The selected GHCR mapping is recorded in the runbook. One credentialed registry
attempt reached the first Caddy blob and failed closed because GitHub Container
Registry does not accept a fine-grained PAT as package-write authority. It
published zero accepted image IDs, wrote no publication evidence and never
started staging. This slice does not claim hosted staging, authorize production
promotion, or run a canary. 029B owns production promotion/canary after accepted
028B hosted evidence.

## Local GREEN evidence

- strict publication/staging contracts and pure handoff derivation are GREEN;
- the GHCR runtime verifies all five canonical OCI archives before registry
  I/O and the direct Distribution API adapter preserves manifest bytes/digest;
- credential environments retain only explicit file-backed least authority;
- staging orchestration fixes exact digest pulls, service/check order,
  append-only evidence and scoped cleanup through injected operator adapters;
- typecheck, focused 028B tests, contracts/domain 100% coverage, serialized
  deployment static and Sites pass;
- the five frozen 029A OCI archives pass the single-descriptor parser and exact
  manifest-digest revalidation without registry or external network access.

Core report `/private/tmp/proofline-028b-verifiers/70f63cb/core-verifier.md` has
SHA-256 `8d4175ccad0e19ae5333ad35a4d3edb55204195a6688eee3d13c8d9962f4a38c`.
Product report `/private/tmp/proofline-028b-verifiers/70f63cb/product-verifier.md`
has SHA-256
`f657d9010728ce2e19d8f2cb373daf6e8a4c32dfc26144c786d2c595c4204df6`.
Both cover the same exact implementation tree. A real hosted 028B PASS still
requires the approved package-write/package-read credentials and resulting
immutable publication/staging evidence.

## Corrective verifier boundary

Core rejected the first implementation because a shallow publication object
could authorize staging and false observations could yield schema-invalid PASS
bytes; the publication verifier also accepted canonical manifest substitution,
the SSH pin was unused, and archive bytes were reopened and retained outside
their authenticated identity. Corrective RED now requires canonical handoff
bytes/checksum and transitive binding, exact typed observations and strict
staging evidence, one enforced pinned SSH session, and a bounded single-
descriptor archive lease. No credentialed execution is allowed before the
replacement receives both independent PASS reports.

The replacement also rejects registry upload redirects outside default-port
443 and the exact same-repository upload namespace before bearer/body send,
removes raw-object publication-to-staging chaining, and separates always-run
local/session cleanup from failure-only staging teardown.

Core then rejected exact `7c2ca21` / `34a5751`: the strict handoff verifier
returned the caller-owned mutable evidence object, so an async provision seam
could replace a repository/reference before pull and PASS. Corrective RED now
requires one private schema-parsed, deeply immutable authority derived only
from canonical evidence bytes; post-verification caller mutation cannot reach
commands or evidence and otherwise fails before pull/PASS.

The next replacement closed that evidence alias but Core rejected exact
`be3270c` / `0c12d82`: caller-owned target/run objects remained mutable across
provisioning, allowing a production-like Compose project and new SSH pin to
reach all command seams. The production-author replacement creates private
strict snapshots of both target and run before the first await and uses them
exclusively for every adapter, command and evidence field.

Core then rejected exact `9cb839f` / `fcd0d75`: after canonical PASS evidence
and pinned-session close, an omitted explicit local closer let legacy generic
`cleanup` destroy the successful owned staging resource while returning PASS.
Corrective RED requires zero generic cleanup/teardown calls on success;
failure-only teardown remains run-owned and preserves deterministic
original-then-cleanup error ordering.

The production-author replacement removes the success-path generic finalizer.
Successful staging closes only its pinned session and an explicit local closer;
failure-only run-owned teardown and deterministic error aggregation are
unchanged.
