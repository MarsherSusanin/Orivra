# Slice 027C RED — WAL archiving and PITR recovery

Status: intentional RED frozen; production implementation pending.

Date: 2026-08-10 (Asia/Vladivostok)

Role: Architect and Contract/Test Designer; this author cannot implement the
production change or verify its eventual candidate.

Accepted parent commit: `527c561ec37b1a6a0b0c45b2c9abe8a41107f1bf`

Accepted parent tree: `ebdf6484b0f9d755dbd55906c3a121fd9f3d2c64`

Architecture decision: [ADR 0037](../adr/0037-wal-archiving-and-pitr-recovery.md)

Slice contract: [027C](../slices/027c-wal-archiving-and-pitr-recovery.md)

## Accepted prerequisite

Core and Product independently returned PASS for Slice 027B on the exact parent
identity above. That stopped tree passed local coverage, real PostgreSQL,
offline/no-pull Docker, runtime lifecycle, build and Sites gates. The runtime
heartbeat was a test-only SQL fixture: it is not actual worker, hosted,
DigitalOcean, Spaces or live Coston2 evidence.

## Frozen surface

This wave changes documentation and tests only. It freezes pure recovery
evidence, canonical bytes and checksums; WAL-G and official image locks;
credential-isolated prefetch and offline build seams; strict backup
configuration and file-secret loading; the dedicated backup login; encrypted
archive/base-backup/status/retention services; and private MinIO exact-time
new-volume recovery with explicit promotion authorization.

Production source, dependencies, lockfile, Dockerfiles, image locks,
Compose/Caddy configuration, package scripts and protected Sites files remain
unchanged. No Docker, image pull/build, Testcontainers, external network,
registry, provider or credential effect ran during RED.

## Intentional RED evidence

TypeScript remains structurally valid:

```sh
npm run typecheck
```

Result: PASS.

The focused contracts and backup-role matrix is:

```sh
npx vitest run \
  packages/contracts/test/slice027c-recovery.contract.test.ts \
  apps/api/test/slice027c-backup-role.contract.test.ts \
  apps/api/test/postgres/slice027c-backup-role.contract.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: 3 files: 15 intentional RED, 2 accepted controls PASS and 2 real
PostgreSQL cases SKIP because `PROOFLINE_TESTCONTAINERS=1` was not set. The
skips are a frozen future gate and are not PostgreSQL acceptance evidence.
Failures are exactly the absent cycle-free recovery export/schemas/canonical
serializers and absent sixth file-only backup database profile, strict URL,
bind-parameter replication login and exact grants.

The deployment/recovery matrix is:

```sh
node --test tests/deployment/slice027c-backup-recovery.contract.test.mjs
```

Result: 14 cases: 12 intentional RED and 2 accepted documentation/readiness
controls PASS, zero skip. Failures are exactly the absent real WAL-G hashes,
official image digests, recovery PostgreSQL image, isolated prefetch/build,
configuration/secrets, production backup overlay/wrapper/scripts, recovery
gate, private MinIO drill and promotion seam.

No hash or OCI digest was invented. WAL-G URL, exact size and both SHA-256
values are now frozen inputs; controlled 027C1 GREEN prefetch must verify them.
Only the absent OCI image digests remain controlled discovery before an offline
build can pass.

## Accepted controls

The nearest accepted contracts remain GREEN:

```sh
npx vitest run \
  packages/contracts/test/slice027b-deployment-readiness.contract.test.ts \
  apps/api/test/slice027b-db-role-bootstrap.contract.test.ts \
  apps/api/test/slice027b-deployment-database-authority.contract.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: 3 files, 30/30 PASS, zero skip.

```sh
node --test \
  tests/deployment/slice027a-compose-caddy.contract.test.mjs \
  tests/deployment/slice027b-runtime-lifecycle.contract.test.mjs \
  tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs
```

Result: 45/45 PASS, zero skip.

Sites compatibility remains GREEN without a rebuild or protected-file change:

```sh
npm run test:sites
```

Result: 36/36 PASS, zero skip.

## Harness review

The frozen schema validates the shape and digest grammar of a promotion
authorization but does not pretend to know the external restore digest it must
match; that binding is operationally checked before `pg_promote`. Backup-login
tests require the exact four-value bind call
`[proofline_backup_login, password, false, true]` instead of depending on SQL
statement ordering. The recovery gate may mention worker only to prove it was
not started; the QA Compose file itself must contain neither a worker service
nor its private-key input.

### Slice 009 package-boundary compatibility correction

After the initial RED freeze at commit
`bef57561458c980405ba1bb97a616c22e842d1e5` / tree
`11c389950fbd760158137e43102f19413161eeba`, the unchanged accepted Slice 009
worker-purity test still required the pre-027C contracts export map to contain
exactly five entries. That historical absence contradicts ADR 0037 and would
reject the frozen sixth exact feature entry `./recovery: ./src/recovery.ts` even
after correct implementation.

The compatibility correction preserves all five prior entries byte-for-byte,
adds only the exact sixth entry, requires recovery feature/root runtime identity
and a cycle-free/effect-free feature module, and proves a fresh worker bundle
and esbuild metafile contain neither recovery schema strings nor recovery input
bytes. Existing wallet, manifest, template, deployment, custody, side-effect and
worker-artifact exclusions remain unchanged. This is intentional 027C RED, not
a package-boundary or worker-custody weakening.

The first focused attempt used a literal dynamic deep import, which Vite tried
to resolve before test execution while the intentionally absent package export
was still RED. The harness now follows the adjacent accepted pattern and passes
the specifier through a variable, allowing all purity controls to execute
without changing the production contract.

Typecheck remains PASS. The corrected Slice 009 plus recovery-contract focus is
2 files / 23 cases: 8 intentional RED and 15 controls PASS. The fresh worker
bundle/metafile case is among the PASS controls and proves zero recovery input
bytes. The nearest worker bootstrap/entry/lifecycle matrix is 4 files, 21/21
PASS with zero skip; Sites compatibility remains 36/36 PASS. No production
source, package metadata, build artifact, Docker resource or network state was
changed.

### WAL-G release-asset identity correction

The initial RED freeze inserted an extra `ubuntu-` component into the asset
filename; that object does not exist in the official v3.0.8 release and made
the future controlled prefetch unsatisfiable. The exact
official Linux/amd64 asset is GitHub release asset id `343810769`, filename
`wal-g-pg-22.04-amd64.tar.gz`, URL
`https://github.com/wal-g/wal-g/releases/download/v3.0.8/wal-g-pg-22.04-amd64.tar.gz`,
size `17,891,961`, archive SHA-256
`b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9`
and extracted binary SHA-256
`f30544c5ce93cf83b87578e3c4a2e9c0e0ffc3d160ef89ecddaf75f397d98deb`.

The deployment RED now requires those exact values and the prefetch source to
name the exact asset. All no-auth, bounded-size, two-checksum, named-context and
offline-build authority remains unchanged. This tests/docs-only correction
performed no network, Docker, production, dependency, lock or Compose effect.
After the correction, typecheck is PASS; focused recovery remains exactly 15
intentional RED, 2 controls PASS and 2 real-PostgreSQL cases gated; deployment
recovery remains 12 intentional RED and 2 controls PASS. The nearest accepted
deployment/roadmap matrix is 45/45 PASS and Sites is 36/36 PASS.

### Recovery-gate control-bypass corrective RED

The production WIP was inspected read-only from stash object
`6cd5c72c2835c87e6b8d7fb896669ddc02374f7d` / tree
`134cd52250824ebfc86f0a27224753faf6dc86b4` and its untracked tree
`f9360f74c913270842d1dee9b8210ea8c3587fb3`; it was never applied. The candidate
`scripts/docker-recovery-gate.mjs` declared negative case names and immediately
discarded them with `void negativeCases`. Its positive path then assigned
`beforeCutPresent` and `afterCutAbsent` literal `true` values after a job exit.
No missing/corrupt object, wrong key, future target, reused/nonempty volume or
promotion-authorization negative actually ran. This is a CWE-693 protection
mechanism failure, so the WIP is rejected and supplies no recovery evidence.

Corrective RED adds an import-safe injectable core contract with eight exact
cases and fixed failure codes. Each case must return structured failure, zero
PASS-evidence writes, zero promotion attempts and exact zero cleanup counts;
strings, names, wrong codes, timeout and leftover resources fail closed. The
core must derive every restore/check boolean from actual machine-readable
`pitr-verify` fields. Source assertions require the Docker runtime and entry to
invoke that core and explicitly prohibit discarded case arrays or hardcoded cut
booleans. No negative case may reach `pg_promote`.

Corrective RED was demonstrated on the clean base
`5bd192242b09ed3a348a80456c544b431c21a9f7` / tree
`3d81e905d600c3151482718799d0f8e02dd24fbd`: `npm run typecheck` PASS; the new
executable-negative suite is 16/16 intentional RED because the import-safe core
and runtime do not exist; the existing deployment recovery contract remains 12
intentional RED and 2 controls PASS. The unchanged nearest deployment/roadmap
controls are 45/45 PASS and Sites compatibility is 36/36 PASS. No Docker,
network, production, dependency or lockfile operation was run.

### Six-image prefetch compatibility correction

The next production WIP was inspected read-only from stash object
`2ffe4679383ca6ce8c146a278ce9e15425d10eb2` / tree
`32111521e61212cbe7001ed59b3fd9caf481ee8b`; it was never applied. Its accepted
027C lock and prefetch orchestration extend the original `node`, `caddy` and
`postgres` identities with exact `postgresRecovery`, `minio` and `minioClient`
index plus Linux/amd64 digests. The retained 027A fake still emitted only the
six digest lines for the original three images, so the correct six-image WIP
failed with `Published image identity does not match the lock`. That was a stale
test double, not a production identity failure.

The retained contract now freezes all six accepted real locked identities,
emits all twelve index/platform digest lines and injects the exact six-image
lock. It semantically requires the exact ordered six `imagetools inspect`
references, six digest-addressed Linux/amd64 pulls and one dependency build.
The ambient-authority stripping, isolated Docker config, fail-closed identity
comparison and cleanup assertions remain unchanged; strings alone cannot make
the fake pass. This tests/evidence-only correction performs no Docker, network,
production, dependency or lockfile effect.

On base `a46ade4deea02c71a191eb3c50de06c31e54d51a` / tree
`49bd121dfdf46cf6553d6f937617794bca3a32ac`, typecheck is PASS. The combined
retained 027A and 027C deployment focus is 43 cases: 30 intentional RED and 13
controls PASS. Exactly two retained 027A cases are RED for the missing three
lock entries and missing three inspect/pull calls; its other 11 controls PASS.
The nearest unchanged deployment/roadmap controls are 45/45 PASS and Sites
compatibility is 36/36 PASS.

### Retained image-boundary inventory correction

The subsequent production WIP was inspected read-only from stash object
`b65e39e0bec98344e46ea9529f94eea7c8d0f7de` / tree
`15ccb0d7e00e0c58d5e9a0c1c0d73c11db8f9d9f`; it was never applied. A second
retained 027A contract still deep-compared `docker/base-images.json` with only
the original three entries. The test now extends that exact value with the
accepted real `postgresRecovery`, `minio` and `minioClient` tag, index-digest
and Linux/amd64 manifest-digest identities. Its application `FROM`, immutable
digest, official registry, no mutable tag, fresh-copy, secret exclusion and
worker-no-port assertions are unchanged.

A repository-wide scan of exact base-image inventory assertions found no other
genuine three-entry cap: the six-image prefetch contract was already corrected,
and the 027C deployment contract already requires the three added identities.
Historical ADR 0035/027A descriptions of the original foundation remain true
and are extended by ADR 0037; they are not executable caps and were not
rewritten. This tests/evidence-only correction performs no Docker, network,
production, dependency or lockfile effect.

On base `877bd101e0c5f689982430d7c864b04f774bff68` / tree
`2bbfb6a99e2957df7179d940fdf0401e0acf7a31`, typecheck is PASS. The complete
Docker static suite is 83 cases: 31 intentional RED for absent 027C production
and 52 controls PASS. The corrected image-boundary inventory is one of those
RED cases while its other nine historical assertions PASS. The nearest
deployment/roadmap controls remain 45/45 PASS and Sites compatibility remains
36/36 PASS.

### Security-review corrective RED

The canonical security report at
`/private/var/folders/m4/6p__vxf95w520v3b1t2cr5vr0000gn/T/codex-security-scans/Proofline/5bd1922_20260810T114116Z/report.md`
was read in full and independently matched SHA-256
`70654829ba15c05da5646ecdaa325066e7f25172c841d30638d3353af52193d0`.
The reviewed candidate was inspected read-only from stash object
`ca3fc7b469be6a122698a83e0cc9cdf36aba0b09` / tree
`c319a57aef485354b0c553ff093162a40936b7db` and untracked parent
`91c0148adf3f3c2ea5c0f1474348eed73a1c49ff`; it was never applied. The
candidate is rejected and provides no recovery/release evidence.

All three high-confidence reportable findings reproduce in source:

1. **CWE-367/CWE-494, medium:** prefetch verifies WAL-G and writes an ignored,
   owner-replaceable pathname, while the later build neither loads the lock nor
   hashes the exact bytes BuildKit copies.
2. **CWE-697/CWE-754, medium:** `pitr-verify` receives the same configured
   backup-evidence digest as both observed and expected inventory; no MinIO
   ciphertext object is independently enumerated or hashed.
3. **CWE-693/CWE-754, low:** six mandatory negative cases derive expected codes
   from local random-file, timestamp or path predicates and never invoke the
   named recovery path. The runtime forwards those driver-owned values.

Corrective RED freezes malicious and legitimate controls through the same
boundaries. WAL-G use-time verification requires an open-descriptor regular
file check, exact mode/receipt size/frozen digest, private byte capture before
any Docker call and an in-image copied-binary hash; a safe same-owner inode
replacement, symlink, wrong type/mode/size or empty input fails before build.
Inventory verification uses reader-only listing plus downloads to reconstruct
canonical sorted ciphertext `{key,size,sha256}` entries; changed, added and
removed objects fail against immutable backup evidence. Negative runtime
results require actual prepare/execute/observe phases, nonzero child exit,
child-output digest, matching case identity and causal mutation/sink
observations; the legacy synthetic four-field result is now explicitly RED.

The report's retention issue was non-reportable because no lower-authority
delete caller survived attack-path analysis. ADR functional safety is still
strict: canonical `BackupEvidenceV1`, separate evidence hash, active prefix,
derived encryption-key identifier and valid inventory keys must pass before
the fixed retain-eight delete. Tests prove every invalid variant performs zero
delete effects. No finding is called fixed until production GREEN, the original
PoCs and change-aware bypass review pass on one frozen tree.

Corrective RED was demonstrated on the clean base
`d988919e0b4b2ba8a598fb822c903dd1ac6850ce` / tree
`418d7bae89c28f7941a86bebd070f7017330bf5e`: syntax check and typecheck PASS;
the focused recovery/security set is 46 cases with 44 intentional RED and two
controls PASS. The complete Docker static set is 99 cases with 47 intentional
RED and 52 controls PASS. The unchanged 027A/027B/027R neighbor set is 45/45
PASS and Sites compatibility is 36/36 PASS. No Docker daemon, network,
production, dependency or lockfile operation was run.

### Receipt-size harness correction

On base `e12ebcdc9c0482a41a7ed629cb031581550d5180` / tree
`85f54db81528ade390c3cc1a8b5b190aac03caf2`, review found that the security
fixture created `receipt.v1.json` with mode `0444` and then attempted to mutate
it in place for the receipt-size negative. On an enforcing filesystem that
short-circuits with `EACCES` before the production boundary, so it is not valid
security evidence. The fixture now explicitly grants its owner temporary write
permission, writes the mismatched size, restores exact `0444` mode and only
then invokes the production orchestration. The negative therefore remains
causal and must fail with `RECOVERY_WAL_G_INPUT_INVALID` before one Docker call;
all other WAL-G security contracts are unchanged.

The corrected exact security file is 15/15 intentional RED with no harness
exception, and typecheck PASS. The complete Docker static set remains 99 cases
with 47 intentional RED and 52 controls PASS; the unchanged 027A/027B/027R
neighbor set is 45/45 PASS and Sites compatibility is 36/36 PASS. No Docker
daemon, network, production, dependency or lockfile operation was run.

### Security-review corrective RED wave 2

The discovery report at
`/private/var/folders/m4/6p__vxf95w520v3b1t2cr5vr0000gn/T/codex-security-scans/Proofline/72263e4_20260810T142444Z/artifacts/02_discovery/finding_discovery_report.md`
was read in full and independently matched SHA-256
`64dab1929d0b6466d9cf7b6ffff67cddc514e88802613d1ad6c122180f6916e8`.
Its sealed candidate snapshot is
`codex-security-snapshot/v1:sha256:4d30d4b85a64f1ac38aa5c3e0b2e2dfa343af1bd21cd4b7efc05186a068e5794`.
The candidate was inspected read-only from stash object
`9f3fede15e67b39e61dc9e466489b7d13cf386db` / tree
`88a06ac5f496898d19489712290649b026c89ae6` and untracked tree
`4c78d90fcbc04e1ac2e598051fe2eda4db7b653b`; it was never applied. The
candidate is rejected and provides no recovery/release evidence.

All three high-confidence findings reproduce in the candidate source:

1. `PL-027C-NEGATIVE-OBSERVATION-SELF-ASSERTED` (`CWE-693`, `CWE-754`): the
   child writes successful mutation/sink/no-PASS/no-promotion claims that the
   parent later accepts without case-specific Docker, database or object-state
   probes.
2. `PL-027C-RECOVERY-GATE-AMBIENT-AUTH` (`CWE-200`, `CWE-250`, `CWE-668`):
   the gate spreads `process.env` into every Docker command and the negative
   child, which then forwards that authority to its own Docker commands.
3. `PL-027C-NEGATIVE-TIMEOUT-SYNC-BYPASS` (`CWE-400`, `CWE-754`): the core's
   Promise timer cannot interrupt blocking `spawnSync` preparation/inspection,
   while case and project cleanup contain separately unbounded sync effects.

Wave-2 RED replaces ambiguous result fields with exact parent-owned evidence
fields and uses a forged matching child record against disagreeing parent
probes as the malicious control. It freezes an import-safe extracted negative
runtime whose parent independently probes object/hash, target/key/volume,
Docker/log, PostgreSQL recovery, PASS and promotion state; child observation
files have no authority. The legitimate control reaches the same boundary and
passes only when every parent probe agrees.

Two exact environment profiles are frozen: the Docker/Compose profile accepts
only the enumerated run-scoped QA file paths/nonsecrets, while the negative
child receives only the selected PostgreSQL image and three reader/encryption
secret-file paths plus an isolated execution base. Ambient Docker/registry,
AWS, GitHub/GHCR, npm, DigitalOcean/Spaces, proxy and generic secret/token/key
sentinels are absent; unknown scoped names and direct secrets fail closed.

Finally, the negative import graph must use the `recovery-async-child` seam,
with no sync child/process wait. Executable controls cover a normal child, a
hung process tree, hung prepare/execute/parent-inspect and hung cleanup. Timeout
must be normalized, abort must terminate/reap the process tree, cleanup has its
own deadline, and every fixture proves zero residual process/resource state.

Wave-2 RED was demonstrated on the clean base
`72263e4ed194ad02c23b5095dc846ad4b6c44a74` / tree
`638dc024ec53e3083597471d2e3880a0641c7299`: syntax check and typecheck PASS;
the exact new file is 13/13 intentional RED and the combined negative/security
focus is 45/45 intentional RED. The complete Docker static set is 112 cases
with 60 intentional RED and 52 controls PASS. The unchanged 027A/027B/027R
neighbor set is 45/45 PASS and Sites compatibility is 36/36 PASS. No Docker
daemon, network, production, dependency or lockfile operation was run.

No finding is called fixed until production GREEN, the discovery triggers and
change-aware bypass review pass on one frozen tree.

### Defensive-validation corrective RED wave 3

The defensive validation summary at
`/var/folders/m4/6p__vxf95w520v3b1t2cr5vr0000gn/T/codex-security-scans/Proofline/a7a69bc_20260810T155816Z/artifacts/05_findings/validation_summary.md`
was read in full and independently matched SHA-256
`21d7921b814de68a6c436a377d8f6fd29b9864cfeb6e9e245a58fc8a7e1d6eb1`.
The matching discovery report matched SHA-256
`854f39b806708d68e1cfeea33a934af6736d2e5c543a0f505344f60304965b41`.
The rejected candidate was inspected read-only from stash
`753fc1384989cce14ade4ce290d57adfa340da28` / tree
`efc46c21d1e42f6a1326b941a2c0d27574cec6d6`; its third parent
`c10a7f2bc8eb9cf34ab7c69dc30b812ac8569a83` binds untracked tree
`e0ae4ec9a4ca2cbfee675dd376e9b3bd588fccda`. It was never applied and
provides no recovery/release evidence.

All five validated high-confidence gaps reject that candidate:

1. `FD-027C-SH01-001`: sink/promotion acceptance is not bound to the exact
   negative project/service/container, and missing/corrupt object probes do
   not prove the exact object semantics. Child output and the positive
   project's recovery state can satisfy parent-labelled evidence.
2. `FD-027C-SH01-002`: arbitrary ambient `DOCKER_HOST` selects the recovery
   daemon despite the otherwise exact environment profile.
3. `FD-027C-SH01-003`: timeout rejection occurs immediately after group
   `SIGKILL`, before the TERM-resistant child group is confirmed closed/reaped.
4. `FD-027C-SH01-004`: rejection or timeout from the project finalizer skips
   the sole recursive temporary-secret removal.
5. `PL-027C-PREFETCH-AMBIENT-DOCKER-AUTHORITY-001`: inspect, pull and build
   children retain omitted Docker transport, SSH-agent and BuildKit/buildx
   authority even though named registry/cloud variables are stripped.

Wave-3 RED is defensive and uses only import-safe fakes and benign local
TERM-resistant fixtures. It freezes a canonical parent probe identity over
the negative case/project/service/container/object/volume/PASS path; forged
positive-project, wrong-service, wrong-container and wrong-object bindings
must fail before any probe. Four independent parent probes are required and
the parent observer has no child execution/status/output input.

Recovery now rejects ambient or direct Docker endpoint/context/TLS/
certificate/auth, SSH and BuildKit/buildx authority and produces an isolated
no-auth local-default profile. Twelve repeated process-tree controls require
timeout settlement only after both TERM-resistant leader and descendant are
gone. The outer lifecycle contract preserves project-finalizer rejection or
normalized timeout while still removing real mode-0600 secret fixtures.
Three fake prefetch phases independently require the exact eight-name child
environment and prove that every sentinel is absent.

Wave-3 RED was demonstrated on clean base
`a7a69bc782d1456c80e37ff90dedc7eff805da2d` / tree
`50efa42bf6d92a3bdc3cf9e675fbdb2a1ec15b57`: syntax checks and typecheck PASS;
the exact new file is 23/23 intentional RED and the combined recovery-negative
and security focus is 68/68 intentional RED. The complete Docker static set is
135 cases with 83 intentional RED and 52 retained controls PASS. The unchanged
027A/027B/027R neighbor set is 45/45 PASS and Sites compatibility is 36/36
PASS. The repeated process tests stopped before spawning because the production
async helper is intentionally absent on the clean RED base; the three prefetch
tests executed only a checked-in fake child. No Docker daemon, network,
production, dependency or lockfile operation was run.

### Wave-3 prefetch sentinel harness correction

On exact clean base `453782e0fdec72194dd24dc9e96c3c064c22d892` /
tree `682838ecfe63e2de6221883493ee6dd69d8610de`, the production candidate was
inspected read-only from stash `6de3b213a6ca7623d4ba5969894fe89d141501b0` /
tree `a6941dfc670e8d36449f8d86b98c5296868358a9`; it was never applied. Review
found a test-harness causality defect, not a closed production finding: the
ambient `DOCKER_TLS_VERIFY` sentinel was the common literal `1`, so a substring
scan could reject an otherwise isolated child merely because `1` appeared in
the preserved `PATH` or macOS-injected environment metadata.

The corrected harness makes forbidden environment-key absence the authority
check and uses unique, field-specific high-entropy sentinel values only as
defence in depth. It compares the supplied child environment against the same
frozen eight-name allowlist after removing only the explicitly enumerated
macOS-injected `__CF_USER_TEXT_ENCODING`; no OS-injected key becomes part of
the accepted application allowlist. The three inspect/pull/build fake-child
cases now fail causally on the leaked Docker TLS/transport, SSH, BuildKit and
proxy keys rather than on an overlapping sentinel value.

Syntax check and typecheck PASS. The exact wave-3 file remains 23/23
intentional RED with no harness exception; the combined recovery-negative and
security focus remains 68/68 intentional RED. The complete Docker static set
remains 135 cases with 83 intentional RED and 52 controls PASS. The unchanged
027A/027B/027R neighbor set is 45/45 PASS and Sites compatibility is 36/36
PASS. No Docker daemon, network, production, dependency or lockfile operation
was run.

This wave does not claim any production finding fixed. GREEN must rerun the
original five validation triggers and a change-aware bypass review on one
frozen tree before any recovery PASS, promotion or release evidence exists.

### Future-target terminal parent-sink corrective RED

The canonical security report at
`/private/var/folders/m4/6p__vxf95w520v3b1t2cr5vr0000gn/T/codex-security-scans/Proofline/a559884_20260810T172920Z/report.md`
was read in full and matched SHA-256
`28e0be7fbb67c92129c38c436190e6ebb32c0bb89933ca692fb9ca44582742c3`.
Finding `PL-027C-FUTURE-TARGET-PARENT-SINK-001` rejects the production
candidate inspected read-only from stash
`335c06acd6a553311b6a3f47c033385a2101dfff` / tree
`e0810db00301194acc6b3c55bddf96edec0b875c`; the stash was never applied.

The candidate's parent sink and promotion probes accept the exact bound
future-target PostgreSQL container while it is merely `running` and
`pg_is_in_recovery()` returns `t`. A premature expected child failure can
therefore combine with that nonterminal state to create mandatory negative
evidence. The child's own exited/log check is not counterevidence because
child exit, output and observation are deliberately outside parent authority.

Corrective RED freezes one import-safe terminal-only parent probe used by both
sink and zero-promotion observations. A benign premature fixture supplies the
expected child failure while the parent sees running recovery and must remain
false. Zero exit status or a missing signature must also remain false. The
legitimate fixture becomes true only when the parent-owned bounded Docker
runner reads the exact negative container in `exited` state, a nonzero
PostgreSQL process exit code and the exact case-sensitive terminal signature
`recovery ended before configured recovery target was reached`. No child field
is an input to that probe.

This corrective wave is demonstrated on exact clean base
`a5598843b5d21dae5b6be19044b69fe9842800fb` / tree
`f9dc7c77c360031d5cdb61fbe11281db1472f5ea`. It adds three intentional RED
cases to the wave-3 file: the exact file is 26/26 RED, the combined security
focus is 71/71 RED, and the complete Docker static set is 138 cases with 86
intentional RED and 52 controls PASS. Syntax and typecheck PASS; unchanged
027A/027B/027R neighbors remain 45/45 PASS and Sites remains 36/36 PASS. No
Docker daemon, network, production, dependency or lockfile operation ran.

## Required GREEN evidence

- 100% statements/branches/functions/lines for pure recovery contracts;
- affected API coverage at least 90% lines and 85% branches;
- real PostgreSQL backup-role cases with zero skip;
- controlled no-auth prefetch followed by two offline/no-pull builds;
- exact 027A, 027B and `test:docker:recovery` gates with scoped cleanup;
- build/Sites compatibility and two independent reports on one stopped tree.

Until those gates pass, Proofline has no WAL-G runtime, base backup, PITR,
Spaces, actual RPO/RTO, hosted restore or promotion evidence.
