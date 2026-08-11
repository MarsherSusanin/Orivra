# Slice 028B — Byte-preserving GHCR publication and DigitalOcean staging

Status: Local production-author GREEN; two independent code verifiers and
credentialed GHCR/staging execution are pending.

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

This RED performs no registry, SSH, DigitalOcean, DNS, Spaces, Coston2, Docker
or candidate-output effect. It does not select final GHCR repository names,
claim hosted staging, authorize production promotion, or run a canary. 029B
owns production promotion/canary after accepted 028B hosted evidence.

## Local GREEN evidence

- strict publication/staging contracts and pure handoff derivation are GREEN;
- the GHCR runtime verifies all five canonical OCI archives before registry
  I/O and the direct Distribution API adapter preserves manifest bytes/digest;
- credential environments retain only explicit file-backed least authority;
- staging orchestration fixes exact digest pulls, service/check order,
  append-only evidence and scoped cleanup through injected operator adapters;
- typecheck, focused 028B tests, contracts/domain 100% coverage, serialized
  deployment static, Action artifact sync, production build and Sites pass.

No GHCR request, DigitalOcean/SSH action or hosted smoke has run. A real 028B
PASS additionally requires the explicit five-repository target map, approved
credential files, two independent verifier reports on one exact implementation
tree and the resulting immutable publication/staging evidence.
