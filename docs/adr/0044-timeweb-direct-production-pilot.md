# ADR 0044: Timeweb direct-production pilot and resumable 24-hour acceptance

- Status: Accepted contract; intentional RED
- Date: 2026-08-12
- Supersedes active production portions of: ADR 0037, ADR 0042, ADR 0043
- Retains: all V1 schemas as historical compatibility data types

## Context

The first five immutable GHCR images were published under canonical
`PublicationEvidenceV1` SHA-256
`1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`.
That record remains a compatibility fixture, not authority for production code
changed after its producer tree. A deployable 029C candidate requires a fresh
028A/029A/028B publication and fresh V2 authorization bound to those exact
canonical bytes. There is no accepted staging deployment; the pilot deploys a
newly authorized release directly to the existing DigitalOcean VDS production
boundary and does not fabricate staging evidence.

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
80/443 and private API, worker and PostgreSQL networks. Image IDs, order and
canonical GHCR repositories are fixed; digest references derive only from the
currently authorized canonical `PublicationEvidenceV1`.

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

The direct pilot reuses the already selected VDS through pinned SSH, so this
inventory has no DigitalOcean API token. It retains only the read-only GHCR
token, SSH key, Timeweb access/secret files, backup encryption key and required
replay/backup inputs. The safe-consumer registry is not an input: its fixed
path must be absent before deployment and it is atomically published mode 0400
with no-replace semantics only after both consumer deployments succeed.

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

The production command owns compilation and deployment; the generic promotion
runtime cannot accept a caller-authored registry as success. It loads the two
built-in manifests, generates Open-Meteo then ETH/USD source and compiles with
pinned `solc-0.8.36` against the official Coston2 `ContractRegistry` import
semantics. It opens the funded relayer key only from an absolute, regular,
non-symlink mode-0400 file, verifies chain 114 and sufficient balance for both
estimated deployments, sends exactly two transactions, waits successful exact
receipts and requires nonempty runtime bytecode at two distinct addresses.

`SafeConsumerDeploymentEvidenceV1` binds compiler/import authority, relayer
public address and balance requirement, exact registry checksum, both manifest,
source, bytecode, transaction, block, address and runtime-code identities. The
canonical registry and deployment evidence are staged together as mode-0400
files; deployment evidence is published first and the registry is the atomic
no-replace commit marker. Any failure leaves no final registry and therefore no
authoritative pair. Secret bytes and paths never enter either artifact.

Production Compose contains an eighth one-shot `safe-consumer-deployer`
service sharing the worker image but not worker database/verifier authority.
One host `PROOFLINE_SAFE_CONSUMER_EVIDENCE_ROOT` is mounted read/write only at
`/opt/orivra/evidence` in that deployer; the worker mounts only the derived
`safe-consumer-registry.v1.json` read-only at its internal registry path. Both
final evidence files must be absent before deployer execution and regular,
non-symlink mode-0400 files before worker startup. Worker depends on successful
deployer completion. A second host registry-path variable and the legacy
global address remain forbidden.

### Complete typed preflight authority

`ProductionPilotPreflightEvidenceV1` is strict and binds the effect authority,
not merely check names. The read-only GHCR observation contains the exact
ordered five `{id, remoteReference, remoteDigest}` records from publication
evidence. The Timeweb observation repeats the exact
`https://s3.twcstorage.ru`, `ru-1`, `orivra-backet`, path-style authority and
records exactly passed `PUT`, `HEAD`, `LIST`, `GET`, `DELETE` capability
observations. The Coston2 observation binds chain 114, canonical RPC
`https://coston2-api.flare.network/ext/C/rpc`, canonical DA
`https://ctn2-data-availability.flare.network`, public relayer address,
decimal balance and configured authorization. Missing, extra, reordered or
mismatched authority fails before provisioning. The five GHCR records accept a
new immutable digest only when IDs, order and repositories are exact and every
reference is internally consistent. Effect authorization cross-binds the full
tuple to parsed publication bytes; a valid observation for the historical
fixture cannot authorize a newer publication.

### Database, cutover and 24-hour acceptance

Order is PostgreSQL, role bootstrap, checksummed migrator, API, deterministic
two-consumer deploy, registry write, real worker, Web and candidate Caddy.
Deployment evidence V2 binds publication, target, authorization, Timeweb
authority, exact five images, exact registry, schema 10, readiness, real
heartbeat, Timeweb PITR and both persisted live runs.

Caddy cutover is an explicit adapter effect before deployment evidence append.
After it returns strict origin and trusted activation time, a separate external
HTTPS observation must confirm that exact public origin. Only then may the
cutover checkpoint and deployment evidence be appended. Strict
`ProductionDeploymentEvidenceV2` binds exactly
`cutover: {status:"passed", publicOrigin, activatedAt}`. An external
observation, checkpoint or evidence failure after cutover requires
`rollbackCaddy` and leaves zero deployment PASS.

The resumable append-only canary has exactly `cutover`,
`post-cutover-15m`, `post-cutover-1h`, `post-cutover-24h`. Each checkpoint is
run only when a trusted injected clock reaches its due time, records strict
health, readiness, current heartbeat, backup/archive freshness, disk,
browser and both persisted-live results. Every checkpoint also records strict
host synchronization `{status:"synchronized", source:"production-host",
maximumSkewSeconds:5, observedSkewSeconds}`; observed skew above five seconds
fails before append. The complete checkpoint is conditionally appended. A
restart validates the canonical accepted prefix and executes only the first
missing due checkpoint. Gaps, duplicates, substitution, an early trusted time
or an echoed caller time fail closed. Terminal V2 PASS is impossible before
86400 elapsed seconds and all four accepted checkpoints.

The production resume entrypoint is a root-owned systemd oneshot triggered by a
one-minute persistent timer. The unit invokes only
`/opt/orivra/current/scripts/resume-production-canary.mjs --state-root
/var/lib/orivra/production-canary`, with umask 0077 and that root as its only
writable path. It reads canonical state, trusts the real host clock, rejects
clock regression and caller-supplied future time, and atomically appends only
the first missing due mode-0400 checkpoint. Terminal promotion remains
impossible before the host clock reaches cutover plus 86400 seconds. A failed
append removes its stage and does not advance the accepted prefix.
The timer consumes canonical `ProductionDeploymentEvidenceV2` bytes plus an
independent checksum. At 24 hours it appends canonical
`ProductionPromotionEvidenceV2` with `status:passed`, `promotionClaim:true` and
the exact deployment digest. A non-PASS test receipt is not acceptance.

The direct-pilot CLI accepts only absolute canonical evidence/authority and
required secret-file paths; it accepts no DigitalOcean API token. It constructs
the production adapter set before invoking
`runTimewebDirectProductionPilot`; it cannot pass raw status objects or secret
values through argv/stdout. The systemd CLI similarly delegates to the bounded
canary tick runtime rather than fabricating checkpoint observations.

### Production host command boundary

Pinned SSH may invoke only
`/opt/orivra/current/scripts/timeweb-production-host-command.mjs --command
<base64url-json>`. The decoded canonical UTF-8 JSON is bounded to 32,768
base64url characters, strict `{version:"1", kind, id, payload}` and recursively
frozen before any effect. The fixed command allowlist covers firewall, exact
digest pull/inspection, database-first Compose phases, safe-consumer deploy,
readiness/heartbeat, Timeweb PITR, two persisted live runs, explicit Caddy
activation, canonical append and typed canary observation. No shell fragment,
executable, service name, path, environment variable or arbitrary argument is
caller-selectable; `eval`, string-command `exec` and `shell:true` are forbidden.

The runner fixes `/opt/orivra/current`, `/opt/orivra/secrets`,
`/opt/orivra/evidence`, Compose project `proofline-production-primary` and the
three accepted Compose files. Firewall SSH authority derives only from the
first address in `SSH_CONNECTION`; UFW denies inbound by default, permits that
source for SSH and public TCP 80/443 only, and never publishes 5432/8080. GHCR
uses the fixed token file through a read-only session, pulls five exact digest
references and independently inspects the same ordered digests. Candidate
Caddy has public ingress disabled until the separate activate command confirms
the staged candidate and exact external HTTPS origin.

The deployer command requires both canonical safe-consumer outputs absent,
runs the fixed one-shot service, then requires the regular non-symlink
mode-0400 pair. PITR requires a new Timeweb base backup and a fresh restore
volume, never the production volume. Readiness requires current real worker
heartbeat; live acceptance requires the exact two persisted Coston2 run IDs.
Evidence and checkpoint writes use fixed paths, canonical bytes, mode 0400 and
atomic no-replace. Every command is bounded; failures emit only a fixed
redacted code and cannot expose the encoded command, secret paths or values.

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
