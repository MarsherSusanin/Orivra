# Slice 029C — Timeweb direct-production pilot

Status: Intentional RED after Product rejection of `99918ab` / `a24d08a`

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
- use the existing VDS only through pinned SSH, with no DigitalOcean API token;
- exclude the generated registry from input inventory, prove its fixed output
  path absent before deploy, then publish it atomically mode 0400/no-replace;
- preserve database-first composition and Caddy-only 80/443 ingress;
- deploy Open-Meteo then ETH/USD consumers deterministically and write the
  canonical worker registry before worker startup;
- run the production-used deployer with pinned solc, official Coston2 registry
  imports, one mode-0400 relayer-key file, chain/balance checks, two receipts and
  two nonempty runtime-code observations; atomically publish registry plus
  deployment evidence with zero final registry on failure;
- append deployment evidence only after schema/readiness/heartbeat/Timeweb
  PITR and two persisted-live observations pass.

### 029C3 — Explicit cutover and resumable acceptance

- invoke an explicit Caddy cutover adapter after deployment evidence;
- append 0/15m/1h/24h checkpoint evidence only when a trusted clock reaches
  each due time;
- resume from the exact canonical append-only prefix without skipping or
  replaying checkpoints;
- forbid terminal promotion before the full 86400 seconds;
- keep canonical rollback V2 binding and no-effect denials.
- install one root-owned hardened systemd oneshot/timer which uses only the host
  clock, writes the first missing due checkpoint mode 0400 and cannot publish an
  early terminal result.

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

## Gates

RED runs typecheck, the three focused files plus retained 029B and Slice009
purity controls, serialized deployment static and Sites compatibility. The
expected failures are absent V2 schemas/domain methods/runtime entrypoints;
retained V1 rollback and production controls remain GREEN.

## Exclusions

- no production/dependency/lock/Compose/Docker/generated Sites edit;
- no credential value, deadline, DNS, SSH, provider, registry or live effect;
- no Swift runtime and no MinIO production authority;
- no hosted, deployed, backup/PITR, safe-consumer, cutover or 24-hour PASS.
