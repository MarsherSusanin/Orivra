# Slice 029D — Phase-ordered direct-production bootstrap

Status: Intentional RED on exact `361bac3` / `fe8e771`

Decision: [ADR 0045](../adr/0045-phase-ordered-direct-production-bootstrap.md)

## Outcome

Make the direct pilot bootstrappable from an empty production evidence root
without weakening worker replay validation, Timeweb recovery, browser
acceptance or rollback authority.

## Frozen boundary

- static preflight treats backup, replay and browser files as absent intended
  outputs and never reads them;
- exact phase order is database/API → consumer seal → first backup/WAL/PITR/
  retention → replay bootstrap/seal → ordinary worker/two live runs → private
  Web/Caddy → cutover/browser seal → deployment evidence;
- runtime Compose contains exactly nine definitions with one additional
  hardened one-shot `replay-bootstrap`, not a ninth long-lived service;
- replay bootstrap is worker-owned, chain 114, manifest-bound, bounded and
  production-only; its API-authenticated exact Open-Meteo terminal run is the
  sole source of cross-bound persisted `/bundle` and `/preflight` bytes, while
  ordinary replay handlers are unavailable; no fixture, test adapter or
  generic worker bypass exists;
- phase-aware validation permits absence only before the corresponding
  producer and requires canonical mode-0400 regular inputs before every
  consumer;
- backup/replay/browser artifacts are no-follow, canonical, cross-bound,
  atomic and no-replace with zero final output on failure;
- the fixed selected backup handoff is immutable while daily backup-ID records
  remain append-only; the post-activation external browser adapter proves
  desktop/mobile, keyboard, axe, console/network and history restoration;
- post-activation browser/evidence failure rolls Caddy back before session
  close and cannot publish deployment PASS.

## Intentional RED

1. retained 027A/027B Compose contracts require the exact nine-service model,
   replay one-shot hardening and worker dependency;
2. `slice029d-direct-production-bootstrap.contract.test.mjs` freezes seven
   static IDs, four absent outputs, exact phase grammar, consumer-phase input
   requirements, live worker+API replay result/export authority, early Compose
   aliases, production browser acceptance, atomic sealing and rollback;
3. existing ordinary-worker deep-validation tests remain unchanged controls;
4. current canonical docs revoke publication authority for the undeployable
   361bac3 images.

Expected RED is missing `replay-bootstrap` Compose/runtime production and the
new import-safe bootstrap lifecycle. No credential, Docker, network, server or
provider effect is part of this slice.

## Exclusions

- no new public application endpoint or long-lived service;
- no test adapter in a production artifact;
- no new evidence kind unless implementation proves an existing canonical
  bundle/report/browser contract cannot represent the observation;
- no hosted, deployed, backup, PITR, Coston2 or browser PASS claim.
