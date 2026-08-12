# Slice 029C — Timeweb direct-production pilot

Status: Local production-author GREEN; exact commit and two independent verifiers pending

Decision: [ADR 0044](../adr/0044-timeweb-direct-production-pilot.md)

## Outcome

Deploy the published five-image Orivra release directly to the isolated
DigitalOcean production Compose project, use exact Timeweb S3 shared-pilot
authority, deterministically deploy both accepted safe consumers, cut Caddy
over explicitly and resume strict acceptance through a real 24-hour boundary.

## Vertical waves

### 029C1 — V2 pure authority

- retain V1 evidence schemas for historical parsing;
- add canonical V2 direct-pilot target/authorization/deployment/checkpoint/
  promotion/rollback contracts with no staging field;
- add strict Timeweb authority and exact ordered `SafeConsumerRegistryV1`;
- derive one recursively frozen five-digest direct-pilot plan.

### 029C2 — Typed deployment

- require eight exact typed preflight observations before provisioning;
- bind read-only GHCR to the ordered five published digest references,
  Timeweb to exact endpoint/region/bucket/path-style plus passed
  PUT/HEAD/LIST/GET/DELETE capability observations, and live Coston2 to chain
  114, canonical RPC/DA, public relayer address, decimal balance and configured
  authorization;
- keep five IDs/order/repositories fixed but derive digests/references from the
  newly authorized canonical publication; the old 028B fixture is parsing
  compatibility only;
- use the existing VDS only through pinned SSH, with no DigitalOcean API token;
- exclude the generated registry from input inventory, prove its fixed output
  path absent before deploy, then publish it atomically mode 0400/no-replace;
- preserve database-first composition and Caddy-only 80/443 ingress;
- deploy Open-Meteo then ETH/USD consumers deterministically and write the
  canonical worker registry before worker startup;
- extend retained runtime Compose to exactly eight services with one hardened
  one-shot deployer; use one canonical evidence root, root-seal its pair
  `root:root` mode 0400, create one SHA-identical worker-owned mode-0400
  runtime handoff, and add no ninth long-lived service;
- run the production-used deployer with pinned solc, official Coston2 registry
  imports, one mode-0400 relayer-key file, chain/balance checks, two receipts and
  two nonempty runtime-code observations; atomically publish registry plus
  deployment evidence with zero final registry on failure;
- stage deployment evidence after schema/readiness/heartbeat/Timeweb PITR and
  two persisted-live observations; publish only after Caddy cutover, external
  HTTPS observation and cutover checkpoint, with rollback and zero deployment
  PASS on any post-cutover failure.

### 029C3 — Explicit cutover and resumable acceptance

- invoke explicit Caddy cutover, external HTTPS and a real pinned-host cutover
  checkpoint observation before deployment evidence becomes authoritative;
  direct code cannot manufacture PASS checks;
- append 0/15m/1h/24h checkpoint evidence only when a trusted clock reaches
  each due time;
- include an exact production-host synchronization observation in every
  checkpoint and reject more than five seconds skew before append;
- resume from the exact canonical append-only prefix without skipping or
  replaying checkpoints;
- forbid terminal promotion before the full 86400 seconds;
- keep canonical rollback V2 binding and no-effect denials.
- install one root-owned hardened systemd oneshot/timer which uses only the host
  clock, writes the first missing due checkpoint mode 0400 and cannot publish an
  early terminal result; terminal output is canonical
  `ProductionPromotionEvidenceV2`, never a non-PASS test receipt.
- install a separate root-owned 02:00 UTC Timeweb full-backup oneshot/timer;
  accept only actual post-backup WAL switch/archive age at most 60 seconds, then
  authorize exact eight-full retention from current canonical backup evidence.

### 029C4 — Bounded VDS host runner

- decode one bounded strict canonical base64url command; expose no arbitrary
  shell, executable, service, path or environment authority;
- fix current/secrets/evidence roots, Compose project/files/phases and the
  ordered five immutable GHCR references;
- derive SSH firewall authority from `SSH_CONNECTION`, keep only Caddy 80/443
  public, stage Caddy without cutover until explicit activation, and retain one
  payload-free exact-state `rollback-caddy` command for post-cutover failure;
- enforce safe-consumer absent-to-mode-0400 lifecycle, fresh-volume Timeweb
  PITR, current heartbeat, exact two live runs and no-replace evidence/canary;
- parse and cross-bind the canonical safe-consumer registry/deployment bytes
  through bounded no-follow reads, return the exact direct-runtime envelopes,
  and return manifest/schema details from migrator rather than generic PASS;
- map internal pilot IDs to canonical `--command` host envelopes using the
  current verified five images and run ID; the credential-install marker is a
  local no-effect step;
- require checked-in import-safe PITR, persisted-live-run and typed canary
  observation entrypoints whose defaults execute the encrypted fresh-volume
  restore, worker-container API-persisted two-run gate and due host checks;
- return only strict typed results and bounded redacted failure codes.

## Frozen RED

1. `packages/contracts/test/slice029c-timeweb-direct-production-pilot.contract.test.ts`
   freezes V1/V2 coexistence, exact Timeweb/shared-pilot authority, exact two
   manifest/address registry and the four-checkpoint 24-hour grammar.
2. `packages/domain/test/slice029c-timeweb-direct-production-pilot.contract.test.ts`
   freezes canonical/checksummed private V2 authority, exact five-image plan,
   typed preflights, worker registry path and staging-free inputs.
3. `tests/deployment/slice029c-timeweb-direct-production-pilot.contract.test.mjs`
   causally rejects generic preflight success, freezes deterministic consumer
   deployment/Caddy cutover order and proves trusted-clock resume cannot PASS
   early through import-safe injected adapters.
4. `tests/deployment/slice029c-production-effect-seams.contract.test.mjs`
   freezes the production-used safe-consumer deployer, strict evidence pair,
   file-only CLI boundary and root-owned systemd resume path. Compiler, chain,
   balance, receipt, code, duplicate-address, path/mode/symlink, clock-skew and
   atomic-append failures remain credential-free injected cases.
5. Retained 027A/027B deployment tests freeze the eight-service Compose
   inventory and two-phase safe-consumer evidence lifecycle.
6. `tests/deployment/slice029c-timeweb-production-host-command.contract.test.mjs`
   freezes the production-used SSH host command in 13 credential-free causal
   cases without invoking a shell, Docker, provider or live network.
7. `tests/deployment/slice029c-timeweb-production-adapter-effects.contract.test.mjs`
   freezes canonical internal-to-host mapping and the three concrete
   production observation entrypoints in five credential-free causal cases.
8. `tests/deployment/slice029c-production-default-effects.contract.test.mjs`
   freezes the executable worker/API live gate, encrypted fresh-volume Timeweb
   restore/cleanup and real trusted-clock canary defaults. Direct-pilot,
   host-command and retained 027A/027B cases freeze the real cutover observation
   and root-only canonical pair plus byte-identical non-root worker handoff.

## Gates

The final production-author tree passes typecheck; the focused 029C deployment
inventory (33/33); serialized deployment static (256/256); contracts/domain
coverage (57 files, 661 tests, 100% statements/branches/functions/lines); the
full Vitest inventory (264 files and 2558 tests, with only five/43 configured
skips); backend coverage (92.03% lines/87.08% branches); worker coverage
(91.39%/86.22%); Web coverage (92.57%/85.91%); real Testcontainers PostgreSQL
(22 files/163 tests, zero skips); build, Sites (46/46) and Action byte-sync.
Credential-free 027A/027B/027C Docker controls also remain required on the
committed identity before verifier handoff.

## Exclusions

- no credential value, deadline, DNS, SSH, provider, registry or live effect
  was used by the local author matrix;
- no Swift runtime and no MinIO production authority;
- no hosted, deployed, Timeweb backup/PITR, safe-consumer, cutover or 24-hour
  PASS is claimed before the credentialed acceptance wave.
