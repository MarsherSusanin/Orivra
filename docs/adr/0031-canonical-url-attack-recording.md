# ADR 0031 — Honest canonical URL attack recording

Status: Accepted

## Context

Proofline's central claim is that a valid Web2Json proof does not by itself
prove that a consumer trusts the intended URL. The repository already has a
canonical vulnerable consumer, a canonical safe consumer, deterministic local
EVM tests and persisted `ProofBundleV1` replay. It does not have two real,
independently persisted Coston2 bundles that demonstrate the attack and its
control. A generated bundle, replay run or test-system proof would make a
convincing-looking demo without proving the claim against live persisted
evidence.

The existing `ProofBundleV1` is a release invariant. It is the canonical bundle
returned by the persisted API path and must not gain demo-only compiler, EVM or
release fields. The demo therefore needs a separate, checksummed evidence
envelope which can be absent honestly until real evidence exists.

The source Web2Json response is capped at 1 MiB, but `proof.response` is hex in
canonical JSON and can approach twice the source byte count. Two bundle strings
plus the deterministic execution transcript can consequently exceed 3 MiB.
The outer limit must reject abusive input without excluding a valid maximum
recording.

## Decision

### Separate public recording contract

`packages/contracts` owns strict
`CanonicalUrlAttackRecordingContentV1Schema` and
`CanonicalUrlAttackRecordingV1Schema`. The envelope is version `1`, has kind
`canonical-url-attack-recording`, and carries these bounded fields:

- canonical millisecond-UTC `recordedAt` and exact lowercase 40-hex release
  `commitSha` and `treeSha`;
- fixed Coston2 network identity (`coston2`, chain `114`) and
  `persisted-api` evidence source;
- the literal statement `Valid proof ≠ trusted URL`;
- one shared `GET` query, JQ transform, official ABI descriptor and transformed
  response-shape SHA-256;
- exactly two bundle records, keyed `attack` and `control`, each with literal
  `persisted-live-coston2` provenance, wallet or relayer mode, run ID, exact
  canonical `ProofBundleV1` string, UTF-8 byte count, exact bundle-byte SHA-256,
  internal bundle checksum, last sequence, transaction hash, voting round,
  proof SHA-256, canonical request URL and response-shape SHA-256;
- exact compiler name/version, canonical compiler-input and compiler-output
  SHA-256, optimizer and EVM target; exact local EVM name/version/hardfork;
- vulnerable and safe consumer identities, contract names, source SHA-256,
  creation-bytecode SHA-256 and runtime-bytecode SHA-256, plus the invariant
  library source SHA-256 and exact `HostMismatch()` selector `0xb828610a`;
- an ordered three-execution transcript: vulnerable accepts the attack proof,
  safe rejects that exact attack proof with `HostMismatch()`, and safe accepts
  the control proof. Every execution binds the exact proof, calldata and runtime
  bytecode SHA-256 and either accepted return-data or reverted data evidence.

All objects are strict. Arbitrary metadata, headers, URLs for runtime services,
raw source, credentials and private fields are not extensibility points. The
outer checksum is `sha256:` plus SHA-256 of canonical JSON content without the
checksum. `CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES` is exactly 6 MiB
(`6 * 1024 * 1024`), enforced before JSON parsing and after canonical
serialization. This accommodates two maximum-bound hex proof bundles and the
bounded transcript while preserving a deterministic memory boundary.

`ProofBundleV1` is not extended or rewritten. Its internal checksum is distinct
from each exact canonical bundle-byte SHA-256 and from the recording's outer
checksum.

### Pure semantic validation

`packages/domain` owns pure
`createCanonicalUrlAttackRecording`,
`validateCanonicalUrlAttackRecording`,
`canonicalSerializeCanonicalUrlAttackRecording` and
`replayCanonicalUrlAttackRecording` boundaries. They perform no file, API,
compiler, EVM or network I/O.

Validation reparses both embedded strings with the existing strict,
byte-canonical `replayProofBundle` path and rejects unless:

1. the bundles have different run IDs and both are terminal, live wallet or
   relayer submissions with one persisted transaction;
2. every recorded run ID, internal checksum, canonical-byte SHA-256, UTF-8 byte
   count, last sequence, transaction hash, voting round, proof SHA-256 and
   canonical URL equals evidence inside that exact bundle;
3. attack and control use the same method, query, JQ, ABI descriptor and
   transformed response-shape identity, while their canonical source hosts are
   different and control supplies the safe intended host;
4. transcript proof and runtime hashes select the matching bundle and compiled
   consumer; the two attack executions use identical proof and calldata hashes;
5. the only results are vulnerable/attack accepted, safe/attack reverted with
   the exact `HostMismatch()` selector, and safe/control accepted;
6. no `replay`, synthetic, test-system or fixture provenance is accepted;
7. the canonical outer bytes, size and checksum match exactly.

Source/compiler hashes are factual recorder outputs. Pure validation checks
their strict form, checksum protection and all derivable cross-links; it does
not claim to reproduce a compiler run from hashes alone. The runtime recorder
must compute them from actual standard-JSON compilation and execution.

### Explicit CLI recorder ports

The only recording entry is:

```text
proofline demo record \
  --attack-run <persisted-live-run-id> \
  --control-run <persisted-live-run-id> \
  --commit <40-hex-commit> \
  --tree <40-hex-tree> \
  --out <recording-path>
```

Every option is mandatory and the run IDs must differ. The command retrieves
the two exact canonical bundle endpoints through the existing persisted API
client, invokes an injected deterministic recorder port exactly once, validates
and canonical-serializes the returned recording, then uses an injected
same-directory atomic-write port. Atomic output writes and syncs a temporary
file, renames only after full success, and cleans the temporary file on any
error. A prior destination may be replaced only by that atomic rename; a
failed bundle read, compilation, EVM execution or validation leaves it
unchanged.

The command never creates or submits a run, signs a transaction, calls a wallet
or relayer, or reads a Coston2 RPC/private-key variable. When it is eventually
used against real persisted runs, its only credential is the scoped Proofline
project token already used by the API client; that token appears only in the
API Authorization header and is never passed to the recorder, output port,
logs or evidence. Unit and credential-free 022–029A gates inject ports, disable
external network and do not use that token against a service.

There is no default fixture path, checked-in synthetic recording, replay
fallback, test-system fallback or embedded “demo” object. If the two real live
bundles or an actual deterministic execution are unavailable, recording fails
closed and product surfaces must say that the canonical attack recording is
unavailable. They must not imply live proof readiness.

### Runtime and later surfaces

Slice 024A freezes contracts and tests. Its GREEN implementation must compile
the checked-in canonical vulnerable consumer, canonical safe consumer and URL
invariant library through exact standard JSON, then execute the three exact
calls in a deterministic local EVM. The persisted bundles establish live proof
validity; the local transcript establishes the consumer behavior for the exact
recorded proof/calldata hashes. Merely constructing the expected transcript
object is not execution evidence.

024B API/PostgreSQL/Web persistence and presentation are excluded from this
decision wave. A later public surface consumes only a validated persisted
recording or renders an explicit unavailable state. No browser performs source,
Coston2 or compiler I/O.

## Consequences

- Proofline can demonstrate its primary invariant without weakening or
  decorating `ProofBundleV1`.
- A real demo requires two independent live persisted runs and actual local EVM
  execution; development fixtures can test the recorder but cannot be shipped
  as the canonical demo.
- The recording is reproducible and mutation-evident across release identity,
  bundle bytes, compiler output and EVM behavior.
- The 6 MiB parse boundary is larger than ordinary API payloads but justified
  by two hex-encoded maximum-bound proofs and remains explicit and testable.
- 024A introduces no API endpoint, PostgreSQL migration, Web behavior,
  credential request, external network access or hosted/deployed evidence.
- Contracts/domain/codegen remain pure and target 100% statements and branches;
  affected CLI code targets at least 90% lines and 85% branches.

