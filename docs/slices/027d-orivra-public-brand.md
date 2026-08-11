# Slice 027D — Orivra public display brand

Status: Intentional RED; contracts and documentation frozen; production absent.

Architecture authority: [ADR 0038](../adr/0038-orivra-public-brand.md).

## Outcome

Every current public Web, wallet-signing, CLI and GitHub Action surface presents
the product as Orivra, while the exact Proofline technical compatibility
allowlist remains unchanged. Historical documentation/evidence is not rewritten.

Accepted prerequisite: Slice 027C Core and Product verifiers independently PASS
exact commit `8137970091197160c3d002084a2b778a4d262034` / tree
`8c594cc58820670aba66e7b3cbd6f1f818420a19`. Scan 8852 was user-canceled and
is not a security PASS; deferred handoff inventory-digest validation remains
open. This is local credential-free evidence only.

## Delivery split

### 027D1 — Web, metadata and wallet signing

- replace public Web display copy and accessibility names with exact `Orivra`;
- add the bounded local `src/assets/orivra-mark.svg` seam and exact HTML
  metadata without remote asset work;
- issue only the exact Orivra EIP-4361 sentence;
- reject exact or near-legacy Proofline challenges before recovery/session
  effects; preserve the five-minute TTL and durable consume-first boundary;
- preserve routes, URL state, storage keys, packages, schemas and API payloads.

### 027D2 — CLI, Action and generated artifacts

- update CLI headings/errors while retaining `proofline` bin and Usage grammar;
- update Action metadata/summaries/errors while retaining all input, default,
  environment and artifact IDs;
- regenerate Action dist only from source and require byte-identical sync;
- build Web/Sites so generated HTML/assets carry Orivra without changing the
  protected Sites worker/hosting/package preparation sources.

### 027D3 — verification and freeze

- affected coverage: API/CLI/Action at least 90% lines/85% branches, Web at
  least 85%/80%;
- Action artifact sync, root build and Sites compatibility;
- desktop 1488×1058 and mobile 390×844 browser acceptance across landing,
  Runs, Composer, demo, Settings and unknown route;
- keyboard/focus, axe zero serious/critical, clean console/network and
  reload/back/forward;
- exact metadata/icon and no external brand-asset request;
- two different read-only verifier PASS reports for one stopped commit/tree.

## Frozen boundaries

- Public display token is exact `Orivra`; old `Proofline` product copy is RED.
- The complete compatibility allowlist in ADR 0038 cannot be renamed or
  aliased by this slice.
- SIWE compatibility is fail-closed, not dual-branded: old challenges are
  consumed/unavailable and the user requests a new challenge.
- No schema, migration, endpoint, package export, dependency, Docker/Compose,
  S3, evidence-kind or credential boundary changes.
- No production assets or generated dist are authored by the RED wave.
- 027D completes before 028A freezes OCI release inputs.

## Scope exclusions

No legal/company/domain rename, package publication, database migration,
environment migration, historical-doc rewrite, DNS/SSH/DigitalOcean/GHCR/
Spaces operation, Docker gate, live Coston2 effect or hosted claim is part of
027D.
