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
canonical JSON and can approach twice the source byte count. The rejected
implementation then duplicated the same proof tuple three more times as raw
consumer calldata and duplicated both accepted results. For a 1,048,000-byte
transformed payload, the official ABI response is 1,049,280 bytes and consumer
calldata is 1,049,412 bytes. Their hex strings are respectively 2,098,562 and
2,098,826 characters. Two response strings plus three calldata strings alone
therefore require 10,493,602 characters before compiler, source, bytecode,
result or JSON framing evidence. No 6 MiB envelope can represent that design.

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
  bytecode SHA-256 and either accepted return-data or reverted data evidence;
- a strict `reproduction` section containing canonical standard-JSON compiler
  input and output bytes, the raw UTF-8 source plus path and SHA-256 for both
  consumers, the invariant library, bounded compiler stubs and the generated
  exact-proof verifier, raw creation/runtime bytecodes, canonical transformed
  response-shape JSON. It deliberately contains no execution tuple: consumer
  calldata and return/revert bytes are deterministically derived from the two
  embedded bundles, compiled runtime and official ABI, so duplicating them is
  forbidden.

All objects are strict. Arbitrary metadata, headers, URLs for runtime services,
raw source, credentials and private fields are not extensibility points. The
outer checksum is `sha256:` plus SHA-256 of canonical JSON content without the
checksum. `CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES` is exactly 6 MiB
(`6 * 1024 * 1024`), enforced before JSON parsing and after canonical
serialization. Each embedded canonical bundle is additionally capped at
2,200,000 UTF-8 bytes, and a recording bundle may contain at most 64 Merkle
proof nodes (2,048 raw proof bytes). Two bundle maxima consume 4,400,000 bytes,
leaving 1,891,456 bytes under the outer cap for the exact checked-in
compiler/source/bytecode evidence, hashes and JSON framing. The positive
near-maximum test uses the real fixed sources and toolchain to prove that this
remaining budget is sufficient. The outer cap remains the final combined
boundary; individual schema maxima are not a promise that arbitrary unbounded
`ProofBundleV1` metadata or every independent field maximum can coexist.

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
7. each embedded bundle respects the recording-only 2,200,000-byte and
   64-node Merkle bounds, and the canonical outer bytes, size and checksum
   match exactly.

Pure validation binds compiler, source, bytecode and shape hashes to their raw
`reproduction` bytes, requires canonical standard JSON and response-shape JSON,
and preserves outer byte integrity. Transcript calldata and result hashes have
no duplicated raw counterpart and remain claims at this layer. Pure validation
deliberately does **not** establish that source bytes equal the checked-in
contracts, that standard-JSON output came from `solc`, that bytecode came from
that output, or that claimed transcript hashes came from an EVM. Canonical
parse, checksum and self-consistency are non-authorizing evidence: a caller can
fabricate all claims, recompute the outer checksum, and still satisfy the pure
boundary.

### Trusted runtime verification authority

The only authority which may mark a recording accepted for CLI output or 024B
import is the concrete `packages/fdc-coston2` compiler/EVM runtime adapter. It
must not trust claimed compiler, source, bytecode, shape, calldata or result
material. For each verification it:

1. reparses the two exact persisted bundles and decodes `proof.response` with
   the official `IFdcVerification.verifyWeb2Json` proof-data ABI;
2. rereads the exact checked-in
   `CanonicalVulnerableWeb2JsonConsumer.sol`,
   `CanonicalSafeWeb2JsonConsumer.sol` and `ProoflineUrlInvariant.sol` bytes;
3. creates the bounded Web2Json/ContractRegistry compiler stubs and an
   exact-proof-hash verifier shim. The shim returns true only when
   `sha256(abi.encode(proof.data))` equals the attack or control persisted proof
   response hash; arbitrary proofs fail;
4. constructs canonical standard JSON, invokes the pinned `solc`, rejects all
   compiler errors, and compares exact standard-JSON output, source hashes and
   creation/runtime bytecodes with the recording;
5. derives exact consumer calldata from the decoded proof tuple, executes
   vulnerable/attack, safe/attack and safe/control in a fresh deterministic
   `@ethereumjs/vm`, and compares the independently derived calldata and
   return/revert hashes with the transcript. Safe/attack must return exactly the four-byte
   `HostMismatch()` selector `0xb828610a`;
6. derives the transformed response shape independently from the official ABI
   descriptor and decoded response data, then compares its canonical bytes and
   hash;
7. returns a `runtime-verified` authority result bound to the recording outer
   checksum only after every step passes.

The adapter performs no Coston2 or other external network I/O. Test-only ABI
valid bundle fixtures may exercise it, but production modules cannot import,
discover or fall back to those fixtures. `packages/cli` depends one-way on this
adapter and the packaged bin constructs it with the real checked-in-source file
reader and clock. An optional missing recorder is not a production
configuration.

Checked-in source reads are a public error boundary. Missing and permission
failures are normalized to code `CANONICAL_SOURCE_READ_FAILED` and the exact
message `Canonical URL attack source read failed`. The public error is bounded
and contains no OS code, stack, absolute path or Solidity filename; the raw
filesystem error is never serialized or logged.

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

Every option is mandatory exactly once and the run IDs must differ. Option
order may vary, but unknown/duplicate flags, trailing positional values and a
flag used as another flag's value fail before any bundle read, recorder call or
write. Run IDs use the bounded public run-ID grammar, release commit/tree are
lowercase 40-hex values, and the output path is a bounded non-option file path
without NUL/control bytes, `.`/`..` basename or a trailing directory separator.

The command retrieves
the two exact canonical bundle endpoints through the existing persisted API
client, invokes the concrete deterministic recorder once, requires its separate
runtime verification of the returned bytes, canonical-serializes the recording,
then uses an injected
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

The packaged bin always wires the concrete compiler/EVM recorder. Missing API
configuration or an unreadable checked-in source produces a bounded safe error,
exit code `2`, no stack, absolute source path or source filename, and no output
write. There is no default fixture path, checked-in synthetic recording, replay
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
decision wave. Its importer must call the same concrete runtime verification
authority and persist only bytes bound to a `runtime-verified` result; pure
domain parse/checksum/self-consistency cannot authorize import. A later public
surface consumes only that runtime-verified persisted recording or renders an
explicit unavailable state. No browser performs source, Coston2 or compiler
I/O.

### Production Open-Meteo demonstration

The production recording uses the existing terminal Open-Meteo run as its
control and one separately wallet-authorized attack run. Both manifests retain
the exact Open-Meteo method, six query values, JQ transform and ABI descriptor.
Only source authority changes: the control is
`https://api.open-meteo.com/v1/forecast`; the attack is a deterministic JSON
asset below `examples/canonical-url-attack/` served by
`cdn.jsdelivr.net` from one exact public repository commit. The immutable
jsDelivr GitHub endpoint is required because the live Flare Web2Json verifier
requires an `application/json` response; GitHub Raw serves these bytes as
`text/plain` and is therefore not a valid live demonstration source.
The production recorder derives that attack URL from `release.commitSha` and
accepts only the exact
`https://cdn.jsdelivr.net/gh/MarsherSusanin/Orivra@<commit>/examples/canonical-url-attack/attack-response.json`
manifest authority. The repository owner, repository name, commit segment,
artifact path and corresponding consumer authority are one cross-bound input;
the release identity cannot be copied independently from an unrelated URL.

The checked-in canonical safe consumer is therefore bound to HTTPS,
`api.open-meteo.com`, `/v1/forecast`, and the six template query values. The
different-host attack can still produce a valid persisted Web2Json proof, but
the deterministic EVM replay must reject it with `HostMismatch()`. No generated
fixture, mutable branch URL, `latest` row, or browser-derived authority may
replace either persisted bundle.

## Consequences

- Proofline can demonstrate its primary invariant without weakening or
  decorating `ProofBundleV1`.
- A real demo requires two independent live persisted runs and actual local EVM
  execution; development fixtures can test the recorder but cannot be shipped
  as the canonical demo.
- The recording is reproducible and mutation-evident across release identity,
  bundle bytes, compiler output and EVM behavior.
- The 6 MiB parse boundary remains a preparse memory-safety boundary. Its
  positive claim is limited to two 2,200,000-byte recording bundles with the
  exact fixed compiler/runtime evidence, not arbitrary unbounded bundle
  metadata.
- 024A introduces no API endpoint, PostgreSQL migration, Web behavior,
  credential request, external network access or hosted/deployed evidence.
- Contracts/domain/codegen remain pure and target 100% statements and branches;
  affected CLI code targets at least 90% lines and 85% branches.
