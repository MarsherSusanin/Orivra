# ADR 0044: Timeweb direct-production pilot and resumable 24-hour acceptance

- Status: Accepted contract; intentional RED
- Date: 2026-08-12
- Supersedes active production portions of: ADR 0037, ADR 0042, ADR 0043
- Retains: all V1 schemas as historical compatibility data types

## Context

The five immutable GHCR images are published under canonical
`PublicationEvidenceV1` SHA-256
`1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`.
There is no accepted staging deployment. The pilot therefore deploys that
published release directly to the existing DigitalOcean VDS production
boundary; it does not fabricate staging evidence.

Product verification rejected exact candidate
`99918ab43c2186286f8fd0f116dcff6e13f7aba6` / tree
`a24d08a47fb30a30edc1eeb3c5511c55e00fde8b`. It accepted generic
`{status:"passed"}` preflight objects and could create purported seven-day
terminal evidence immediately from caller-selected future timestamps. Report
`/private/tmp/proofline-029b-verifiers/99918ab/product-verifier.md` has SHA-256
`2186ed3400ac917409f26c2fde6653d9a70dd8b6dd015233970ba32e0811ead9`.

The pilot object store is Timeweb S3-compatible storage. Swift is an operator
option outside the application runtime, not a release dependency.

## Decision

### Versioned direct authority

ADR 0044 adds strict V2 production target, authorization, deployment,
checkpoint, promotion and rollback contracts. V1 schemas remain exported for
historical evidence parsing but cannot authorize the V2 effect.

V2 consumes canonical publication bytes plus independent checksum, canonical
production target, Timeweb authority and authorization bytes plus their
independent checksums. It contains `deploymentMode: "direct-pilot"` and no
staging-evidence field. Unknown fields, object-only input and caller mutation
after verification fail before effect.

The compute target remains one DigitalOcean VDS with Caddy-only public ports
80/443 and private API, worker and PostgreSQL networks. The exact five ordered
GHCR digest references remain unchanged.

### Timeweb shared-pilot storage

`TimewebS3PilotAuthorityV1` is exact:

- provider `timeweb-s3`;
- endpoint `https://s3.twcstorage.ru`, region `ru-1`, bucket
  `orivra-backet`, path-style addressing enabled;
- `authorityMode: "shared-pilot"` and secret-file credential delivery;
- MinIO is QA-only and Swift is absent from runtime.

The shared authority is an explicit bounded pilot exception to ADR 0037's
separate object-store identities. It is never presented as least-privilege
production storage. No credential value, key ID, rotation deadline or secret
path enters canonical evidence. Rotation/separation is required before this
pilot can become a general production profile. Existing ADR0037
DigitalOcean-Spaces `BackupEvidenceV1` remains historical; V2 deployment
evidence records the Timeweb authority checksum and typed PITR observation.

### Strict typed preflight

Before provisioning, eight strict observations must pass in fixed order:
DNS target; expected/observed SSH pin; read-only GHCR; exact file inventory
without exposed values; Timeweb authority checksum and shared-pilot mode;
replay bundle/report digests; exact two-manifest safe-consumer plan; and chain
114 live Coston2 configuration. Every observation has exact version, kind,
check ID and fields. Generic status, missing/extra fields or mismatch returns
`PRODUCTION_PREFLIGHT_INVALID` with zero host/evidence effect.

### Exact two-consumer registry

`SafeConsumerRegistryV1` contains exactly two ordered entries:

1. `open-meteo-current-weather`, revision 1, manifest SHA-256
   `sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8`;
2. `eth-usd`, revision 1, manifest SHA-256
   `sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db`.

The deterministic deploy seam consumes those manifests in order and returns
two distinct non-zero Coston2 addresses. It writes canonical mode-0400
`/opt/orivra/evidence/safe-consumer-registry.v1.json` before the real worker
starts. Worker selection is by manifest SHA through that file; one global safe
consumer address is forbidden. Partial deployment writes neither registry nor
deployment PASS.

### Database, cutover and 24-hour acceptance

Order is PostgreSQL, role bootstrap, checksummed migrator, API, deterministic
two-consumer deploy, registry write, real worker, Web and candidate Caddy.
Deployment evidence V2 binds publication, target, authorization, Timeweb
authority, exact five images, exact registry, schema 10, readiness, real
heartbeat, Timeweb PITR and both persisted live runs.

Caddy cutover is an explicit adapter effect after deployment evidence append.
It returns strict origin and trusted activation time; assigning a boolean is
not cutover evidence.

The resumable append-only canary has exactly `cutover`,
`post-cutover-15m`, `post-cutover-1h`, `post-cutover-24h`. Each checkpoint is
run only when a trusted injected clock reaches its due time, records strict
health, readiness, current heartbeat, backup/archive freshness, disk,
browser and both persisted-live results, and is conditionally appended. A
restart validates the canonical accepted prefix and executes only the first
missing due checkpoint. Gaps, duplicates, substitution, an early trusted time
or an echoed caller time fail closed. Terminal V2 PASS is impossible before
86400 elapsed seconds and all four accepted checkpoints.

### Rollback V2

Rollback retains the canonical current/prior deployment and publication byte
bindings from the corrected implementation. `ApplicationRollbackAuthorizationV2`
binds the exact V2 deployment/publication identities and schema compatibility;
V1 parses historical data but is not V2 effect authority. Tags, object-only
input, expiry/operator mismatch and unbound digests produce zero apply effect.

## Consequences

- Direct pilot removes staging only from active V2 authority; it does not
  rewrite historical 028B/029B evidence types.
- Shared Timeweb credentials are explicitly temporary and not a least-authority
  claim. Values and rotation deadline remain outside source/evidence.
- RED uses only injected adapters and trusted fake clocks. It performs no DNS,
  SSH, DigitalOcean, Timeweb, GHCR, Docker or Coston2 effect.
- No deployed, hosted, PITR, live, cutover or 24-hour PASS exists until the
  production implementation and two fresh stopped-tree verifiers pass.
