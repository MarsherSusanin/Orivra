# Slice 029D — Phase-ordered direct-production bootstrap

Status: Corrective Author GREEN after independent Core FAIL on c737113; independent reverification pending

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
  Web/Caddy → cutover/browser seal → cutover checkpoint → deployment evidence;
- runtime Compose contains exactly nine definitions with one additional
  hardened one-shot `replay-bootstrap`, not a ninth long-lived service;
- replay bootstrap is worker-owned, chain 114, manifest-bound, bounded and
  production-only; its API-authenticated exact Open-Meteo terminal run is the
  sole source of cross-bound persisted `/bundle` and `/preflight` bytes, while
  ordinary replay handlers are unavailable; no fixture, test adapter or
  generic worker bypass exists;
- both live manifest aliases are actually resolved before SIWE/API/RPC; the
  bootstrap claims only its submitted run, and foreign queued commands remain
  unavailable to the one-shot;
- actual bundle manifest/run and preflight run/canonical URL are verified
  before staging; invented metadata cannot stand in for exported bytes;
- the host alone owns the fixed mode-0700 UID/GID-1000 replay staging directory,
  rejects pre-existing/symlink paths and cleans only its owned path after
  success or failure;
- preserve the two public replay template SHAs and replay-keyed consumer
  registry; define exact submission-only Open-Meteo/ETH relayer SHAs for live
  effects and require a strict manifest/consumer-byte alias before RPC;
- phase-aware validation permits absence only before the corresponding
  producer and requires canonical mode-0400 regular inputs before every
  consumer;
- backup/replay/browser artifacts are no-follow, canonical, cross-bound,
  atomic and no-replace with zero final output on failure;
- the fixed selected backup handoff is immutable while daily backup-ID records
  remain append-only; the post-activation external browser adapter proves
  desktop/mobile, keyboard, axe, console/network and history restoration;
- that adapter sends canonical bytes/SHA only through exact host command
  `append-browser-acceptance`; the host publishes the fixed mode-0400
  no-replace pair under `/opt/orivra/evidence/browser/`, and its returned SHA
  binds canary plus mandatory V2 `cutover.browserAcceptanceSha256` before
  deployment evidence append; V1 remains unchanged;
- post-activation browser/evidence failure rolls Caddy back before session
  close and cannot publish deployment PASS.
- the phase-ordered path observes and canonically appends its real first
  `cutover` checkpoint before deployment evidence; that exact entry starts the
  resumable 15m/1h/24h chain;
- the resumable chain anchors every due time to the first `cutover.dueAt`,
  exactly equal to deployment activation, never to a later observation time;
  a mismatched first due time fails before any new observation or append;
- the fixed owned replay stage is bound by the host into the actual Compose
  environment with no ambient/default/caller path authority;
- every production host command executes the fixed `current` symlink through
  Node's preserved-main mode, and firewall activation accepts only the exact
  source-IP SSH plus Ubuntu-compatible Caddy `80/tcp` and `443/tcp` rules;
- the production-used browser adapter adds only root devDependency
  `playwright-core@1.62.1` through its exact lock graph; protected Sites bytes
  remain unchanged and any additional dependency or lock drift fails closed.

## Frozen RED and GREEN closure

1. retained 027A/027B Compose contracts require the exact nine-service model,
   replay one-shot hardening and worker dependency;
2. `slice029d-direct-production-bootstrap.contract.test.mjs` freezes seven
   static IDs, four absent outputs, exact phase grammar, consumer-phase input
   requirements, live worker+API replay result/export authority, early Compose
   aliases, production browser acceptance, atomic sealing and rollback;
3. existing ordinary-worker deep-validation tests remain unchanged controls;
4. current canonical docs revoke publication authority for the undeployable
   361bac3 images.
5. pure/deployment relayer-authority tests reject replay SHA as a live
   submission, raw relayer SHA as replay/registry authority and cross-source
   aliasing before the first RPC effect.
6. host/browser tests reject caller paths, old root-level browser files,
   noncanonical bytes, wrong origin or digest before append; post-activation
   append failure rolls Caddy back before pinned-session close and emits no
   deployment PASS.
7. the worker final image contains the freshly built replay-bootstrap entry at
   the exact Compose command path; host build output is never a runtime input.

The prior author GREEN is superseded by corrective RED for the missing initial
cutover checkpoint and fixed replay-stage Compose binding. No credential,
registry, server or provider effect is claimed by this correction.

The corrective implementation now records the strict host-observed `cutover`
checkpoint after browser evidence and before deployment evidence, and binds
the exact host-owned replay stage into Compose without a default or ambient
path. The correction is Author GREEN only until two independent verifiers pass
the exact final commit/tree.

## Exclusions

- no new public application endpoint or long-lived service;
- no test adapter in a production artifact;
- no new evidence kind unless implementation proves an existing canonical
  bundle/report/browser contract cannot represent the observation;
- no hosted, deployed, backup, PITR, Coston2 or browser PASS claim.
